// ABOUTME: Decides whether a package's source is its ecosystem's official registry and, if not, its kind and address: host and http
// ABOUTME: keep scheme and host, url the host and file name, git the whole path without user info, query or fragment.
"use strict";

const { OBJECT_ID } = require("./util");

// The only registries a package is expected to come from. Mirrors are not: nothing vouches for the bytes a mirror serves.
const OFFICIAL_HOSTS = { npm: ["registry.npmjs.org", "registry.yarnpkg.com"], PyPI: ["pypi.org", "files.pythonhosted.org"] };

// npm reads `file:` and `npm:` in any case; the other protocols (`link:`, `workspace:`, `portal:`, `catalog:`, `jsr:`, `exec:`,
// `patch:`) are matched as written.
const LOCAL_PREFIXES = ["link:", "workspace:", "portal:", "catalog:", "./", "../", "/", "~/"];
const GIT_SCHEMES = ["git+https:", "git+ssh:", "git+http:", "git:", "ssh:"];
const SSH_SCHEMES = ["git+ssh:", "ssh:"];
const SHORTHAND_HOSTS = new Map([
  ["github:", "https://github.com"],
  ["gitlab:", "https://gitlab.com"],
  ["bitbucket:", "https://bitbucket.org"],
]);
const GIST_PREFIX = "gist:";
// How many path segments each shorthand takes: GitLab allows subgroups; a gist may name its user before its id.
const SHORTHAND_SEGMENTS = new Map([
  ["github:", { min: 2, max: 2 }],
  ["gitlab:", { min: 2, max: Infinity }],
  ["bitbucket:", { min: 2, max: 2 }],
  [GIST_PREFIX, { min: 1, max: 2 }],
]);
// Every value starting with one of these is a git source, read or not, so never a version range.
const GIT_FORMS = ["git+", "git:", "ssh:", ...SHORTHAND_SEGMENTS.keys()];
// One segment of a shorthand or scp-form name: a single character class, so it cannot backtrack.
const NAME_SEGMENT = /^[A-Za-z0-9._-]+$/;
const SCP_HOST = /^[A-Za-z0-9.-]+$/;
const EXEC_TEXT = "a script that produces the package";
const UNREAD_GIT_TEXT = "a git source it could not read";
const UNREAD_ADDRESS_TEXT = "an address it could not read";
// How many `patch:` layers a package.json value is followed through. Each layer is decoded in full, so the depth is capped to
// keep a deeply nested value from costing time quadratic in its length.
const PATCH_DEPTH = 2;
// A patch nested deeper than that, or one naming no package, is shown as a url with this text: it stands for one package whose
// real source is unknown.
const UNREAD_SOURCE = Object.freeze({ expected: false, kind: "url", address: null, text: "a source it could not read" });

const EXPECTED = Object.freeze({ expected: true });
const LOCAL = Object.freeze({ expected: false, kind: "local" });
const UNREADABLE = Object.freeze({ unreadable: true });

// The one of `prefixes` (lower case) that the text starts with, in any case, or undefined.
const prefixOf = (text, prefixes) => {
  const lower = text.slice(0, 16).toLowerCase();
  return prefixes.find((prefix) => lower.startsWith(prefix));
};
const isLocal = (text) => prefixOf(text, ["file:"]) !== undefined || LOCAL_PREFIXES.some((prefix) => text.startsWith(prefix));
// The text before the first `mark`, or all of it.
const before = (text, mark) => text.split(mark, 1)[0];
// The text without its query string and fragment.
const withoutQuery = (text) => before(before(text, "#"), "?");

// The commit a source's fragment names: exactly 40 or 64 hex, or `commit=` followed by that (Yarn berry). Any other fragment is a
// branch, a tag or something else that is not a commit.
function commitFrom(text) {
  const hash = text.indexOf("#");
  if (hash < 0) return null;
  const fragment = text.slice(hash + 1);
  const value = fragment.startsWith("commit=") ? fragment.slice("commit=".length) : fragment;
  return OBJECT_ID.test(value) ? value : null;
}

function gitResult(text, address) {
  const commit = commitFrom(text);
  return commit ? { expected: false, kind: "git", address, commit } : { expected: false, kind: "git", address };
}

function parseUrl(text) {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

// `github:u/r`, `gitlab:group/sub/r`, `bitbucket:u/r` and `gist:[<user>/]<id>`, shown as the repository's address.
function shorthand(text) {
  const prefix = prefixOf(text, [...SHORTHAND_SEGMENTS.keys()]);
  if (!prefix) return null;
  const segments = withoutQuery(text.slice(prefix.length)).split("/");
  const { min, max } = SHORTHAND_SEGMENTS.get(prefix);
  if (segments.length < min || segments.length > max || !segments.every((s) => NAME_SEGMENT.test(s))) return UNREADABLE;
  if (prefix === GIST_PREFIX) return gitResult(text, `https://gist.github.com/${segments[segments.length - 1]}`);
  return gitResult(text, `${SHORTHAND_HOSTS.get(prefix)}/${segments.join("/")}`);
}

// A git URL with a scheme: shown with the transport after any `git+`, the host and the path. An ssh URL with an scp-style colon
// after the host (`git+ssh://git@host:u/r.git`), which is not a URL, is read as scp form.
function gitUrl(text) {
  if (!prefixOf(text, GIT_SCHEMES)) return null;
  const url = parseUrl(prefixOf(text, ["git+"]) ? text.slice("git+".length) : text);
  if (url && url.host) return gitResult(text, `${url.protocol}//${url.host}${url.pathname}`);
  const authority = text.indexOf("://");
  return (prefixOf(text, SSH_SCHEMES) && authority >= 0 && scpForm(text.slice(authority + 3))) || UNREADABLE;
}

// An http(s) address: the official registry, a mirror (host), plain http, or one archive on another host (url).
function webUrl(ecosystem, text, direct) {
  if (!prefixOf(text, ["https:", "http:"])) return null;
  const url = parseUrl(text);
  if (!url || !url.host) return UNREADABLE;
  const origin = `${url.protocol}//${url.host}`;
  if (url.protocol === "http:") return { expected: false, kind: "http", address: origin };
  if (url.port === "" && (OFFICIAL_HOSTS[ecosystem] ?? []).includes(url.hostname)) return EXPECTED;
  if (!direct) return { expected: false, kind: "host", address: origin };
  return { expected: false, kind: "url", address: `${origin}/${url.pathname.slice(url.pathname.lastIndexOf("/") + 1)}` };
}

// scp-form git, `user@host:path`, split by hand at the first `@` and the first `:` after it; shown as `git@host:path`, with any
// user other than `git` dropped. Text that is not `user@host:` is not scp form (null); scp form whose path has anything but
// names between single slashes is unreadable, so control characters or a second colon never reach the address.
function scpForm(text) {
  const at = text.indexOf("@");
  const colon = at < 0 ? -1 : text.indexOf(":", at);
  if (colon < 0) return null;
  const user = text.slice(0, at);
  const host = text.slice(at + 1, colon);
  if (!NAME_SEGMENT.test(user) || !SCP_HOST.test(host)) return null;
  const repoPath = withoutQuery(text.slice(colon + 1));
  if (!repoPath.split("/").every((segment) => NAME_SEGMENT.test(segment))) return UNREADABLE;
  return gitResult(text, `${user === "git" ? "git@" : ""}${host}:${repoPath}`);
}

// Any git form: a hosting shorthand, a git URL, or scp form.
const gitSource = (text) => shorthand(text) ?? gitUrl(text) ?? scpForm(text);

// ecosystem: "npm" or "PyPI"; text: the raw source, without the package name; direct: true when the field pins one archive.
function classifySource(ecosystem, text, { direct = false } = {}) {
  if (typeof text !== "string" || text === "") return UNREADABLE;
  if (isLocal(text)) return LOCAL;
  return gitSource(text) ?? webUrl(ecosystem, text, direct) ?? UNREADABLE;
}

// The resolution a `patch:` value patches: URL-decoded, without the patch file after `#` or the package name before `@`; null
// when it names no package.
function patchedResolution(value) {
  const body = before(value.slice("patch:".length), "#");
  let decoded = body;
  try {
    decoded = decodeURIComponent(body);
  } catch {}
  const at = decoded.indexOf("@", 1);
  return at < 0 ? null : decoded.slice(at + 1);
}

// `u/r` or `u/r#ref`: GitHub shorthand, exactly one `/`, not a scoped name.
function isGithubShorthand(value) {
  const segments = withoutQuery(value).split("/");
  return segments.length === 2 && segments.every((s) => NAME_SEGMENT.test(s)) && !value.startsWith("@");
}

// A package.json dependency value, in the order the package managers read it. A git or http(s) value it cannot read is reported
// with a fixed text in place of the address; a value that is none of the source forms is a version range or a tag, so the
// registry: this never answers unreadable.
function classifyManifestValue(ecosystem, value) {
  let resolution = value;
  for (let depth = 0; resolution.startsWith("patch:"); depth++) {
    if (depth === PATCH_DEPTH) return UNREAD_SOURCE;
    resolution = patchedResolution(resolution);
    if (resolution === null) return UNREAD_SOURCE;
  }
  if (isLocal(resolution)) return LOCAL;
  if (prefixOf(resolution, ["npm:"])) return EXPECTED;
  if (resolution.startsWith("jsr:")) return { expected: false, kind: "host", address: "https://npm.jsr.io" };
  if (resolution.startsWith("exec:")) return { expected: false, kind: "url", address: null, text: EXEC_TEXT };
  const gitText = isGithubShorthand(resolution) ? `github:${resolution}` : resolution;
  const git = gitSource(gitText);
  if (git && git.kind === "git") return git;
  if (git || prefixOf(resolution, GIT_FORMS)) return { expected: false, kind: "git", address: null, text: UNREAD_GIT_TEXT };
  const web = webUrl(ecosystem, resolution, true);
  if (web && !web.unreadable) return web;
  if (web) return { expected: false, kind: prefixOf(resolution, ["https:"]) ? "url" : "http", address: null, text: UNREAD_ADDRESS_TEXT };
  return EXPECTED;
}

module.exports = { classifySource, classifyManifestValue, commitFrom, OFFICIAL_HOSTS, NAME_SEGMENT, UNREADABLE };

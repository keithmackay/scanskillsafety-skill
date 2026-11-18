// ABOUTME: Decides whether a package's source is its ecosystem's official registry and, if not, its kind and address: host and http
// ABOUTME: keep scheme and host, url the host and file name, git the whole path without user info, query or fragment.
"use strict";

const { OBJECT_ID } = require("./util");

// PyPI's index is pypi.org at /simple; its package files are on files.pythonhosted.org. Anything else on pypi.org (a project page
// renders its README) is not official. The index is matched on the text as written, since pip sends a path as written and the URL
// parser here would resolve `%2e` dot segments into /simple.
const PYPI_INDEX_HOST = "pypi.org";
// pypi.org's index as pip sends it: the scheme and host in any case, the path exactly `/simple` or `/simple/`.
const PYPI_INDEX = /^https:\/\/pypi\.org(?::443)?\/simple\/?(?:[?#]|$)/;
const withLowerCaseAuthority = (text) => {
  const pathStart = text.indexOf("/", text.indexOf("://") + 3);
  return pathStart < 0 ? text.toLowerCase() : text.slice(0, pathStart).toLowerCase() + text.slice(pathStart);
};
const PYPI_FILE_HOST = "files.pythonhosted.org";
// The only registries a package is expected to come from. Mirrors are not: nothing vouches for the bytes a mirror serves.
const OFFICIAL_HOSTS = { npm: ["registry.npmjs.org", "registry.yarnpkg.com"], PyPI: [PYPI_INDEX_HOST, PYPI_FILE_HOST] };

// npm reads `file:` and `npm:` in any case; the other protocols (`link:`, `workspace:`, `portal:`, `catalog:`, `jsr:`, `exec:`,
// `patch:`) are matched as written.
const LOCAL_PREFIXES = ["link:", "workspace:", "portal:", "catalog:", "./", "../", "/", "~/"];
const GIT_SCHEMES = ["git+https:", "git+ssh:", "git+http:", "git:", "ssh:"];
const SSH_SCHEMES = ["git+ssh:", "ssh:"];
const SHORTHAND_HOSTS = new Map([
  ["github:", "https://github.com"],
  ["gitlab:", "https://gitlab.com"],
  ["bitbucket:", "https://bitbucket.org"],
  ["sourcehut:", "https://git.sr.ht"],
]);
const GIST_PREFIX = "gist:";
// How many path segments each shorthand takes: GitLab allows subgroups; a gist may name its user before its id.
const SHORTHAND_SEGMENTS = new Map([
  ["github:", { min: 2, max: 2 }],
  ["gitlab:", { min: 2, max: Infinity }],
  ["bitbucket:", { min: 2, max: 2 }],
  ["sourcehut:", { min: 2, max: 2 }],
  [GIST_PREFIX, { min: 1, max: 2 }],
]);
// Every value starting with one of these is a git source, read or not, so never a version range.
const GIT_FORMS = ["git+", "git:", "ssh:", ...SHORTHAND_SEGMENTS.keys()];
// One segment of a shorthand or scp-form name: a single character class, so it cannot backtrack.
const NAME_SEGMENT = /^[A-Za-z0-9._-]+$/;
// A sourcehut user, written with a leading `~`.
const SOURCEHUT_USER = /^~?[A-Za-z0-9._-]+$/;
// Whether a repository path's segments are names, the first allowed to be a sourcehut user on that host.
const isRepositoryPath = (segments, sourcehut) =>
  segments.every((segment, k) => (sourcehut && k === 0 ? SOURCEHUT_USER : NAME_SEGMENT).test(segment));
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
  if (segments.length < min || segments.length > max || !isRepositoryPath(segments, prefix === "sourcehut:")) return UNREADABLE;
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

// Whether an https address on the default port is official for what the field holding it names (`role`): npm serves its index
// and its files from its hosts at any path. For PyPI an index field is official only at pypi.org's /simple, any other field only
// on the file host, and a find-links page never, since pip takes every link it finds on one.
function isOfficial(ecosystem, text, url, role) {
  if (url.port !== "") return false;
  if (ecosystem !== "PyPI") return (OFFICIAL_HOSTS[ecosystem] ?? []).includes(url.hostname);
  if (role === "find-links") return false;
  if (role === "index") return PYPI_INDEX.test(withLowerCaseAuthority(text));
  return url.hostname === PYPI_FILE_HOST;
}

// An http(s) address: the official registry, a mirror (host), plain http, or one archive on another host (url).
function webUrl(ecosystem, text, direct, role) {
  if (!prefixOf(text, ["https:", "http:"])) return null;
  const url = parseUrl(text);
  if (!url || !url.host) return UNREADABLE;
  const origin = `${url.protocol}//${url.host}`;
  if (url.protocol === "http:") return { expected: false, kind: "http", address: origin };
  if (isOfficial(ecosystem, text, url, role)) return EXPECTED;
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

// ecosystem: "npm" or "PyPI"; text: the raw source, without the package name; direct: true when the field pins one archive; role:
// "index" when the field names a package index, "find-links" when it names a page or folder pip takes links from.
function classifySource(ecosystem, text, { direct = false, role } = {}) {
  if (typeof text !== "string" || text === "") return UNREADABLE;
  if (isLocal(text)) return LOCAL;
  return gitSource(text) ?? webUrl(ecosystem, text, direct, role) ?? UNREADABLE;
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

// An alias npm installs from the registry: what follows the aliased name is a range or a tag, never another protocol or a path.
function isRegistryAlias(value) {
  const spec = value.slice("npm:".length);
  const at = spec.indexOf("@", 1);
  const range = at < 0 ? "" : spec.slice(at + 1);
  return !range.includes(":") && !range.includes("/");
}

// A value that would be a path to npm only because of what it starts with: whitespace, or the `=` of a range.
const SPACE_OR_EQUALS = /^[\s=]/;

// An archive's file name as npm reads one: a value ending so is a file, whatever else it holds.
const NPM_FILE_NAME = /[.](?:tgz|tar\.gz|tar)$/i;
// A file spec as npm reads one before any other form: a dot, `~/`, `/` or a drive letter at the start.
const NPM_FILE_SPEC = /^(?:[.]|~[/]|[/]|[a-zA-Z]:)/;

// A repository on GitHub, GitLab, Bitbucket, sourcehut or GitHub Gist named by an http(s) URL, as npm's hosted-git-info reads one:
// GitHub `/<u>/<r>` or `/<u>/<r>/tree/<committish>`, GitLab `/<group>/…/<r>` with no `/-/` part, Bitbucket `/<u>/<r>` unless it
// is a `/get/` download, sourcehut `/~<u>/<r>` unless it is an `/archive/`, a gist `/[<u>/]<id>` unless it is a `/raw/` file
// (shown as `https://gist.github.com/<id>`, as the `gist:` shorthand is). Shown as the repository, with a commit from the fragment
// or the tree. null for any other URL, such as an archive.
function hostedRepository(text) {
  if (!prefixOf(text, ["https:", "http:"])) return null;
  const url = parseUrl(text);
  if (!url || !url.host) return null;
  const host = url.hostname.startsWith("www.") ? url.hostname.slice(4) : url.hostname;
  const segments = url.pathname.slice(1).split("/");
  let repository = segments.slice(0, 2);
  let committish = "";
  if (host === "github.com") {
    if (segments[2] && segments[2] !== "tree") return null;
    if (segments[2] === "tree") committish = segments.slice(3).join("/");
  } else if (host === "gitlab.com") {
    if (url.pathname.includes("/-/") || url.pathname.includes("/archive.tar.gz")) return null;
    repository = segments;
  } else if (host === "bitbucket.org") {
    if (segments[2] === "get") return null;
  } else if (host === "git.sr.ht") {
    if (segments[2] === "archive") return null;
  } else if (host === "gist.github.com") {
    if (segments[2] === "raw" || segments.length > 3) return null;
    const id = segments[1] || segments[0];
    if (!NAME_SEGMENT.test(id)) return null;
    return gitResult(text, `https://gist.github.com/${id}`);
  } else return null;
  if (repository.length < 2 || !isRepositoryPath(repository, host === "git.sr.ht")) return null;
  const address = `${url.protocol}//${url.host}/${repository.join("/")}`;
  const commit = commitFrom(text) ?? (OBJECT_ID.test(committish) ? committish : null);
  return commit ? { expected: false, kind: "git", address, commit } : { expected: false, kind: "git", address };
}

// `u/r` or `u/r#ref`: GitHub shorthand, exactly one `/`, not a scoped name.
function isGithubShorthand(value) {
  const segments = withoutQuery(value).split("/");
  return segments.length === 2 && segments.every((s) => NAME_SEGMENT.test(s)) && !value.startsWith("@");
}

// A package.json dependency value, in the order the package managers read it. A file spec npm reads first (a dot, `~/`, `/` or a
// drive letter at the start) is local; an http(s) URL naming a GitHub, GitLab or Bitbucket repository is git; a git or http(s)
// value it cannot read is reported with a fixed text in place of the address; a value npm reads as a path (a slash, or `\`, in a
// value that is no git form, or an archive's file name) is local, unless it starts with whitespace or `=`, which makes it a source
// it could not read, as does an alias of anything but a registry range; any other value is a version range or a tag, so the
// registry: this never answers unreadable.
function classifyManifestValue(ecosystem, value) {
  let resolution = value;
  for (let depth = 0; resolution.startsWith("patch:"); depth++) {
    if (depth === PATCH_DEPTH) return UNREAD_SOURCE;
    resolution = patchedResolution(resolution);
    if (resolution === null) return UNREAD_SOURCE;
  }
  if (NPM_FILE_SPEC.test(resolution) || isLocal(resolution)) return LOCAL;
  if (prefixOf(resolution, ["npm:"])) return isRegistryAlias(resolution) ? EXPECTED : UNREAD_SOURCE;
  if (resolution.startsWith("jsr:")) return { expected: false, kind: "host", address: "https://npm.jsr.io" };
  if (resolution.startsWith("exec:")) return { expected: false, kind: "url", address: null, text: EXEC_TEXT };
  const gitText = isGithubShorthand(resolution) ? `github:${resolution}` : resolution;
  const git = gitSource(gitText);
  if (git && git.kind === "git") return git;
  if (git || prefixOf(resolution, GIT_FORMS)) return { expected: false, kind: "git", address: null, text: UNREAD_GIT_TEXT };
  const hosted = hostedRepository(resolution);
  if (hosted) return hosted;
  const web = webUrl(ecosystem, resolution, true);
  if (web && !web.unreadable) return web;
  if (web) return { expected: false, kind: prefixOf(resolution, ["https:"]) ? "url" : "http", address: null, text: UNREAD_ADDRESS_TEXT };
  if (resolution.includes("/") || resolution.includes("\\") || NPM_FILE_NAME.test(resolution)) {
    return SPACE_OR_EQUALS.test(resolution) ? UNREAD_SOURCE : LOCAL;
  }
  return EXPECTED;
}

module.exports = { classifySource, classifyManifestValue, commitFrom, LOCAL, OFFICIAL_HOSTS, NAME_SEGMENT, UNREADABLE };

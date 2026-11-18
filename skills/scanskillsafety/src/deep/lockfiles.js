// ABOUTME: Reads the packages a target pulls in from its lockfiles (npm, Yarn, pnpm, Poetry, uv, pinned requirements), or their
// ABOUTME: names from its manifests when it has none; formats it cannot read are listed, never ignored.
"use strict";

const { OBJECT_ID, baseName, isObject, isVendored } = require("./util");
const { classifySource, LOCAL, NAME_SEGMENT, UNREADABLE } = require("./packageSources");

const normalisePyPI = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");
const unquote = (s) => s.replace(/^["']|["']$/g, "");
const linesOf = (text) => text.split(/\r?\n/);
const leadingSpaces = (line) => {
  let n = 0;
  while (line[n] === " ") n++;
  return n;
};

// A carriage return that does not end a line, or a tab: YAML reads either differently from a reader that goes line by line.
const LONE_CR_OR_TAB = /\t|\r(?!\n)/;
// A name as pnpm and Yarn write their YAML fields: no quotes, escapes, tags, anchors or merge keys.
const PLAIN_NAME = /^[A-Za-z]+$/;

// A `key: value` or `key:` line's key, as written, and its value, both trimmed; null for any other text.
function fieldOf(text) {
  const sep = text.indexOf(": ");
  if (sep > 0) return { key: text.slice(0, sep).trim(), value: text.slice(sep + 2).trim() };
  return text.length > 1 && text.endsWith(":") ? { key: text.slice(0, -1).trim(), value: "" } : null;
}

const startsWithAny = (value, chars) => value !== "" && chars.includes(value[0]);

class Unreadable extends Error {}
const unsupportedVersion = (version) => new Unreadable(`lockfileVersion ${version ?? "(none)"} is not a version it can read`);

// A lockfile with entries but no package read from them is one it could not make out, not one that holds nothing.
function found(packages, entries, reason = "no packages found in it") {
  if (entries > 0 && packages.length === 0) throw new Unreadable(reason);
  return packages;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Unreadable("not valid JSON");
  }
}

const isWhitespace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
// An integer-like key is listed by Object.entries before every other key, out of document order.
const isIndexKey = (key) => /^(0|[1-9]\d{0,8})$/.test(key);
const KEY_LOOKAHEAD = 1000;

// Every key of valid JSON text whose value is an object, decoded, with its line, in document order: one pass over the text.
function objectKeys(text) {
  const keys = [];
  let line = 1;
  let i = 0;
  const skipWhitespace = () => {
    while (i < text.length && isWhitespace(text[i])) if (text[i++] === "\n") line++;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") line++;
    if (c !== '"') {
      i++;
      continue;
    }
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    const raw = text.slice(start, ++i);
    skipWhitespace();
    if (text[i] !== ":") continue;
    i++;
    skipWhitespace();
    if (text[i] === "{") keys.push({ key: JSON.parse(raw), line });
  }
  return keys;
}

// The line of each `"key": {` in a JSON lockfile, asked for in document order, so a name that appears twice gets the right one.
// A key not found close ahead, or one out of document order, has no line rather than a wrong one.
function jsonKeyLines(text) {
  const keys = objectKeys(text);
  let cursor = 0;
  return (key) => {
    if (isIndexKey(key)) return null;
    const end = Math.min(keys.length, cursor + KEY_LOOKAHEAD);
    for (let i = cursor; i < end; i++) {
      if (keys[i].key === key) {
        cursor = i + 1;
        return keys[i].line;
      }
    }
    return null;
  };
}

// An npm alias (`npm:real-name@1.2.3`) names the package that is really installed.
function npmAlias(version) {
  const match = /^npm:(@?[^@]+)@(.+)$/.exec(version);
  return match ? { name: match[1], version: match[2] } : null;
}

// A version as npm writes one for a package it installed by version. Any other npm version text is never kept or sent to OSV:
// in a version 1 `version` (a git URL, a tarball URL, `file:`) it is the package's source; anywhere else it is no version at all.
const SEMVER = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$/;
// An entry whose source a reader could not make out, whatever the classifier would say.
const UNREADABLE_ENTRY = Object.freeze({ classified: UNREADABLE });
// An entry it cannot even name: reported as a source it could not read, with nothing from it kept, so it is never left out.
const unnamedEntry = (line) => ({ name: null, version: null, line, ...UNREADABLE_ENTRY });

// Where a version 2 or 3 entry comes from: a bundled entry comes inside its parent, so its own source is not read; one with no
// `resolved` came from whatever registry the install used.
function npmSource(entry) {
  if (entry.inBundle === true) return {};
  return entry.resolved === undefined ? { recordsHost: false } : { source: entry.resolved };
}

// A version 1 entry: an alias by its real name; a version that is a source is classified from it and not kept, so a credential
// in it is never shown.
function npmV1Entry(name, entry) {
  const named = npmAlias(entry.version) ?? { name, version: entry.version };
  if (!SEMVER.test(named.version)) return { name: named.name, version: null, source: named.version, direct: true };
  return { ...named, ...(entry.resolved === undefined ? {} : { source: entry.resolved }) };
}

function readNpmLock(text) {
  const json = parseJson(text);
  const version = json && json.lockfileVersion;
  const lineOf = jsonKeyLines(text);
  if (version === 2 || version === 3) {
    // Keys without node_modules/ are the project's own workspace folders.
    const entries = Object.entries(isObject(json.packages) ? json.packages : {}).filter(([key, entry]) => key.includes("node_modules/") && !(entry && entry.link));
    const packages = entries
      .filter(([, entry]) => entry && typeof entry.version === "string")
      .map(([key, entry]) => ({
        name: typeof entry.name === "string" ? entry.name : key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length),
        version: entry.version,
        line: lineOf(key),
        ...npmSource(entry),
      }));
    return found(packages, entries.length);
  }
  if (version === 1) {
    const dependenciesOf = (entry) => Object.entries(isObject(entry.dependencies) ? entry.dependencies : {});
    const out = [];
    // Depth first in document order, with a stack of the entries still to visit at each level, so nesting cannot run out of stack.
    const stack = [dependenciesOf(json).reverse()];
    while (stack.length > 0) {
      const [name, entry] = stack[stack.length - 1].pop() ?? [];
      if (name === undefined) {
        stack.pop();
        continue;
      }
      if (!isObject(entry) || typeof entry.version !== "string") continue;
      out.push({ ...npmV1Entry(name, entry), line: lineOf(name) });
      stack.push(dependenciesOf(entry).reverse());
    }
    return found(out, dependenciesOf(json).length);
  }
  throw unsupportedVersion(version);
}

// A Yarn spec's package name: the text before the first `@` past the start, or the real name an `npm:` alias points at.
function yarnSpecName(spec) {
  const at = spec.indexOf("@", 1);
  if (at < 0) return spec;
  const range = spec.slice(at + 1);
  if (range.startsWith("npm:")) {
    const aliasAt = range.indexOf("@", 5);
    if (aliasAt > 0) return range.slice(4, aliasAt);
  }
  return spec.slice(0, at);
}

const CODELOAD = "https://codeload.github.com/";

// A GitHub repository at one commit, shown as the repository, when its user, name and commit are ones it can read; null otherwise.
function githubCommit(user, repo, commit) {
  if (!NAME_SEGMENT.test(user) || !NAME_SEGMENT.test(repo) || !OBJECT_ID.test(commit)) return null;
  return { expected: false, kind: "git", address: `https://github.com/${user}/${repo}`, commit };
}

// A GitHub shorthand that Yarn classic resolved to a codeload tarball (`https://codeload.github.com/u/r/tar.gz/<sha>`): a git
// source, shown as the repository, with the commit from the path. Anything else on codeload is left to the classifier.
function codeloadSource(resolved) {
  if (!resolved.startsWith(CODELOAD)) return null;
  const segments = resolved.slice(CODELOAD.length).split("/", 5);
  if (segments.length !== 4 || segments[2] !== "tar.gz") return null;
  return githubCommit(segments[0], segments[1], segments[3]);
}

// The resolution in a Berry `name@<resolution>`: the text after the first `@` past the start, so a scoped name stays whole; null
// when there is none.
function afterName(text) {
  const at = text.indexOf("@", 1);
  return at < 0 ? null : text.slice(at + 1);
}

// The resolution a Berry `patch:` patches, URL-decoded, without the patch after `#` or the package name before `@`; null when it
// cannot be decoded or names no package.
function berryPatched(resolution) {
  let decoded;
  try {
    decoded = decodeURIComponent(resolution.slice("patch:".length).split("#", 1)[0]);
  } catch {
    return null;
  }
  return afterName(decoded);
}

// A Berry resolution that is not a patch: `npm:` records no host; an http(s) address with `#commit=` is a git repository; any
// other http(s) address pins one archive; the rest (git URLs, local protocols, a patch inside a patch) is left to the classifier.
function berryResolutionSource(resolution) {
  if (resolution.startsWith("npm:")) return { recordsHost: false };
  if (!resolution.startsWith("https:") && !resolution.startsWith("http:")) return { source: resolution };
  const hash = resolution.indexOf("#");
  if (hash >= 0 && resolution.startsWith("commit=", hash + 1)) return { source: `git+${resolution}` };
  return { source: resolution, direct: true };
}

// The source of a Berry `resolution:` value (`name@<resolution>`); a patch is classified by the resolution it patches.
function berrySource(value) {
  const resolution = afterName(value);
  if (resolution === null) return UNREADABLE_ENTRY;
  if (!resolution.startsWith("patch:")) return berryResolutionSource(resolution);
  const patched = berryPatched(resolution);
  return patched === null ? UNREADABLE_ENTRY : berryResolutionSource(patched);
}

// An address a lockfile records: a codeload tarball is the GitHub repository it came from; any other is left to the classifier.
function addressSource(address, direct = false) {
  const codeload = codeloadSource(address);
  return codeload ? { classified: codeload } : { source: address, direct };
}

// An entry with no source line: with a version, from whatever registry the install used; with neither, one it cannot read.
const noOrigin = (entry) => (entry.version === undefined ? UNREADABLE_ENTRY : {});

const YARN_LAYOUT = "not laid out as Yarn writes it";
// The first character of a YAML tag, anchor or alias.
const YAML_NODE_PROPERTY = "!&*";

// A Berry line YAML would read differently from the way it is read here: one with an escape, a key or value that starts with a
// tag, anchor or alias, a merge key, or a 2-space field whose name is not a plain name.
function berryLineOdd(line) {
  const indent = leadingSpaces(line);
  const text = line.slice(indent);
  const field = fieldOf(text);
  const key = field ? field.key : text;
  if (text.includes("\\") || key.startsWith("<<") || startsWithAny(key, YAML_NODE_PROPERTY)) return true;
  if (field && startsWithAny(field.value, YAML_NODE_PROPERTY)) return true;
  return indent === 2 && !PLAIN_NAME.test(key);
}

// Each entry runs from its header to the next header or the end of the file, so its source, on a line after its version, is
// carried with it. A header that does not end in `:` is an entry it cannot name; an entry is never left out for lacking a version.
// A Berry file is YAML: a lone carriage return or a tab makes it one it cannot read, a header YAML would read differently is an
// entry it cannot name, and any other such line makes its entry's source one it cannot read.
function readYarnLock(text) {
  const lines = linesOf(text);
  const berry = lines.includes("__metadata:");
  if (!berry && !text.includes("# yarn lockfile v1")) throw new Unreadable("not a Yarn lockfile it can read");
  if (berry && LONE_CR_OR_TAB.test(text)) throw new Unreadable(YARN_LAYOUT);
  const versionLine = berry ? /^ {2}version: "?([^"\s]+)"?$/ : /^ {2}version "([^"]+)"$/;
  const sourceLine = berry ? "  resolution: " : "  resolved ";
  const sourceOf = berry ? berrySource : addressSource;
  const out = [];
  let entry = null;
  let entries = 0;
  const finish = () => {
    if (!entry) return;
    const origin = entry.unreadable ? UNREADABLE_ENTRY : entry.origin ?? noOrigin(entry);
    out.push({ name: entry.name, line: entry.line, version: entry.version ?? null, ...origin });
    entry = null;
  };
  lines.forEach((line, i) => {
    if (/^[^\s#]/.test(line)) {
      finish();
      const spec = unquote(line.replace(/:$/, "").split(/,\s*/)[0]);
      const skipped = spec === "__metadata" || spec.slice(spec.indexOf("@", 1)).includes("@workspace:");
      const named = !skipped && line.endsWith(":") && !(berry && berryLineOdd(line));
      if (!skipped) entries++;
      if (!skipped && !named) out.push(unnamedEntry(i + 1));
      entry = named ? { name: yarnSpecName(spec), line: i + 1, unreadable: false } : null;
      return;
    }
    if (!entry) return;
    if (berry && berryLineOdd(line)) entry.unreadable = true;
    const match = versionLine.exec(line);
    if (match && entry.version === undefined) entry.version = match[1];
    else if (line.startsWith(sourceLine)) entry.origin = sourceOf(unquote(line.slice(sourceLine.length)));
  });
  finish();
  return found(out, entries);
}

const PNPM_VERSIONS = ["6.0", "6.1", "9.0"];

// A `name: value` field with a plain name and a value that starts like a plain scalar.
const plainField = (field) =>
  field !== null && PLAIN_NAME.test(field.key) && field.value !== "" && !ODD_VALUE_START.includes(field.value[0]);

// The fields of a one-line flow map as pnpm writes one (`{integrity: sha512-…, tarball: https://…}`), split at every comma as
// YAML splits plain values; null when a key is not a plain name, a value does not start like a plain scalar, a name is given
// twice or a collection is nested inside, all of which YAML would read differently.
function flowMapFields(text) {
  const body = text.slice(1, -1);
  if (/[{}[\]]/.test(body)) return null;
  const fields = new Map();
  if (body.trim() === "") return fields;
  for (const part of body.split(",")) {
    const field = fieldOf(part.trim());
    if (!plainField(field) || fields.has(field.key)) return null;
    fields.set(field.key, field.value);
  }
  return fields;
}

const PNPM_GITHUB_KEY = "github.com/";
// The only fields of an entry read besides its resolution.
const PNPM_ENTRY_FIELDS = ["name", "version"];
const PNPM_LAYOUT = "not laid out as pnpm writes it";
// How a resolution value never starts: like a YAML collection, anchor, alias, block scalar, tag, comment or quoted string.
const ODD_VALUE_START = "{[&*|>!#'\"%@`";
// How a top-level value never starts; a quoted scalar (`lockfileVersion: '9.0'`) is allowed.
const ODD_TOP_VALUE_START = "{[&*|>!#%@`";
const COLLECTION_OR_QUOTE_CLOSERS = new Map([["{", "}"], ["[", "]"], ['"', '"'], ["'", "'"]]);
// A URL scheme at the start of a key's version (`git+ssh:`, `https:`, `file:`): one class, so it cannot backtrack.
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// A version 6 `github.com/u/r/<sha>` key: a GitHub repository at that commit; null for any other key.
function pnpmGithubKey(depPath) {
  if (!depPath.startsWith(PNPM_GITHUB_KEY)) return null;
  const segments = depPath.slice(PNPM_GITHUB_KEY.length).split("/", 4);
  return segments.length === 3 ? githubCommit(...segments) : null;
}

// A version 6 tarball or git key, an address without its protocol: its first `/` segment looks like a host (a `.`, no `@`).
function isAddressKey(depPath) {
  const host = depPath.split("/", 1)[0];
  return host.length < depPath.length && host.includes(".") && !host.includes("@");
}

// Where a key's version starts after the `@` that ends its name: after the name line's name when there is one, otherwise after
// the first `@` past the start, so a scoped name and a `git+ssh://git@…` key split right; -1 when there is no such `@`.
function keyVersionAt(depPath, named) {
  if (named !== undefined) return depPath.startsWith(`${named}@`) ? named.length + 1 : -1;
  const at = depPath.indexOf("@", 1);
  return at < 0 ? -1 : at + 1;
}

// The source a key itself names: an address key (a GitHub repository at a commit, or a tarball read as https), or a version that
// is an address (git, tarball, `file:`), which pins that one package; null when the version is a plain version.
function pnpmKeySource(depPath, keyVersion) {
  if (keyVersion === undefined) {
    const github = pnpmGithubKey(depPath);
    return github ? { classified: github } : null;
  }
  return SEMVER.test(keyVersion) ? null : addressSource(keyVersion, true);
}

// A git resolution: the repository, an http(s) one marked as git, at the commit, which is kept only when it is a commit id.
function pnpmGitSource(resolution) {
  const repo = resolution.get("repo") ?? "";
  const commit = resolution.get("commit") ?? "";
  const source = repo.startsWith("https:") || repo.startsWith("http:") ? `git+${repo}` : repo;
  return OBJECT_ID.test(commit) ? { source, commit } : { source };
}

// Where a pnpm entry comes from (keyVersion is undefined for an address key), the first that applies:
// - a `directory` resolution is local; a `git` one is its repository; one of any other type is one it cannot read;
// - the key, when it names a source;
// - the resolution's tarball;
// - an address key, read as https;
// - with only an integrity, no host.
function pnpmSource(depPath, keyVersion, resolution) {
  const type = resolution.get("type");
  if (type === "directory") return { classified: LOCAL };
  if (type === "git") return pnpmGitSource(resolution);
  if (type !== undefined) return UNREADABLE_ENTRY;
  const fromKey = pnpmKeySource(depPath, keyVersion);
  if (fromKey) return fromKey;
  const tarball = resolution.get("tarball");
  if (tarball !== undefined) return addressSource(tarball);
  return keyVersion === undefined ? addressSource(`https://${depPath}`) : { recordsHost: false };
}

// A pnpm package entry. The key loses a leading `/` and the `(…)` peer suffix. An entry with a `name:` line is named by it, and
// its key must be `<name>@<version>` or an address key, or its source is one it cannot read. Without one, the name before the
// version is taken only when the version is a version or starts with a scheme, so a key like `user:pw@host/…` never names the
// entry; an entry with no name (a key line it could not read among them) is one it cannot read, kept with no name or version, so
// a key can never hide where a package comes from. A version that is an address gives way to the entry's `version:` line.
function pnpmEntry({ key, line, fields, resolution, unreadable }) {
  if (key === null) return unnamedEntry(line);
  let depPath = key.startsWith("/") ? key.slice(1) : key;
  if (depPath.includes("(")) depPath = depPath.slice(0, depPath.indexOf("("));
  const named = fields.get("name");
  const address = isAddressKey(depPath);
  const at = address ? -1 : keyVersionAt(depPath, named);
  const keyVersion = at < 0 ? undefined : depPath.slice(at);
  const keyNamed = keyVersion !== undefined && (SEMVER.test(keyVersion) || SCHEME.test(keyVersion));
  const name = named ?? (keyNamed ? depPath.slice(0, at - 1) : undefined);
  if (name === undefined) return unnamedEntry(line);
  const version = keyVersion !== undefined && SEMVER.test(keyVersion) ? keyVersion : fields.get("version") ?? null;
  const readable = !unreadable && (address || keyVersion !== undefined);
  return { name, version, line, ...(readable ? pnpmSource(depPath, keyVersion, resolution) : UNREADABLE_ENTRY) };
}

// A 2-space line in packages: an entry key ending in `:`, or a line it cannot read as one, which still stands for an entry.
function pnpmEntryStart(line, lineNumber) {
  const match = /^ {2}(\S.*):$/.exec(line);
  const key = match ? unquote(match[1]) : null;
  const state = { field: null, inResolution: false, resolutionSeen: false, unreadable: false };
  return { key, line: lineNumber, fields: new Map(), resolution: new Map(), ...state };
}

// A `resolution:` value: nothing (its fields follow on the lines below) or a one-line flow map as pnpm writes one; any other shape
// (a comment, an anchor, a map split across lines) is one it cannot read.
function readResolution(entry, value) {
  const fields = value.startsWith("{") && value.endsWith("}") ? flowMapFields(value) : null;
  if (value === "") entry.inResolution = true;
  else if (fields) entry.resolution = fields;
  else entry.unreadable = true;
}

// A value that opens a collection or a quoted string and does not close it on the same line, so YAML reads on into the next.
function opensUnclosed(value) {
  const closer = COLLECTION_OR_QUOTE_CLOSERS.get(value[0]);
  return closer !== undefined && (value.length < 2 || !value.endsWith(closer));
}

// A 4-space field of an entry, its name a plain name, so `resolutions` is not `resolution` and a quoted, escaped, tagged or merge
// key is one it cannot read. `resolution`, given once, `name` and `version` are read; any other field is passed over with the
// lines below it. A value that is an anchor or an alias, or one left open at the end of the line, is one it cannot read.
function readPnpmField(entry, text) {
  const field = fieldOf(text);
  entry.inResolution = false;
  entry.field = field && PLAIN_NAME.test(field.key) ? field.key : null;
  if (entry.field === null || startsWithAny(field.value, "&*")) entry.unreadable = true;
  else if (entry.field === "resolution") {
    if (entry.resolutionSeen) entry.unreadable = true;
    entry.resolutionSeen = true;
    readResolution(entry, field.value);
  } else if (opensUnclosed(field.value)) entry.unreadable = true;
  else if (PNPM_ENTRY_FIELDS.includes(entry.field)) {
    if (field.value === "") entry.unreadable = true;
    else entry.fields.set(entry.field, unquote(field.value));
  }
}

// A line deeper than an entry's fields: passed over under a field other than `resolution`; under a block resolution, a 6-space
// plain `name: value` whose name is not given twice; anywhere else, or in any other shape, one it cannot read.
function readPnpmDeeperLine(entry, indent, text) {
  if (entry.field !== null && entry.field !== "resolution") return;
  const field = entry.inResolution && indent === 6 ? fieldOf(text) : null;
  if (plainField(field) && !entry.resolution.has(field.key)) entry.resolution.set(field.key, field.value);
  else entry.unreadable = true;
}

// A top-level line as pnpm writes one, and its name: `---`, or a plain name with no value, a scalar or an empty collection, and
// `packages` with no value. Anything else (a flow map or a comment or tag after `packages:`, an anchor, an alias, a merge key)
// means the file is not one it can read.
function pnpmTopLevelName(line) {
  if (line === "---") return null;
  const field = fieldOf(line);
  const value = field ? field.value : "";
  const plainValue = value === "{}" || value === "[]" || !startsWithAny(value, ODD_TOP_VALUE_START);
  if (!field || !PLAIN_NAME.test(field.key) || !plainValue || (field.key === "packages" && value !== "")) {
    throw new Unreadable(PNPM_LAYOUT);
  }
  return field.key;
}

// The file is read strictly, line by line, as pnpm writes it: comments and blank lines skipped; top-level names plain; in
// packages, entry keys at 2 spaces, their fields at 4 and a block resolution's fields at 6. A lone carriage return or a tab
// anywhere, a top-level line pnpm does not write, an indentation of 1, 3 or 5 spaces in packages, or any but 2 before its first
// entry, means the file is not one it can read.
function readPnpmLock(text) {
  const version = /^lockfileVersion: '?([^'\s]+)'?\s*$/m.exec(text)?.[1];
  if (!PNPM_VERSIONS.includes(version)) throw unsupportedVersion(version);
  if (LONE_CR_OR_TAB.test(text)) throw new Unreadable(PNPM_LAYOUT);
  const out = [];
  let inPackages = false;
  let entries = 0;
  let entry = null;
  const finish = () => {
    if (entry) out.push(pnpmEntry(entry));
    entry = null;
  };
  linesOf(text).forEach((rawLine, i) => {
    const line = rawLine.trimEnd();
    const indent = leadingSpaces(line);
    if (line === "" || line[indent] === "#") return;
    if (indent === 0) {
      finish();
      inPackages = pnpmTopLevelName(line) === "packages";
      return;
    }
    if (!inPackages) return;
    const odd = (indent < 6 && indent % 2 === 1) || (entry === null && indent !== 2);
    if (odd) throw new Unreadable(PNPM_LAYOUT);
    if (indent === 2) {
      finish();
      entries++;
      entry = pnpmEntryStart(line, i + 1);
    } else if (indent === 4) readPnpmField(entry, line.slice(4));
    else readPnpmDeeperLine(entry, indent, line.slice(indent));
  });
  finish();
  return found(out, entries);
}

// poetry.lock and uv.lock: each [[package]] block's name and version; a block whose source is editable or virtual is the project.
function readPackageBlocks(text) {
  const out = [];
  let block = null;
  let entries = 0;
  const finish = () => {
    if (block && !block.project) entries++;
    if (block && block.name && block.version && !block.project) out.push({ name: block.name, version: block.version, line: block.line });
    block = null;
  };
  linesOf(text).forEach((line, i) => {
    if (line.startsWith("[")) {
      finish();
      if (line.trim() === "[[package]]") block = { name: null, version: null, line: null, project: false };
      return;
    }
    if (!block) return;
    const name = /^name = "([^"]+)"/.exec(line);
    const version = /^version = "([^"]+)"/.exec(line);
    if (name && !block.name) Object.assign(block, { name: name[1], line: i + 1 });
    if (version && !block.version) block.version = version[1];
    if (/^source = \{ *(editable|virtual) *=/.test(line)) block.project = true;
  });
  finish();
  return found(out, entries);
}

const PINNED_REQUIREMENT = /^([A-Za-z0-9._-]+)(\[[^\]]*\])?==([^\s;#]+)/;

function readRequirements(text) {
  const out = [];
  let entries = 0;
  linesOf(text).forEach((line, i) => {
    if (/^\s*[^\s#-]/.test(line)) entries++;
    const match = PINNED_REQUIREMENT.exec(line);
    if (match) out.push({ name: match[1], version: match[3], line: i + 1 });
  });
  return found(out, entries, "no pinned versions in it");
}

const LOCKFILES = new Map([
  ["package-lock.json", { ecosystem: "npm", read: readNpmLock }],
  ["npm-shrinkwrap.json", { ecosystem: "npm", read: readNpmLock }],
  ["yarn.lock", { ecosystem: "npm", read: readYarnLock }],
  ["pnpm-lock.yaml", { ecosystem: "npm", read: readPnpmLock }],
  ["poetry.lock", { ecosystem: "PyPI", read: readPackageBlocks }],
  ["uv.lock", { ecosystem: "PyPI", read: readPackageBlocks }],
]);
const REQUIREMENTS = { ecosystem: "PyPI", read: readRequirements };
const NOT_CHECKED = new Set(["Cargo.lock", "go.sum", "Gemfile.lock"]);

const lockfileKind = (p) => LOCKFILES.get(baseName(p)) ?? (/^requirements.*\.txt$/.test(baseName(p)) ? REQUIREMENTS : null);
// A lockfile proper, read here for OSV or one it has no support for. A requirements file is not one: besides its pins it can name
// package indexes and git sources, which OSV never sees.
const isLockfile = (p) => LOCKFILES.has(baseName(p)) || NOT_CHECKED.has(baseName(p));

function packageJsonNames(text) {
  const json = parseJson(text);
  const sections = ["dependencies", "optionalDependencies", "peerDependencies"];
  return sections.flatMap((section) => (isObject(json) && isObject(json[section]) ? Object.keys(json[section]) : []));
}

// The quoted strings of a TOML array starting at `from`, up to its closing bracket outside quotes (comments skipped), and where
// the array ends.
function quotedStrings(text, from) {
  const strings = [];
  let quote = null;
  let current = "";
  let i = from;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        strings.push(current);
        quote = null;
        current = "";
      } else current += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") {
      while (i + 1 < text.length && text[i + 1] !== "\n") i++;
    } else if (c === "]") break;
  }
  return { strings, end: i };
}

const TABLE_HEADER = /^\[\[?([^[\]]+)\]\]?\s*(#.*)?$/;

function pyprojectNames(text) {
  const names = [];
  let table = null;
  // Lines are walked with their offsets, so a dependencies list is read once from where it starts and the lines it spans skipped.
  const lineBreak = /\r?\n/g;
  let start = 0;
  let readUpTo = 0;
  while (start <= text.length) {
    const match = lineBreak.exec(text);
    const end = match ? match.index : text.length;
    const line = text.slice(start, end);
    const lineStart = start;
    start = match ? lineBreak.lastIndex : text.length + 1;
    if (lineStart < readUpTo) continue;
    const header = TABLE_HEADER.exec(line);
    if (header) table = header[1].trim();
    else if (table === "project" && /^dependencies\s*=\s*\[/.test(line)) {
      const list = quotedStrings(text, lineStart + line.indexOf("[") + 1);
      readUpTo = list.end;
      names.push(...list.strings.map((requirement) => requirement.trim().split(/[<>=!~;[ (]/)[0]));
    } else if (table === "tool.poetry.dependencies") {
      const key = /^(["']?)([A-Za-z0-9._-]+)\1\s*=/.exec(line);
      if (key && key[2] !== "python") names.push(key[2]);
    }
  }
  return names.filter(Boolean);
}

const MANIFESTS = new Map([
  ["package.json", { ecosystem: "npm", names: packageJsonNames }],
  ["pyproject.toml", { ecosystem: "PyPI", names: pyprojectNames }],
]);

// What a reader makes of a file, or why it could not; input nested past what the reader can follow is said to be so.
function readSafely(read, text) {
  try {
    return { entries: read(text) };
  } catch (err) {
    if (err instanceof Unreadable) return { reason: err.message };
    if (err instanceof RangeError) return { reason: "too deeply nested" };
    throw err;
  }
}

const UNREADABLE_SOURCE_REASON = "a package source it could not read";

// What a reader's entry is: the reader's own verdict when it decided, the classifier's on its source, or the registry when it
// names no source. A commit the reader found wins over one in the text, and only a git source keeps one.
function verdictOf(ecosystem, entry) {
  if (entry.classified) return entry.classified;
  if (entry.source === undefined) return { expected: true };
  const verdict = classifySource(ecosystem, entry.source, { direct: entry.direct === true });
  return verdict.kind === "git" && entry.commit ? { ...verdict, commit: entry.commit } : verdict;
}

// An npm entry whose version is not semver: the text is never kept or sent to OSV, and an entry with no source of its own is one
// it could not read.
function withCheckedVersion(ecosystem, entry) {
  if (ecosystem !== "npm" || entry.version === null || SEMVER.test(entry.version)) return entry;
  const ownSource = entry.source !== undefined || entry.classified !== undefined;
  return { ...entry, version: null, ...(ownSource ? {} : UNREADABLE_ENTRY) };
}

const packageName = (ecosystem, name) => (ecosystem === "PyPI" ? normalisePyPI(name) : name);

// A package from a source other than the official registry, as read from one file; an unreadable source has no address.
function sourcedPackage(ecosystem, file, entry, verdict) {
  const item = { ecosystem, file, line: entry.line, name: packageName(ecosystem, entry.name), version: entry.version };
  if (verdict.unreadable) return { ...item, kind: "unreadable", address: null };
  Object.assign(item, { kind: verdict.kind, address: verdict.address });
  if (verdict.kind === "git" && verdict.commit) item.commit = verdict.commit;
  if (verdict.text) item.text = verdict.text;
  return item;
}

// One lockfile's entries sorted by source: those from the official registry, those from anywhere else (local ones dropped), and
// whether any source could not be read.
function classifyEntries(ecosystem, file, entries) {
  const registry = [];
  const sourced = [];
  let unreadable = false;
  for (const readEntry of entries) {
    const entry = withCheckedVersion(ecosystem, readEntry);
    const verdict = verdictOf(ecosystem, entry);
    if (verdict.expected) registry.push(entry);
    else if (verdict.kind !== "local") {
      sourced.push(sourcedPackage(ecosystem, file, entry, verdict));
      unreadable ||= verdict.unreadable === true;
    }
  }
  return { registry, sourced, unreadable };
}

// files: the text files read; leftOut: the files left out of that list with the reason, so a lockfile among them is said to be
// unchecked rather than missed. packages are those from the official registry, de-duplicated, for OSV; sourced lists every one
// from elsewhere, file by file, before any de-duplication, so a mirror's copy is reported whichever file names the package first.
function readPackages(files, leftOut = []) {
  const result = { packages: [], namesOnly: [], couldNotRead: [], notChecked: [], sourced: [], notRecorded: [] };
  const seen = new Set();
  const add = (ecosystem, file, { name, version, line }) => {
    const pkg = { ecosystem, name: packageName(ecosystem, name), version, file, line };
    const key = `${pkg.ecosystem}\0${pkg.name}\0${pkg.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.packages.push(pkg);
  };
  const ownFiles = files.filter((f) => !isVendored(f.path));
  const locked = new Set();
  for (const f of ownFiles) {
    if (NOT_CHECKED.has(baseName(f.path))) result.notChecked.push(f.path);
    const kind = lockfileKind(f.path);
    if (!kind) continue;
    locked.add(kind.ecosystem);
    const read = readSafely(kind.read, f.text);
    if (read.reason) {
      result.couldNotRead.push({ file: f.path, reason: read.reason });
      continue;
    }
    const { registry, sourced, unreadable } = classifyEntries(kind.ecosystem, f.path, read.entries);
    for (const entry of registry) add(kind.ecosystem, f.path, entry);
    for (const item of sourced) result.sourced.push(item);
    if (unreadable) result.couldNotRead.push({ file: f.path, reason: UNREADABLE_SOURCE_REASON });
  }
  const ownLeftOut = leftOut.filter((l) => !isVendored(l.path));
  result.notChecked.push(...ownLeftOut.filter((l) => NOT_CHECKED.has(baseName(l.path))).map((l) => l.path));
  for (const f of ownLeftOut.filter((l) => lockfileKind(l.path))) {
    locked.add(lockfileKind(f.path).ecosystem);
    result.couldNotRead.push({ file: f.path, reason: `${f.reason}, not checked` });
  }
  for (const f of ownFiles) {
    const manifest = MANIFESTS.get(baseName(f.path));
    if (!manifest || locked.has(manifest.ecosystem)) continue;
    const read = readSafely(manifest.names, f.text);
    if (read.reason) {
      result.couldNotRead.push({ file: f.path, reason: read.reason });
      continue;
    }
    result.namesOnly.push(f.path);
    for (const name of read.entries) add(manifest.ecosystem, f.path, { name, version: null, line: null });
  }
  return result;
}

module.exports = { readPackages, isLockfile };

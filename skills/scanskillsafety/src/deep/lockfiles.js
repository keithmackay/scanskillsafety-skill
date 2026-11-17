// ABOUTME: Reads the packages a target pulls in from its lockfiles (npm, Yarn, pnpm, Poetry, uv, pinned requirements), or their
// ABOUTME: names from its manifests when it has none; formats it cannot read are listed, never ignored.
"use strict";

const { OBJECT_ID, baseName, isObject, isVendored } = require("./util");
const { classifySource, LOCAL, NAME_SEGMENT, UNREADABLE } = require("./packageSources");

const normalisePyPI = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");
const unquote = (s) => s.replace(/^["']|["']$/g, "");
const linesOf = (text) => text.split(/\r?\n/);

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

function yarnClassicSource(resolved) {
  const codeload = codeloadSource(resolved);
  return codeload ? { classified: codeload } : { source: resolved };
}

// Each entry runs from its header to the next header or the end of the file, so its source, on a line after its version, is
// carried with it.
function readYarnLock(text) {
  const lines = linesOf(text);
  const berry = lines.includes("__metadata:");
  if (!berry && !text.includes("# yarn lockfile v1")) throw new Unreadable("not a Yarn lockfile it can read");
  const versionLine = berry ? /^ {2}version: "?([^"\s]+)"?$/ : /^ {2}version "([^"]+)"$/;
  const sourceLine = berry ? "  resolution: " : "  resolved ";
  const sourceOf = berry ? berrySource : yarnClassicSource;
  const out = [];
  let entry = null;
  let entries = 0;
  const finish = () => {
    if (entry && entry.version !== undefined) out.push({ name: entry.name, line: entry.line, version: entry.version, ...entry.origin });
    entry = null;
  };
  lines.forEach((line, i) => {
    if (/^[^\s#]/.test(line)) {
      finish();
      const spec = unquote(line.replace(/:$/, "").split(/,\s*/)[0]);
      const skipped = spec === "__metadata" || spec.slice(spec.indexOf("@", 1)).includes("@workspace:");
      if (!skipped) entries++;
      entry = skipped || !line.endsWith(":") ? null : { name: yarnSpecName(spec), line: i + 1 };
      return;
    }
    if (!entry) return;
    const match = versionLine.exec(line);
    if (match && entry.version === undefined) entry.version = match[1];
    else if (line.startsWith(sourceLine)) entry.origin = sourceOf(unquote(line.slice(sourceLine.length)));
  });
  finish();
  return found(out, entries);
}

const PNPM_VERSIONS = ["6.0", "6.1", "9.0"];

// One `name: value` field added to a Map, so an input name is never taken for an object property.
function addField(fields, text) {
  const colon = text.indexOf(": ");
  if (colon > 0) fields.set(unquote(text.slice(0, colon).trim()), unquote(text.slice(colon + 2).trim()));
}

// The fields of a one-line flow map (`{a: 1, b: 'x, y'}`), split at commas outside quotes in one pass.
function flowMapFields(text) {
  const fields = new Map();
  const body = text.trim().replace(/^\{|\}$/g, "");
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === ",") {
      addField(fields, body.slice(start, i));
      start = i + 1;
    }
  }
  addField(fields, body.slice(start));
  return fields;
}

const PNPM_GITHUB_KEY = "github.com/";

// A version 6 `github.com/u/r/<sha>` key: a GitHub repository at that commit; null for any other key.
function pnpmGithubKey(depPath) {
  if (!depPath.startsWith(PNPM_GITHUB_KEY)) return null;
  const segments = depPath.slice(PNPM_GITHUB_KEY.length).split("/", 4);
  return segments.length === 3 ? githubCommit(...segments) : null;
}

// The source a key itself names: a GitHub key with no name, or a key whose version is an address (git, tarball, `file:`), which
// pins that one package; null when the key is a plain name and version.
function pnpmKeySource(depPath, keyVersion) {
  if (keyVersion === undefined) {
    const github = pnpmGithubKey(depPath);
    return github ? { classified: github } : null;
  }
  if (SEMVER.test(keyVersion)) return null;
  const codeload = codeloadSource(keyVersion);
  return codeload ? { classified: codeload } : { source: keyVersion, direct: true };
}

// A git resolution: the repository, an http(s) one marked as git, at the commit, which is kept only when it is a commit id.
function pnpmGitSource(resolution) {
  const repo = resolution.get("repo") ?? "";
  const commit = resolution.get("commit") ?? "";
  const source = repo.startsWith("https:") || repo.startsWith("http:") ? `git+${repo}` : repo;
  return OBJECT_ID.test(commit) ? { source, commit } : { source };
}

// Where a pnpm entry comes from: a directory is local; a git resolution is its repository; a resolution of another type is one it
// cannot read; otherwise the key when it names a source, then the resolution's tarball; with only an integrity, no host.
function pnpmSource(depPath, keyVersion, resolution) {
  const type = resolution.get("type");
  if (type === "directory") return { classified: LOCAL };
  if (type === "git") return pnpmGitSource(resolution);
  if (type !== undefined) return UNREADABLE_ENTRY;
  const fromKey = pnpmKeySource(depPath, keyVersion);
  if (fromKey) return fromKey;
  const tarball = resolution.get("tarball");
  return tarball === undefined ? { recordsHost: false } : { source: tarball };
}

// A pnpm package entry. The key, without a leading `/` and the `(…)` peer suffix, is split at the first `@` past the start, so a
// scoped name and a `git+ssh://git@…` key split right; a key with no name there takes the entry's `name:` line, and a version
// that is an address gives way to the entry's `version:` line. An entry with no name is left out.
function pnpmEntry({ key, line, fields, resolution }) {
  let depPath = key.startsWith("/") ? key.slice(1) : key;
  if (depPath.includes("(")) depPath = depPath.slice(0, depPath.indexOf("("));
  const at = depPath.indexOf("@", 1);
  const keyVersion = at < 0 ? undefined : depPath.slice(at + 1);
  const name = at < 0 ? fields.get("name") : depPath.slice(0, at);
  if (name === undefined) return null;
  const version = keyVersion !== undefined && SEMVER.test(keyVersion) ? keyVersion : fields.get("version") ?? null;
  return { name, version, line, ...pnpmSource(depPath, keyVersion, resolution) };
}

// Each package entry runs from its key to the next key or top-level line; its `resolution` is inline or on the more deeply
// indented lines after it, up to the entry's next field.
function readPnpmLock(text) {
  const version = /^lockfileVersion: '?([^'\s]+)'?\s*$/m.exec(text)?.[1];
  if (!PNPM_VERSIONS.includes(version)) throw unsupportedVersion(version);
  const out = [];
  let inPackages = false;
  let entries = 0;
  let entry = null;
  const finish = () => {
    const pkg = entry && pnpmEntry(entry);
    if (pkg) out.push(pkg);
    entry = null;
  };
  linesOf(text).forEach((line, i) => {
    if (/^\S/.test(line)) {
      finish();
      inPackages = line === "packages:";
      return;
    }
    if (!inPackages) return;
    if (/^ {2}\S/.test(line)) {
      finish();
      entries++;
      const match = /^ {2}(\S.*):$/.exec(line);
      entry = match ? { key: unquote(match[1]), line: i + 1, fields: new Map(), resolution: new Map(), inResolution: false } : null;
      return;
    }
    if (!entry) return;
    if (/^ {4}\S/.test(line)) {
      entry.inResolution = line === "    resolution:";
      if (line.startsWith("    resolution: ")) entry.resolution = flowMapFields(line.slice("    resolution: ".length));
      else addField(entry.fields, line.slice(4));
    } else if (entry.inResolution && /^ {6}\S/.test(line)) addField(entry.resolution, line.slice(6));
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

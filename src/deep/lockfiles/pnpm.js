// ABOUTME: Reads the packages in a pnpm-lock.yaml (lockfile versions 6.0, 6.1 and 9.0), each with its line and where it comes
// ABOUTME: from; the file is read strictly, line by line, as pnpm writes it.
"use strict";

const {
  addressSource,
  fieldOf,
  found,
  githubCommit,
  gitRepositorySource,
  leadingSpaces,
  linesOf,
  LONE_CR_OR_TAB,
  opensUnclosed,
  OUTSIDE_PROJECT,
  pathFrom,
  PLAIN_NAME,
  SEMVER,
  startsWithAny,
  staysInside,
  unnamedEntry,
  unquote,
  Unreadable,
  UNREADABLE_ENTRY,
  unsupportedVersion,
} = require("./shared");

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

// Where a pnpm entry comes from (keyVersion is undefined for an address key), the first that applies:
// - a `directory` resolution is its path, read as `file:`; a `git` one is its repository; one of any other type, or a directory
//   with no path, is one it cannot read;
// - the key, when it names a source;
// - the resolution's tarball;
// - an address key, read as https;
// - with only an integrity, no host.
function pnpmSource(depPath, keyVersion, resolution) {
  const type = resolution.get("type");
  if (type === "directory") {
    return resolution.has("directory") ? { source: `file:${resolution.get("directory")}` } : UNREADABLE_ENTRY;
  }
  if (type === "git") return gitRepositorySource(resolution.get("repo") ?? "", resolution.get("commit") ?? "");
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

// The sections of an importer that list its dependencies, each `name:` followed by its `specifier:` and `version:`.
const IMPORTER_DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];

// A line of the importers section, read strictly for where an importer's folder and its dependencies' `link:` versions point: an
// importer's folder at 2 spaces (`key:` or `key: {}`), a section at 4, and in a dependency section a dependency's `name:` at 6
// and its fields at 8. Lines under another section are passed over. An odd indentation, a line that is no field where one is
// read, or a line deeper than a dependency's fields means the file is not one it can read; a dependency section or a dependency
// written in a flow map, or a version that is not a scalar on its line, is a source it could not read. An importer's folder, or a
// linked folder read from it, that leaves the repository is a path outside the project; an importer's folder inside it is listed
// as a workspace folder (`{ workspace }`), and a linked folder inside it, whose files are scanned, gives nothing.
function readImporterLine(importers, indent, text, lineNumber, folder) {
  if (indent % 2 === 1) throw new Unreadable(PNPM_LAYOUT);
  const field = fieldOf(text);
  const passedOver = indent > 4 && (importers.section === null || importers.folder === null);
  if (passedOver) return null;
  if (field === null) throw new Unreadable(PNPM_LAYOUT);
  const outside = (name) => ({ name, version: null, line: lineNumber, classified: OUTSIDE_PROJECT });
  const unreadable = () => ({ name: importers.dependency, version: null, line: lineNumber, ...UNREADABLE_ENTRY });
  if (indent === 2) {
    if (field.value !== "" && field.value !== "{}") throw new Unreadable(PNPM_LAYOUT);
    const importer = unquote(field.key);
    const importerFolder = staysInside(folder, importer) ? pathFrom(folder, importer) : null;
    Object.assign(importers, { folder: importerFolder, section: null, dependency: null });
    return importers.folder === null ? outside(null) : { workspace: importers.folder };
  }
  if (indent === 4) {
    const dependencySection = IMPORTER_DEPENDENCY_SECTIONS.includes(field.key);
    importers.section = dependencySection && field.value === "" ? field.key : null;
    importers.dependency = null;
    const flow = dependencySection && field.value !== "" && field.value !== "{}";
    return flow ? { name: null, version: null, line: lineNumber, ...UNREADABLE_ENTRY } : null;
  }
  if (indent === 6) {
    importers.dependency = unquote(field.key);
    return field.value === "" ? null : unreadable();
  }
  if (indent !== 8 || importers.dependency === null) throw new Unreadable(PNPM_LAYOUT);
  if (field.key !== "version") return null;
  if (startsWithAny(field.value, ODD_TOP_VALUE_START) || opensUnclosed(field.value)) return unreadable();
  const version = unquote(field.value);
  if (!version.startsWith("link:")) return null;
  return staysInside(importers.folder, version.slice("link:".length)) ? null : outside(importers.dependency);
}

// The file is read strictly, line by line, as pnpm writes it: comments and blank lines skipped; top-level names plain; in
// packages, entry keys at 2 spaces, their fields at 4 and a block resolution's fields at 6. A lone carriage return or a tab
// anywhere, a top-level line pnpm does not write, an indentation of 1, 3 or 5 spaces in packages, or any but 2 before its first
// entry, means the file is not one it can read. The importers section is read for linked folders outside the repository, `folder`
// being the lockfile's folder.
function readPnpmLock(text, folder = "") {
  const version = /^lockfileVersion: '?([^'\s]+)'?\s*$/m.exec(text)?.[1];
  if (!PNPM_VERSIONS.includes(version)) throw unsupportedVersion();
  if (LONE_CR_OR_TAB.test(text)) throw new Unreadable(PNPM_LAYOUT);
  const out = [];
  let inPackages = false;
  let inImporters = false;
  const importers = { folder, section: null, dependency: null };
  // The workspace folders the importers name, kept apart so they never count as packages read.
  const workspaces = [];
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
      const name = pnpmTopLevelName(line);
      inPackages = name === "packages";
      inImporters = name === "importers";
      return;
    }
    if (inImporters) {
      const link = readImporterLine(importers, indent, line.slice(indent), i + 1, folder);
      if (link) (link.workspace === undefined ? out : workspaces).push(link);
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
  return [...found(out, entries), ...workspaces];
}

module.exports = { readPnpmLock };

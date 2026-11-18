// ABOUTME: Reads the packages a target pulls in, and where each comes from, from its lockfiles (npm, Yarn, pnpm, Poetry, uv, pinned
// ABOUTME: requirements), or from its manifests when it has none; formats it cannot read are listed, never ignored.
"use strict";

const { baseName, isVendored } = require("../util");
const { classifySource } = require("../packageSources");
const { isPep440, localPathVerdict, normalisePyPI, SEMVER, Unreadable, UNREADABLE_ENTRY } = require("./shared");
const { readNpmLock } = require("./npm");
const { readYarnLock } = require("./yarn");
const { readPnpmLock } = require("./pnpm");
const { readPoetryLock, readUvLock } = require("./python");
const { readNamedRequirements, readRequirements } = require("./requirements");
const { readPackageJson, readPyproject } = require("./manifests");

const LOCKFILES = new Map([
  ["package-lock.json", { ecosystem: "npm", read: readNpmLock }],
  ["npm-shrinkwrap.json", { ecosystem: "npm", read: readNpmLock }],
  ["yarn.lock", { ecosystem: "npm", read: readYarnLock }],
  ["pnpm-lock.yaml", { ecosystem: "npm", read: readPnpmLock }],
  ["poetry.lock", { ecosystem: "PyPI", read: readPoetryLock }],
  ["uv.lock", { ecosystem: "PyPI", read: readUvLock }],
]);
const REQUIREMENTS = { ecosystem: "PyPI", read: readRequirements };
const NAMED_REQUIREMENTS = { ecosystem: "PyPI", read: readNamedRequirements };
const NOT_CHECKED = new Set(["Cargo.lock", "go.sum", "Gemfile.lock"]);

const lockfileKind = (p) => LOCKFILES.get(baseName(p)) ?? (/^requirements.*\.txt$/.test(baseName(p)) ? REQUIREMENTS : null);
// A lockfile proper, read here for OSV or one it has no support for. A requirements file is not one: besides its pins it can name
// package indexes and git sources, which OSV never sees.
const isLockfile = (p) => LOCKFILES.has(baseName(p)) || NOT_CHECKED.has(baseName(p));

const MANIFESTS = new Map([
  ["package.json", { ecosystem: "npm", read: readPackageJson }],
  ["pyproject.toml", { ecosystem: "PyPI", read: readPyproject }],
]);

// A file read by a reader other than the requirements reader: a lockfile or a manifest.
const isOtherFormat = (p) => (lockfileKind(p) !== null && lockfileKind(p) !== REQUIREMENTS) || MANIFESTS.has(baseName(p));

// The folder a file is in, relative to the repository root ("" at the root).
const folderOf = (filePath) => filePath.slice(0, Math.max(0, filePath.lastIndexOf("/")));

// What a reader makes of a file, given its text and its folder, or why it could not; input nested past what the reader can follow
// is said to be so.
function readSafely(read, file) {
  try {
    return { entries: read(file.text, folderOf(file.path)) };
  } catch (err) {
    if (err instanceof Unreadable) return { reason: err.message };
    if (err instanceof RangeError) return { reason: "too deeply nested" };
    throw err;
  }
}

const UNREADABLE_SOURCE_REASON = "a package source it could not read";

// What a reader's entry is: the reader's own verdict when it decided, the classifier's on its source, or the registry when it
// names no source. A commit the reader found wins over one in the text, and only a git source keeps one. A local path is read from
// the lockfile's folder.
function verdictOf(ecosystem, entry, folder) {
  if (entry.classified) return entry.classified;
  if (entry.source === undefined) return { expected: true };
  const verdict = classifySource(ecosystem, entry.source, { direct: entry.direct === true });
  if (verdict.kind === "local") return localPathVerdict(entry.source, folder, verdict);
  return verdict.kind === "git" && entry.commit ? { ...verdict, commit: entry.commit } : verdict;
}

// What a version is in each ecosystem: semver for npm, PEP 440 for PyPI.
const IS_VERSION = { npm: (version) => SEMVER.test(version), PyPI: isPep440 };

// An entry whose version is not one in its ecosystem: the text is never kept or sent to OSV, and an entry with no source of its
// own is one it could not read.
function withCheckedVersion(ecosystem, entry) {
  if (entry.version === null || IS_VERSION[ecosystem](entry.version)) return entry;
  const ownSource = entry.source !== undefined || entry.classified !== undefined;
  return { ...entry, version: null, ...(ownSource ? {} : UNREADABLE_ENTRY) };
}

const packageName = (ecosystem, name) => (ecosystem === "PyPI" && name !== null ? normalisePyPI(name) : name);

// A package from a source other than the official registry, as read from one file; an unreadable source has no address.
function sourcedPackage(ecosystem, file, entry, verdict) {
  const item = { ecosystem, file, line: entry.line, name: packageName(ecosystem, entry.name), version: entry.version };
  if (verdict.unreadable) return { ...item, kind: "unreadable", address: null };
  Object.assign(item, { kind: verdict.kind, address: verdict.address });
  if (verdict.kind === "git" && verdict.commit) item.commit = verdict.commit;
  if (verdict.text) item.text = verdict.text;
  return item;
}

// A line that names where packages come from rather than one package (a requirements file's index option), as the reader read it.
function sourcedLine(ecosystem, file, { line, from, classified }) {
  const item = { ecosystem, file, line, from, kind: classified.kind, address: classified.address };
  return classified.text ? { ...item, text: classified.text } : item;
}

// One lockfile's entries sorted by source: those from the official registry, those from anywhere else (local ones dropped), the
// files it names to be read in turn (a requirements file's -r and -c), and whether any source could not be read.
function classifyEntries(ecosystem, file, entries) {
  const registry = [];
  const sourced = [];
  const requires = [];
  let unreadable = false;
  for (const readEntry of entries) {
    if (readEntry.requires !== undefined) {
      requires.push(readEntry);
      continue;
    }
    if (readEntry.from) {
      sourced.push(sourcedLine(ecosystem, file, readEntry));
      continue;
    }
    const entry = withCheckedVersion(ecosystem, readEntry);
    const verdict = verdictOf(ecosystem, entry, folderOf(file));
    if (verdict.expected) registry.push(entry);
    else if (verdict.kind !== "local") {
      sourced.push(sourcedPackage(ecosystem, file, entry, verdict));
      unreadable ||= verdict.unreadable === true;
    }
  }
  return { registry, sourced, requires, unreadable };
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
  const byPath = new Map(files.map((f) => [f.path, f]));
  // Ecosystems with a lockfile proper, whose manifests are not read; and those with a requirements file, whose manifests are read
  // only for where they fetch from, since the requirements file's pins are what is checked.
  const locked = new Set();
  const pinned = new Set();
  const lockedBy = (path) => (lockfileKind(path) === REQUIREMENTS ? pinned : locked);
  // Requirements files read in their own right, and those named by -r or -c still to read; each is read once.
  const visited = new Set(ownFiles.filter((f) => lockfileKind(f.path) === REQUIREMENTS).map((f) => f.path));
  const toFollow = [];
  // Reads a lockfile, a requirements file or a manifest, its registry packages sent to OSV unless `sourcesOnly`; false when the file
  // could not be read at all.
  const readEntries = (f, kind, sourcesOnly = false) => {
    const read = readSafely(kind.read, f);
    if (read.reason) {
      result.couldNotRead.push({ file: f.path, reason: read.reason });
      return false;
    }
    const { registry, sourced, requires, unreadable } = classifyEntries(kind.ecosystem, f.path, read.entries);
    if (!sourcesOnly) for (const entry of registry) add(kind.ecosystem, f.path, entry);
    for (const item of sourced) result.sourced.push(item);
    // A named file the scan did not read (missing, or left out) may hold anything, and one another reader handles (a lockfile or a
    // manifest) is not a requirements file, so either is a source it could not read and is not followed.
    const followable = (r) => byPath.has(r.requires) && !isOtherFormat(r.requires);
    const unread = requires.filter((r) => !followable(r));
    for (const { line } of unread) result.sourced.push({ ecosystem: kind.ecosystem, file: f.path, line, from: "requirements", kind: "unreadable", address: null });
    if (unreadable || unread.length > 0) result.couldNotRead.push({ file: f.path, reason: UNREADABLE_SOURCE_REASON });
    for (const r of requires) {
      if (followable(r) && !visited.has(r.requires)) {
        visited.add(r.requires);
        toFollow.push(byPath.get(r.requires));
      }
    }
    return true;
  };
  for (const f of ownFiles) {
    if (NOT_CHECKED.has(baseName(f.path))) result.notChecked.push(f.path);
    const kind = lockfileKind(f.path);
    if (!kind) continue;
    lockedBy(f.path).add(kind.ecosystem);
    readEntries(f, kind);
  }
  for (let i = 0; i < toFollow.length; i++) readEntries(toFollow[i], NAMED_REQUIREMENTS);
  const ownLeftOut = leftOut.filter((l) => !isVendored(l.path));
  result.notChecked.push(...ownLeftOut.filter((l) => NOT_CHECKED.has(baseName(l.path))).map((l) => l.path));
  for (const f of ownLeftOut.filter((l) => lockfileKind(l.path))) {
    lockedBy(f.path).add(lockfileKind(f.path).ecosystem);
    result.couldNotRead.push({ file: f.path, reason: `${f.reason}, not checked` });
  }
  for (const f of ownFiles) {
    const manifest = MANIFESTS.get(baseName(f.path));
    if (!manifest || locked.has(manifest.ecosystem)) continue;
    const sourcesOnly = pinned.has(manifest.ecosystem);
    if (readEntries(f, manifest, sourcesOnly) && !sourcesOnly) result.namesOnly.push(f.path);
  }
  return result;
}

module.exports = { readPackages, isLockfile };

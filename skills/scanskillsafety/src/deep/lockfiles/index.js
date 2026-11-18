// ABOUTME: Reads the packages a target pulls in from its lockfiles (npm, Yarn, pnpm, Poetry, uv, pinned requirements), or their
// ABOUTME: names from its manifests when it has none; formats it cannot read are listed, never ignored.
"use strict";

const { baseName, isVendored } = require("../util");
const { classifySource } = require("../packageSources");
const { SEMVER, Unreadable, UNREADABLE_ENTRY } = require("./shared");
const { readNpmLock } = require("./npm");
const { readYarnLock } = require("./yarn");
const { readPnpmLock } = require("./pnpm");
const { readPackageBlocks, readRequirements } = require("./python");
const { packageJsonNames, pyprojectNames } = require("./manifests");

const normalisePyPI = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");

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

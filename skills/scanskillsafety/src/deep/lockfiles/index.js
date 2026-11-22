// ABOUTME: Reads the packages a target pulls in, and where each comes from, from its lockfiles (npm, Yarn, pnpm, Poetry, uv,
// ABOUTME: pinned requirements) or its manifests when it has none, and its config files; what it cannot read is listed.
"use strict";

const { baseName, isVendored } = require("../util");
const { classifySource } = require("../packageSources");
const { isPep440, localPathVerdict, normalisePyPI, pathFrom, SEMVER, staysInside, Unreadable, UNREADABLE_ENTRY } = require("./shared");
const { readNpmLock } = require("./npm");
const { readYarnLock } = require("./yarn");
const { readPnpmLock } = require("./pnpm");
const { readPoetryLock, readUvLock } = require("./python");
const { readNamedRequirements, readRequirements } = require("./requirements");
const { readPackageJson } = require("./packageJson");
const { readPyproject, readPyprojectConfig } = require("./pyproject");
const { readNpmrc, readPdmToml, readPnpmWorkspace, readPnpmWorkspaceSettings, readUvToml, readYarnrc, readYarnrcYml } = require("./installConfig");

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

// Manifests, read for packages when their ecosystem has no lockfile; pyproject.toml is read for its settings (`config`) when it has.
const MANIFESTS = new Map([
  ["package.json", { ecosystem: "npm", read: readPackageJson }],
  ["pyproject.toml", { ecosystem: "PyPI", read: readPyproject, config: readPyprojectConfig }],
]);

// Config files that name where installs in their folder fetch from. pnpm-workspace.yaml's folders are read only where no pnpm
// lockfile sits beside it, since the lockfile's importers already name them; its other settings always.
const CONFIGS = new Map([
  [".npmrc", { ecosystem: "npm", read: readNpmrc, follows: true }],
  [".yarnrc", { ecosystem: "npm", read: readYarnrc }],
  [".yarnrc.yml", { ecosystem: "npm", read: readYarnrcYml }],
  ["uv.toml", { ecosystem: "PyPI", read: readUvToml }],
  ["pdm.toml", { ecosystem: "PyPI", read: readPdmToml }],
]);
const PNPM_WORKSPACE = "pnpm-workspace.yaml";
const PNPM_WORKSPACE_KIND = { ecosystem: "npm", read: readPnpmWorkspace };
const PNPM_WORKSPACE_SETTINGS_KIND = { ecosystem: "npm", read: readPnpmWorkspaceSettings };
// Files whose leaving out of the file list is reported, besides lockfiles.
const REPORTED_WHEN_LEFT_OUT = new Set([...MANIFESTS.keys(), ...CONFIGS.keys(), PNPM_WORKSPACE]);

// The configs a lockfile that records no host takes its registry from (Yarn 1 records every host): npm reads only the .npmrc of
// its project, the nearest folder above the lockfile with a package.json (else the root); pnpm reads .npmrc and
// pnpm-workspace.yaml, and Yarn Berry .yarnrc.yml, in any folder above.
const COVERING_CONFIG = new Map([
  ["package-lock.json", { configs: [".npmrc"], projectOnly: true }],
  ["npm-shrinkwrap.json", { configs: [".npmrc"], projectOnly: true }],
  ["pnpm-lock.yaml", { configs: [".npmrc", PNPM_WORKSPACE], projectOnly: false }],
  ["yarn.lock", { configs: [".yarnrc.yml"], projectOnly: false }],
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
// names no source. A commit the reader found wins over one in the text, and only a git source keeps one. A local path is read
// from the lockfile's folder.
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

// A line that names where packages come from rather than one package (a requirements file's index option, a config setting), as
// the reader read it, with the scope a setting names; one it could not read has no address.
function sourcedLine(ecosystem, file, { line, from, classified, scope }) {
  const item = { ecosystem, file, line, from };
  if (classified.unreadable) return { ...item, kind: "unreadable", address: null };
  Object.assign(item, { kind: classified.kind, address: classified.address });
  if (classified.text) item.text = classified.text;
  if (scope !== undefined) item.scope = scope;
  return item;
}

// One file's entries sorted by source: those from the official registry, those from anywhere else (local ones dropped; a line
// naming the official registry gives nothing), the files it names to be read in turn (a requirements file's -r and -c), whether
// any source could not be read, the names of registry packages whose host it does not record, and the scopes whose registry its
// settings name (null for the unscoped registry).
function classifyEntries(ecosystem, file, entries) {
  const registry = [];
  const sourced = [];
  const requires = [];
  const unrecorded = [];
  const covers = [];
  const follows = [];
  let unreadable = false;
  for (const readEntry of entries) {
    if (readEntry.requires !== undefined) {
      requires.push(readEntry);
      continue;
    }
    if (readEntry.follows !== undefined) {
      follows.push(readEntry);
      continue;
    }
    if (readEntry.from) {
      if (readEntry.covers) covers.push(...readEntry.covers);
      if (!readEntry.classified.expected) sourced.push(sourcedLine(ecosystem, file, readEntry));
      unreadable ||= readEntry.classified.unreadable === true;
      continue;
    }
    const entry = withCheckedVersion(ecosystem, readEntry);
    const verdict = verdictOf(ecosystem, entry, folderOf(file));
    if (verdict.expected) {
      registry.push(entry);
      if (entry.recordsHost === false) unrecorded.push(entry.name);
    } else if (verdict.kind !== "local") {
      sourced.push(sourcedPackage(ecosystem, file, entry, verdict));
      unreadable ||= verdict.unreadable === true;
    }
  }
  return { registry, sourced, requires, unreadable, unrecorded, covers, follows };
}

// A package's npm scope (`@myco` for `@myco/x`), or null for an unscoped name.
const scopeOf = (name) => (name.startsWith("@") && name.includes("/") ? name.slice(0, name.indexOf("/")) : null);

// Whether a file in `configFolder` applies to a file in `folder`: it is in that folder or one above it.
const appliesTo = (configFolder, folder) => configFolder === "" || folder === configFolder || folder.startsWith(`${configFolder}/`);

// The project folder npm runs in for a folder: the nearest one at or above it holding a package.json, else the root.
function projectFolder(folder, projects) {
  for (let at = folder; at !== ""; at = folderOf(at)) if (projects.has(at)) return at;
  return "";
}

// The coverage each .npmrc gives: its own settings' and those of every config file it loads, followed through `npmrcs` (each
// read file's covers and the files it loads), each file once.
function npmrcCoverage(npmrcs) {
  const settings = [];
  for (const file of npmrcs.keys()) {
    const covers = [];
    const visited = new Set([file]);
    const queue = [file];
    for (let i = 0; i < queue.length; i++) {
      const { covers: own, targets } = npmrcs.get(queue[i]);
      for (const scope of own) covers.push(scope);
      for (const target of targets) {
        if (!visited.has(target) && npmrcs.has(target)) {
          visited.add(target);
          queue.push(target);
        }
      }
    }
    if (covers.length > 0) settings.push({ file, covers });
  }
  return settings;
}

// The lockfiles that record no host for some packages, none of which a config that applies to them names a registry for: a
// config covers a package when it names the unscoped registry or that package's scope's. `projects` are the folders holding a
// package.json.
function notRecordedNotes(unrecordedFiles, settings, projects) {
  const notes = [];
  for (const { file, ecosystem, names } of unrecordedFiles) {
    const { configs, projectOnly } = COVERING_CONFIG.get(baseName(file));
    const folder = folderOf(file);
    const project = projectOnly ? projectFolder(folder, projects) : null;
    const applies = (configFile) => (projectOnly ? folderOf(configFile) === project : appliesTo(folderOf(configFile), folder));
    const applying = settings.filter((s) => configs.includes(baseName(s.file)) && applies(s.file));
    const scopes = new Set(applying.flatMap((s) => s.covers));
    if (!names.every((name) => scopes.has(null) || scopes.has(scopeOf(name)))) notes.push({ file, ecosystem });
  }
  return notes;
}

// files: the text files read; leftOut: the files left out of that list with the reason, so a lockfile, manifest or config among
// them is said to be unchecked rather than missed. packages are those from the official registry, de-duplicated, for OSV; sourced
// lists every one from elsewhere, file by file, before any de-duplication, so a mirror's copy is reported whichever file names the
// package first, and every config setting naming a source other than the official registry; notRecorded names each lockfile
// that records no host for some packages with no config naming a registry for them.
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
  const ownLeftOut = leftOut.filter((l) => !isVendored(l.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  // Lockfiles with packages whose host they do not record, the config files whose settings name a registry, and each .npmrc read
  // (or file read as one) with its covers and the config files it loads.
  const unrecordedFiles = [];
  const settings = [];
  const npmrcs = new Map();
  const pnpmLocked = new Set([...ownFiles, ...ownLeftOut].filter((f) => baseName(f.path) === "pnpm-lock.yaml").map((f) => folderOf(f.path)));
  // Ecosystems with a lockfile proper, whose manifests are not read; and those with a requirements file, whose manifests are read
  // only for where they fetch from, since the requirements file's pins are what is checked.
  const locked = new Set();
  const pinned = new Set();
  const lockedBy = (path) => (lockfileKind(path) === REQUIREMENTS ? pinned : locked);
  // Requirements files read in their own right, and those named by -r or -c still to read; each is read once.
  const visited = new Set(ownFiles.filter((f) => lockfileKind(f.path) === REQUIREMENTS).map((f) => f.path));
  const toFollow = [];
  // Reads a lockfile, a requirements file, a manifest or a config file, its registry packages sent to OSV unless `sourcesOnly`:
  // those registry packages, or null when the file could not be read at all.
  const readEntries = (f, kind, { sourcesOnly = false } = {}) => {
    const read = readSafely(kind.read, f);
    if (read.reason) {
      result.couldNotRead.push({ file: f.path, reason: read.reason });
      return null;
    }
    const { registry, sourced, requires, unreadable, unrecorded, covers, follows } = classifyEntries(kind.ecosystem, f.path, read.entries);
    if (!sourcesOnly) for (const entry of registry) add(kind.ecosystem, f.path, entry);
    for (const item of sourced) result.sourced.push(item);
    if (unrecorded.length > 0) unrecordedFiles.push({ file: f.path, ecosystem: kind.ecosystem, names: unrecorded });
    // A config file another names, read from the naming file's folder: one inside the repository that the scan read is read in
    // turn; any other (outside, missing, left out) is one it cannot read, covering a lockfile.
    const targets = [];
    for (const { line, follows: path } of follows) {
      const target = staysInside(folderOf(f.path), path) ? pathFrom(folderOf(f.path), path) : null;
      if (target !== null && byPath.has(target)) targets.push(target);
      else {
        result.sourced.push({ ecosystem: kind.ecosystem, file: f.path, line, from: "config", kind: "unreadable", address: null });
        covers.push(null);
      }
    }
    if (kind.follows) npmrcs.set(f.path, { covers, targets });
    else if (covers.length > 0) settings.push({ file: f.path, covers });
    // A named file the scan did not read (missing, or left out) may hold anything, and one another reader handles (a lockfile or a
    // manifest) is not a requirements file, so either is a source it could not read and is not followed.
    const followable = (r) => byPath.has(r.requires) && !isOtherFormat(r.requires);
    const unread = requires.filter((r) => !followable(r));
    for (const { line } of unread) result.sourced.push({ ecosystem: kind.ecosystem, file: f.path, line, from: "requirements", kind: "unreadable", address: null });
    if (unreadable || unread.length > 0 || targets.length < follows.length) {
      result.couldNotRead.push({ file: f.path, reason: UNREADABLE_SOURCE_REASON });
    }
    for (const r of requires) {
      if (followable(r) && !visited.has(r.requires)) {
        visited.add(r.requires);
        toFollow.push(byPath.get(r.requires));
      }
    }
    return registry;
  };
  for (const f of ownFiles) {
    if (NOT_CHECKED.has(baseName(f.path))) result.notChecked.push(f.path);
    const config = CONFIGS.get(baseName(f.path));
    if (config) readEntries(f, config);
    const kind = lockfileKind(f.path);
    if (!kind) continue;
    lockedBy(f.path).add(kind.ecosystem);
    readEntries(f, kind);
  }
  for (let i = 0; i < toFollow.length; i++) readEntries(toFollow[i], NAMED_REQUIREMENTS);
  result.notChecked.push(...ownLeftOut.filter((l) => NOT_CHECKED.has(baseName(l.path))).map((l) => l.path));
  for (const f of ownLeftOut) {
    const kind = lockfileKind(f.path);
    if (kind) lockedBy(f.path).add(kind.ecosystem);
    if (kind || REPORTED_WHEN_LEFT_OUT.has(baseName(f.path))) result.couldNotRead.push({ file: f.path, reason: `${f.reason}, not checked` });
  }
  for (const f of ownFiles) {
    const manifest = MANIFESTS.get(baseName(f.path));
    if (!manifest) continue;
    if (locked.has(manifest.ecosystem)) {
      if (manifest.config) readEntries(f, { ecosystem: manifest.ecosystem, read: manifest.config }, { sourcesOnly: true });
      continue;
    }
    const sourcesOnly = pinned.has(manifest.ecosystem);
    if (readEntries(f, manifest, { sourcesOnly }) && !sourcesOnly) result.namesOnly.push(f.path);
  }
  // The config files the .npmrc files load, each read once, as an .npmrc, wherever they are.
  const npmrcKind = CONFIGS.get(".npmrc");
  const toLoad = [...npmrcs.values()].flatMap(({ targets }) => targets);
  for (let i = 0; i < toLoad.length; i++) {
    if (npmrcs.has(toLoad[i])) continue;
    readEntries(byPath.get(toLoad[i]), npmrcKind);
    for (const target of npmrcs.get(toLoad[i])?.targets ?? []) toLoad.push(target);
  }
  for (const setting of npmrcCoverage(npmrcs)) settings.push(setting);
  // pnpm-workspace.yaml, once the lockfiles are known: its catalogs' registry names are sent to OSV only for a pnpm project with no
  // lockfile, as package.json's are.
  for (const f of ownFiles.filter((file) => baseName(file.path) === PNPM_WORKSPACE)) {
    const pnpmLock = pnpmLocked.has(folderOf(f.path));
    const sourcesOnly = pnpmLock || locked.has("npm");
    const registry = readEntries(f, pnpmLock ? PNPM_WORKSPACE_SETTINGS_KIND : PNPM_WORKSPACE_KIND, { sourcesOnly });
    if (registry?.length > 0 && !sourcesOnly) result.namesOnly.push(f.path);
  }
  const projects = new Set([...ownFiles, ...ownLeftOut].filter((f) => baseName(f.path) === "package.json").map((f) => folderOf(f.path)));
  result.notRecorded.push(...notRecordedNotes(unrecordedFiles, settings, projects));
  return result;
}

module.exports = { readPackages, isLockfile };

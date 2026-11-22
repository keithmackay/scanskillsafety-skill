// ABOUTME: Reads the packages a target pulls in, and where each comes from, from its lockfiles (npm, Yarn, pnpm, Poetry, uv,
// ABOUTME: pinned requirements) or its manifests when it has none, and its config files; what it cannot read is listed.
"use strict";

const { baseName, isVendored } = require("../util");
const { classifySource } = require("../packageSources");
const { append, isPep440, localPathVerdict, normalisePyPI, pathFrom, SEMVER, staysInside, Unreadable, UNREADABLE_ENTRY } = require("./shared");
const { readNpmLock } = require("./npm");
const { readYarnLock } = require("./yarn");
const { readPnpmLock } = require("./pnpm");
const { readPoetryLock, readUvLock } = require("./python");
const { readNamedRequirements, readRequirements } = require("./requirements");
const { readPackageJson } = require("./packageJson");
const { readPyproject, readPyprojectConfig } = require("./pyproject");
const { readNpmrc, readYarnrc } = require("./rcConfig");
const { readPnpmWorkspace, readPnpmWorkspaceSettings, readYarnrcYml } = require("./yamlConfig");
const { readPdmToml, readUvToml } = require("./pythonConfig");

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

// Config files that name where installs in their folder fetch from, read in file order; an .npmrc may load other config files.
const CONFIGS = new Map([
  [".npmrc", { ecosystem: "npm", read: readNpmrc, follows: true }],
  [".yarnrc", { ecosystem: "npm", read: readYarnrc }],
  [".yarnrc.yml", { ecosystem: "npm", read: readYarnrcYml }],
  ["uv.toml", { ecosystem: "PyPI", read: readUvToml }],
  ["pdm.toml", { ecosystem: "PyPI", read: readPdmToml }],
]);
// pnpm-workspace.yaml, read once the lockfiles are known: its folders only where no pnpm lockfile sits beside it, since the
// lockfile's importers already name them; its other settings always.
const PNPM_WORKSPACE = "pnpm-workspace.yaml";
const PNPM_WORKSPACE_KIND = { ecosystem: "npm", read: readPnpmWorkspace };
const PNPM_WORKSPACE_SETTINGS_KIND = { ecosystem: "npm", read: readPnpmWorkspaceSettings };
// Files whose leaving out of the file list is reported, besides lockfiles.
const REPORTED_WHEN_LEFT_OUT = new Set([...MANIFESTS.keys(), ...CONFIGS.keys(), PNPM_WORKSPACE]);

// The configs a lockfile that records no host takes its registry from (Yarn 1 records every host): npm reads only the .npmrc of
// its project, the nearest folder at or above the lockfile's with a package.json (else the root); pnpm reads .npmrc and
// pnpm-workspace.yaml, and Yarn Berry .yarnrc.yml, in the lockfile's folder or any folder above it.
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
// settings name (null for the unscoped registry), and the config files it loads (an .npmrc's userconfig, globalconfig, prefix).
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
      if (readEntry.covers) append(covers, readEntry.covers);
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

// The project folder npm runs in for a folder: the nearest one at or above it holding a package.json, else the root.
function projectFolder(folder, projects) {
  for (let at = folder; at !== ""; at = folderOf(at)) if (projects.has(at)) return at;
  return "";
}

// A file's path in a folder.
const inFolder = (folder, name) => (folder === "" ? name : `${folder}/${name}`);

// A lockfile no config covers, as one with no config naming a registry would be.
const UNCOVERED = Object.freeze({ configs: [], projectOnly: false });

// What npm loads after each part of its config: the project .npmrc names its user config and its global config (globalconfig, or
// prefix); the user config names its global config; the global config names nothing more.
const NEXT_ROLES = new Map([["project", ["user", "global"]], ["user", ["global"]], ["global", []]]);

// The files npm reads as its config, from a project .npmrc, as far as npm loads them (`npmrcTargets`: each .npmrc read with the
// files it loads and the part each is loaded as): each file in each part once, a pointer past that depth not followed.
function* npmConfigChain(project, npmrcTargets) {
  const seen = new Set([`project\0${project}`]);
  const queue = [{ path: project, role: "project" }];
  for (let i = 0; i < queue.length; i++) {
    yield queue[i].path;
    for (const { target, role } of npmrcTargets.get(queue[i].path) ?? []) {
      const key = `${role}\0${target}`;
      if (NEXT_ROLES.get(queue[i].role).includes(role) && !seen.has(key)) {
        seen.add(key);
        queue.push({ path: target, role });
      }
    }
  }
}

// The lockfiles that record no host for some packages, none of which a config that applies to them names a registry for: a
// config covers a package when it names the unscoped registry or that package's scope's. `configCovers` holds each config file's
// covers, `npmrcTargets` the config files each .npmrc loads (which only npm follows, and only as far as it loads them); `files`
// are every file the target has, read or left out, for the folders holding a package.json. Each config file's covers are kept
// once, as a set of the scopes these lockfiles' packages use, and each lockfile's packages are checked against the files that
// apply to it in turn, until every one is covered, so memory and time stay bounded by the files however they load each other.
function notRecordedNotes(unrecordedFiles, configCovers, npmrcTargets, files) {
  const projects = new Set(files.filter((f) => baseName(f.path) === "package.json").map((f) => folderOf(f.path)));
  const used = new Set([null]);
  for (const { names } of unrecordedFiles) for (const name of names) used.add(scopeOf(name));
  const own = new Map();
  const ownCovers = (path) => {
    if (!own.has(path)) own.set(path, new Set((configCovers.get(path) ?? []).filter((scope) => used.has(scope))));
    return own.get(path);
  };
  // The config files that apply to a lockfile, in the order they are checked.
  function* applying(file) {
    const { configs, projectOnly } = COVERING_CONFIG.get(baseName(file)) ?? UNCOVERED;
    if (projectOnly) {
      const project = projectFolder(folderOf(file), projects);
      for (const config of configs) yield* npmConfigChain(inFolder(project, config), npmrcTargets);
      return;
    }
    for (let at = folderOf(file); ; at = folderOf(at)) {
      for (const config of configs) yield inFolder(at, config);
      if (at === "") return;
    }
  }
  const notes = [];
  for (const { file, ecosystem, names } of unrecordedFiles) {
    let uncovered = names;
    for (const config of applying(file)) {
      const covers = ownCovers(config);
      // A config that covers none of the scopes in use, or a folder with none, changes nothing.
      if (covers.size === 0) continue;
      uncovered = covers.has(null) ? [] : uncovered.filter((name) => !covers.has(scopeOf(name)));
      if (uncovered.length === 0) break;
    }
    if (uncovered.length > 0) notes.push({ file, ecosystem });
  }
  return notes;
}

// Where the config files an .npmrc loads are, each read from the .npmrc's folder: `targets`, those inside the repository that the
// scan read, each with its line and the part npm loads it as; `unread`, the lines of the others (outside, missing, left out).
function followTargets(file, follows, byPath) {
  const targets = [];
  const unread = [];
  for (const { line, follows: path, role } of follows) {
    const target = staysInside(folderOf(file), path) ? pathFrom(folderOf(file), path) : null;
    if (target !== null && byPath.has(target)) targets.push({ target, role, line });
    else unread.push(line);
  }
  return { targets, unread };
}

// Reads, as an .npmrc, each config file npm loads from the project .npmrc files already read (`npmrcTargets`, to which
// `readAsNpmrc` adds each file it reads), as far as npm loads them: each file in each part once. A pointer past that depth, which
// npm does not follow, is one it cannot read (`pastDepth(file, line)`).
function loadNpmrcTargets(npmrcTargets, byPath, { readAsNpmrc, pastDepth }) {
  const queue = [...npmrcTargets.keys()].map((path) => ({ path, role: "project" }));
  const seen = new Set(queue.map(({ path }) => `project\0${path}`));
  for (let i = 0; i < queue.length; i++) {
    const { path, role } = queue[i];
    if (!npmrcTargets.has(path)) readAsNpmrc(byPath.get(path));
    for (const pointer of npmrcTargets.get(path) ?? []) {
      const key = `${pointer.role}\0${pointer.target}`;
      if (!NEXT_ROLES.get(role).includes(pointer.role)) pastDepth(path, pointer.line);
      else if (!seen.has(key)) {
        seen.add(key);
        queue.push({ path: pointer.target, role: pointer.role });
      }
    }
  }
}

// Reads each pnpm-workspace.yaml once the lockfiles are known: its catalogs' registry names are sent to OSV (and the file listed
// in `namesOnly`) only for a pnpm project with no lockfile, as package.json's are; beside a pnpm lockfile, its folders are not
// read.
function readPnpmWorkspaces(ownFiles, { pnpmLocked, npmLocked, readEntries, namesOnly }) {
  for (const f of ownFiles.filter((file) => baseName(file.path) === PNPM_WORKSPACE)) {
    const pnpmLock = pnpmLocked.has(folderOf(f.path));
    const sourcesOnly = pnpmLock || npmLocked;
    const registry = readEntries(f, pnpmLock ? PNPM_WORKSPACE_SETTINGS_KIND : PNPM_WORKSPACE_KIND, { sourcesOnly });
    if (registry?.length > 0 && !sourcesOnly) namesOnly.push(f.path);
  }
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
  // Lockfiles with packages whose host they do not record, each config file's covers, and each file read as an .npmrc with the
  // config files it loads.
  const unrecordedFiles = [];
  const configCovers = new Map();
  const npmrcTargets = new Map();
  // Files given the reason "a package source it could not read", each once.
  const unreadableFiles = new Set();
  const pnpmLocked = new Set([...ownFiles, ...ownLeftOut].filter((f) => baseName(f.path) === "pnpm-lock.yaml").map((f) => folderOf(f.path)));
  // Ecosystems with a lockfile proper, whose manifests are not read; and those with a requirements file, whose manifests are read
  // only for where they fetch from, since the requirements file's pins are what is checked.
  const locked = new Set();
  const pinned = new Set();
  // Ecosystems with a lockfile proper that was read: a manifest of theirs that would be read for nothing is not listed when left out.
  const lockRead = new Set();
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
    // A config file it cannot load is one it cannot read, covering a lockfile.
    const { targets, unread: unloaded } = followTargets(f.path, follows, byPath);
    for (const line of unloaded) {
      result.sourced.push({ ecosystem: kind.ecosystem, file: f.path, line, from: "config", kind: "unreadable", address: null });
      covers.push(null);
    }
    if (covers.length > 0) configCovers.set(f.path, covers);
    if (kind.follows) npmrcTargets.set(f.path, targets);
    // A named file the scan did not read (missing, or left out) may hold anything, and one another reader handles (a lockfile or a
    // manifest) is not a requirements file, so either is a source it could not read and is not followed.
    const followable = (r) => byPath.has(r.requires) && !isOtherFormat(r.requires);
    const unread = requires.filter((r) => !followable(r));
    for (const { line } of unread) result.sourced.push({ ecosystem: kind.ecosystem, file: f.path, line, from: "requirements", kind: "unreadable", address: null });
    if (unreadable || unread.length > 0 || unloaded.length > 0) {
      result.couldNotRead.push({ file: f.path, reason: UNREADABLE_SOURCE_REASON });
      unreadableFiles.add(f.path);
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
    if (readEntries(f, kind) !== null && kind !== REQUIREMENTS) lockRead.add(kind.ecosystem);
  }
  for (let i = 0; i < toFollow.length; i++) readEntries(toFollow[i], NAMED_REQUIREMENTS);
  result.notChecked.push(...ownLeftOut.filter((l) => NOT_CHECKED.has(baseName(l.path))).map((l) => l.path));
  // A manifest read only when its ecosystem has no lockfile (package.json) would not have been read beside one that was.
  const readForNothing = (path) => {
    const manifest = MANIFESTS.get(baseName(path));
    return manifest !== undefined && !manifest.config && lockRead.has(manifest.ecosystem);
  };
  for (const f of ownLeftOut) {
    const kind = lockfileKind(f.path);
    if (kind) lockedBy(f.path).add(kind.ecosystem);
    if (kind || (REPORTED_WHEN_LEFT_OUT.has(baseName(f.path)) && !readForNothing(f.path))) result.couldNotRead.push({ file: f.path, reason: `${f.reason}, not checked` });
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
  // A pointer past npm's depth is reported once, as a line it cannot read that covers a lockfile.
  const pastDepthLines = new Set();
  const pastDepth = (file, line) => {
    if (pastDepthLines.has(`${file}\0${line}`)) return;
    pastDepthLines.add(`${file}\0${line}`);
    result.sourced.push({ ecosystem: "npm", file, line, from: "config", kind: "unreadable", address: null });
    if (!unreadableFiles.has(file)) {
      unreadableFiles.add(file);
      result.couldNotRead.push({ file, reason: UNREADABLE_SOURCE_REASON });
    }
    if (!configCovers.has(file)) configCovers.set(file, []);
    configCovers.get(file).push(null);
  };
  loadNpmrcTargets(npmrcTargets, byPath, { readAsNpmrc: (f) => readEntries(f, CONFIGS.get(".npmrc")), pastDepth });
  readPnpmWorkspaces(ownFiles, { pnpmLocked, npmLocked: locked.has("npm"), readEntries, namesOnly: result.namesOnly });
  append(result.notRecorded, notRecordedNotes(unrecordedFiles, configCovers, npmrcTargets, [...ownFiles, ...ownLeftOut]));
  return result;
}

module.exports = { readPackages, isLockfile, UNREADABLE_SOURCE_REASON };

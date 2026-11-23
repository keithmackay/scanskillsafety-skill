// ABOUTME: Reads the packages in an npm package-lock.json or npm-shrinkwrap.json, lockfile versions 1 to 3, each with its line
// ABOUTME: and where it comes from; an alias is read by its real name.
"use strict";

const { isObject } = require("../util");
const {
  found,
  jsonKeyLines,
  jsonMembers,
  OUTSIDE_PROJECT,
  parseJson,
  pathFrom,
  ROOT_OBJECT,
  SEMVER,
  staysInside,
  Unreadable,
  UNREADABLE_ENTRY,
  unreadableNamed,
  unsupportedVersion,
} = require("./shared");

// An npm alias (`npm:real-name@1.2.3`) names the package that is really installed.
function npmAlias(version) {
  const match = /^npm:(@?[^@]+)@(.+)$/.exec(version);
  return match ? { name: match[1], version: match[2] } : null;
}


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

const NODE_MODULES = "node_modules/";
const packageName = (key, entry) =>
  isObject(entry) && typeof entry.name === "string" ? entry.name : key.slice(key.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);

// A packages or dependencies section that is there but is no object holds what npm would install from in a shape it cannot read.
const NPM_LAYOUT = "not laid out as npm writes it";
function section(value) {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Unreadable(NPM_LAYOUT);
  return value;
}

// text: the lockfile; folder: its folder in the repository, which a linked folder's path is read from.
function readNpmLock(text, folder = "") {
  const json = parseJson(text);
  const version = json && json.lockfileVersion;
  const lineOf = jsonKeyLines(text);
  if (version === 2 || version === 3) {
    // Keys without node_modules/ are the project's own workspace folders, and a link entry stands for a folder linked in place of
    // a package: either one that leaves the repository is a path outside the project; a workspace folder inside it is listed as one
    // (`{ workspace }`, its path in the repository), and a linked folder inside it, whose files are scanned, gives nothing. A link
    // entry with no path is one it cannot read.
    const out = [];
    const installed = [];
    const versioned = [];
    // The line of a workspace key whose value is not an object, which the key lines do not hold: read only when one is needed.
    let members = null;
    const memberLine = (key) => {
      members ??= jsonMembers(text);
      return members(members(ROOT_OBJECT, "packages")?.object, key)?.line ?? null;
    };
    for (const [key, entry] of Object.entries(section(json.packages))) {
      if (!key.includes("node_modules/")) {
        if (key !== "" && staysInside(folder, key)) out.push({ workspace: pathFrom(folder, key) });
        else if (key !== "") {
          // A workspace is named by its own name, or else by its folder's.
          const folderName = key.slice(key.lastIndexOf("/") + 1) || null;
          const named = isObject(entry) && typeof entry.name === "string" ? entry.name : folderName;
          const line = isObject(entry) ? lineOf(key) : memberLine(key);
          out.push({ name: named, version: null, line, classified: OUTSIDE_PROJECT });
        }
      } else if (isObject(entry) && entry.link) {
        const linked = typeof entry.resolved === "string" ? staysInside(folder, entry.resolved) : null;
        const link = { name: packageName(key, entry), version: null };
        if (linked === null) out.push({ ...link, line: lineOf(key), ...UNREADABLE_ENTRY });
        else if (!linked) out.push({ ...link, line: lineOf(key), classified: OUTSIDE_PROJECT });
      } else {
        // An installed entry with no version, or that is no object, may still be fetched from wherever it names: one it cannot read.
        installed.push(key);
        if (isObject(entry) && typeof entry.version === "string") {
          const pkg = { name: packageName(key, entry), version: entry.version, line: lineOf(key), ...npmSource(entry) };
          versioned.push(pkg);
          out.push(pkg);
        } else out.push(unreadableNamed(packageName(key, entry), isObject(entry) ? lineOf(key) : memberLine(key)));
      }
    }
    found(versioned, installed.length);
    return out;
  }
  if (version === 1) {
    const dependenciesOf = (entry) => Object.entries(section(entry.dependencies));
    const out = [];
    const versioned = [];
    // The line of an entry whose value is not an object, which the key lines do not hold: its member in its level's dependencies
    // object, found by walking down from the root through the entries above it, each level's object found once and only when a
    // line is needed.
    let members = null;
    const objectOf = (level) => {
      members ??= jsonMembers(text);
      const unfound = [];
      for (let at = level; at !== null && at.object === undefined; at = at.parent) unfound.push(at);
      for (let k = unfound.length - 1; k >= 0; k--) {
        const { parent, name } = unfound[k];
        const holder = parent === null ? ROOT_OBJECT : members(parent.object ?? undefined, name)?.object;
        unfound[k].object = members(holder, "dependencies")?.object ?? null;
      }
      return level.object ?? undefined;
    };
    const memberLine = (level, name) => {
      const object = objectOf(level);
      return members(object, name)?.line ?? null;
    };
    // Depth first in document order, with a stack of the levels whose entries are still to visit, so nesting cannot run out of
    // stack; each level knows the entry it belongs to, for the line of an entry that is no object. An entry with no version is
    // one it cannot read, and its own dependencies are still read.
    const stack = [{ entries: dependenciesOf(json).reverse(), parent: null, name: null, object: undefined }];
    while (stack.length > 0) {
      const level = stack[stack.length - 1];
      const [name, entry] = level.entries.pop() ?? [];
      if (name === undefined) {
        stack.pop();
        continue;
      }
      if (!isObject(entry)) {
        out.push(unreadableNamed(name, memberLine(level, name)));
        continue;
      }
      if (typeof entry.version === "string") {
        const read = { ...npmV1Entry(name, entry), line: lineOf(name) };
        versioned.push(read);
        out.push(read);
      } else out.push(unreadableNamed(name, lineOf(name)));
      stack.push({ entries: dependenciesOf(entry).reverse(), parent: level, name, object: undefined });
    }
    found(versioned, dependenciesOf(json).length);
    return out;
  }
  throw unsupportedVersion();
}

module.exports = { readNpmLock };

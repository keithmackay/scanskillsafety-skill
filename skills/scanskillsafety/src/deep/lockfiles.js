// ABOUTME: Reads the packages a target pulls in from its lockfiles (npm, Yarn, pnpm, Poetry, uv, pinned requirements), or their
// ABOUTME: names from its manifests when it has none; formats it cannot read are listed, never ignored.
"use strict";

const { isVendored } = require("./installTime");

const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
const normalisePyPI = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");
const unquote = (s) => s.replace(/^["']|["']$/g, "");

class Unreadable extends Error {}
const unsupportedVersion = (version) => new Unreadable(`lockfileVersion ${version ?? "(none)"} is not a version it can read`);

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Unreadable("not valid JSON");
  }
}

// The line of each `"key": {` in a JSON lockfile, found in document order, so a name that appears twice gets the right one.
function jsonKeyLines(text) {
  let cursor = 0;
  let line = 1;
  return (key) => {
    const pattern = new RegExp(`${JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*\\{`, "g");
    pattern.lastIndex = cursor;
    const match = pattern.exec(text);
    if (!match) return null;
    for (let i = cursor; i < match.index; i++) if (text[i] === "\n") line++;
    cursor = match.index;
    return line;
  };
}

// An npm alias (`npm:real-name@1.2.3`) names the package that is really installed.
function npmAlias(version) {
  const match = /^npm:(@?[^@]+)@(.+)$/.exec(version);
  return match ? { name: match[1], version: match[2] } : null;
}

function readNpmLock(text) {
  const json = parseJson(text);
  const version = json && json.lockfileVersion;
  const lineOf = jsonKeyLines(text);
  if (version === 2 || version === 3) {
    // Keys without node_modules/ are the project's own workspace folders.
    return Object.entries(json.packages ?? {})
      .filter(([key, entry]) => key.includes("node_modules/") && entry && !entry.link && typeof entry.version === "string")
      .map(([key, entry]) => ({
        name: typeof entry.name === "string" ? entry.name : key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length),
        version: entry.version,
        line: lineOf(key),
      }));
  }
  if (version === 1) {
    const out = [];
    const walk = (dependencies) => {
      for (const [name, entry] of Object.entries(dependencies ?? {})) {
        if (!entry || typeof entry.version !== "string") continue;
        const line = lineOf(name);
        out.push({ ...(npmAlias(entry.version) ?? { name, version: entry.version }), line });
        walk(entry.dependencies);
      }
    };
    walk(json.dependencies);
    return out;
  }
  throw unsupportedVersion(version);
}

// A Yarn spec's package name: the text before the first `@` past the start, or the real name an `npm:` alias points at.
function yarnSpecName(spec) {
  const at = spec.indexOf("@", 1);
  const range = spec.slice(at + 1);
  if (range.startsWith("npm:")) {
    const aliasAt = range.indexOf("@", 5);
    if (aliasAt > 0) return range.slice(4, aliasAt);
  }
  return spec.slice(0, at);
}

function readYarnLock(text) {
  const berry = /^__metadata:$/m.test(text);
  if (!berry && !text.includes("# yarn lockfile v1")) throw new Unreadable("not a Yarn lockfile it can read");
  const versionLine = berry ? /^ {2}version: "?([^"\s]+)"?$/ : /^ {2}version "([^"]+)"$/;
  const out = [];
  let entry = null;
  text.split("\n").forEach((line, i) => {
    if (/^[^\s#].*:$/.test(line)) {
      const spec = unquote(line.slice(0, -1).split(/,\s*/)[0]);
      const skipped = spec === "__metadata" || spec.slice(spec.indexOf("@", 1)).includes("@workspace:");
      entry = skipped ? null : { name: yarnSpecName(spec), line: i + 1 };
      return;
    }
    const match = entry && versionLine.exec(line);
    if (match) {
      out.push({ ...entry, version: match[1] });
      entry = null;
    }
  });
  return out;
}

const PNPM_VERSIONS = ["6.0", "6.1", "9.0"];

function readPnpmLock(text) {
  const version = /^lockfileVersion: '?([^'\s]+)'?\s*$/m.exec(text)?.[1];
  if (!PNPM_VERSIONS.includes(version)) throw unsupportedVersion(version);
  const out = [];
  let inPackages = false;
  text.split("\n").forEach((line, i) => {
    if (/^\S/.test(line)) inPackages = line === "packages:";
    const match = inPackages && /^ {2}(\S.*):$/.exec(line);
    if (!match) return;
    let key = unquote(match[1]).replace(/^\//, "");
    if (key.includes("(")) key = key.slice(0, key.indexOf("("));
    const at = key.lastIndexOf("@");
    if (at > 0) out.push({ name: key.slice(0, at), version: key.slice(at + 1), line: i + 1 });
  });
  return out;
}

// poetry.lock and uv.lock: each [[package]] block's name and version; a block whose source is editable or virtual is the project.
function readPackageBlocks(text) {
  const out = [];
  let block = null;
  const finish = () => {
    if (block && block.name && block.version && !block.project) out.push({ name: block.name, version: block.version, line: block.line });
    block = null;
  };
  text.split("\n").forEach((line, i) => {
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
  return out;
}

const PINNED_REQUIREMENT = /^([A-Za-z0-9._-]+)(\[[^\]]*\])?==([^\s;#]+)/;

function readRequirements(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const match = PINNED_REQUIREMENT.exec(line);
    if (match) out.push({ name: match[1], version: match[3], line: i + 1 });
  });
  return out;
}

const LOCKFILES = {
  "package-lock.json": { ecosystem: "npm", read: readNpmLock },
  "npm-shrinkwrap.json": { ecosystem: "npm", read: readNpmLock },
  "yarn.lock": { ecosystem: "npm", read: readYarnLock },
  "pnpm-lock.yaml": { ecosystem: "npm", read: readPnpmLock },
  "poetry.lock": { ecosystem: "PyPI", read: readPackageBlocks },
  "uv.lock": { ecosystem: "PyPI", read: readPackageBlocks },
};
const REQUIREMENTS = { ecosystem: "PyPI", read: readRequirements };
const NOT_CHECKED = new Set(["Cargo.lock", "go.sum", "Gemfile.lock"]);

const lockfileKind = (p) => LOCKFILES[baseName(p)] ?? (/^requirements.*\.txt$/.test(baseName(p)) ? REQUIREMENTS : null);

function packageJsonNames(text) {
  const json = parseJson(text);
  const sections = ["dependencies", "optionalDependencies", "peerDependencies"];
  return sections.flatMap((section) => (json && typeof json[section] === "object" && json[section] ? Object.keys(json[section]) : []));
}

// The quoted strings of a TOML array starting at `from`, up to its closing bracket outside quotes.
function quotedStrings(text, from) {
  const out = [];
  let quote = null;
  let current = "";
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        out.push(current);
        quote = null;
        current = "";
      } else current += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "]") break;
  }
  return out;
}

function pyprojectNames(text) {
  const names = [];
  const lines = text.split("\n");
  let table = null;
  let offset = 0;
  for (const line of lines) {
    const header = /^\[+([^\]]+)\]+\s*$/.exec(line);
    if (header) table = header[1].trim();
    else if (table === "project" && /^dependencies\s*=\s*\[/.test(line)) {
      const from = offset + line.indexOf("[") + 1;
      names.push(...quotedStrings(text, from).map((requirement) => requirement.trim().split(/[<>=!~;[ (]/)[0]));
    } else if (table === "tool.poetry.dependencies") {
      const key = /^(["']?)([A-Za-z0-9._-]+)\1\s*=/.exec(line);
      if (key && key[2] !== "python") names.push(key[2]);
    }
    offset += line.length + 1;
  }
  return names.filter(Boolean);
}

const MANIFESTS = {
  "package.json": { ecosystem: "npm", names: packageJsonNames },
  "pyproject.toml": { ecosystem: "PyPI", names: pyprojectNames },
};

// files: the text files read; leftOut: the files left out of that list with the reason, so a lockfile among them is said to be
// unchecked rather than missed.
function readPackages(files, leftOut = []) {
  const result = { packages: [], namesOnly: [], couldNotRead: [], notChecked: [] };
  const seen = new Set();
  const add = (ecosystem, file, { name, version, line }) => {
    const pkg = { ecosystem, name: ecosystem === "PyPI" ? normalisePyPI(name) : name, version, file, line };
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
    try {
      for (const entry of kind.read(f.text)) add(kind.ecosystem, f.path, entry);
    } catch (err) {
      if (!(err instanceof Unreadable)) throw err;
      result.couldNotRead.push({ file: f.path, reason: err.message });
    }
  }
  for (const f of leftOut.filter((l) => !isVendored(l.path) && lockfileKind(l.path))) {
    locked.add(lockfileKind(f.path).ecosystem);
    result.couldNotRead.push({ file: f.path, reason: `${f.reason}, not checked` });
  }
  for (const f of ownFiles) {
    const manifest = MANIFESTS[baseName(f.path)];
    if (!manifest || locked.has(manifest.ecosystem)) continue;
    try {
      const names = manifest.names(f.text);
      result.namesOnly.push(f.path);
      for (const name of names) add(manifest.ecosystem, f.path, { name, version: null, line: null });
    } catch (err) {
      if (!(err instanceof Unreadable)) throw err;
      result.couldNotRead.push({ file: f.path, reason: err.message });
    }
  }
  return result;
}

module.exports = { readPackages };

// ABOUTME: Reads a target's manifests, package.json and pyproject.toml, when it has no lockfile for that ecosystem: the names sent
// ABOUTME: to OSV, and every dependency from outside the registry with its line; a shape it cannot read is reported, never ignored.
"use strict";

const { isObject, OBJECT_ID } = require("../util");
const { classifyManifestValue, LOCAL, UNREADABLE } = require("../packageSources");
const {
  jsonMembers,
  localPathVerdict,
  normalisePyPI,
  OUTSIDE_PROJECT,
  parseJson,
  ROOT_OBJECT,
  SEMVER,
  unnamedEntry,
  UNREADABLE_ENTRY,
  workspaceOutside,
} = require("./shared");
const { tomlStatements } = require("./toml");
const { pythonAddress } = require("./python");
const { addressEntries, specifierEntries, splitName } = require("./requirements");

const EXPECTED = Object.freeze({ expected: true });
const NAMED_INDEX = Object.freeze({ expected: false, kind: "host", address: null, text: "a named index" });

const unreadableNamed = (name, line) => ({ name, version: null, line, ...UNREADABLE_ENTRY });
const isRegistry = (entry) => entry.classified === undefined || entry.classified.expected === true;

// What a manifest gives, from what it names (`{ entry, checked }`, `checked` when the entry's name is sent to OSV): every entry not
// from the registry, local ones included so they are dropped later, and the registry names checked, with the version when the
// manifest gives one and no line, except a name that also comes from somewhere else in the file (an override, a uv or Poetry
// source), which is not sent to OSV since its name may not mean what OSV's record means.
function manifestEntries(found, sameName) {
  const elsewhere = new Set(found.filter(({ entry }) => !isRegistry(entry)).map(({ entry }) => sameName(entry.name)));
  const reported = found.filter(({ entry }) => !isRegistry(entry)).map(({ entry }) => entry);
  const names = found
    .filter(({ entry, checked }) => checked && isRegistry(entry) && !elsewhere.has(sameName(entry.name)))
    .map(({ entry }) => ({ name: entry.name, version: entry.version ?? null, line: null }));
  return [...reported, ...names];
}

// The entries of a list of workspace folder patterns read from a file's folder, all at `line`: one for each pattern that leaves the
// repository, a path outside the project; a list that is not an array of strings is one it cannot read.
function workspaceEntries(patterns, line, folder) {
  if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== "string")) return [unnamedEntry(line)];
  return patterns.filter((pattern) => workspaceOutside(folder, pattern)).map(() => ({ name: null, version: null, line, classified: OUTSIDE_PROJECT }));
}

// package.json

// The sections whose registry names are sent to OSV; the others are read only for where they fetch from.
const CHECKED_SECTIONS = new Set(["dependencies", "optionalDependencies", "peerDependencies"]);
const SOURCE_SECTIONS = new Set([...CHECKED_SECTIONS, "devDependencies", "overrides", "resolutions"]);
// The sections that replace a package wherever it is installed, so one they name in place of the key's is sent to OSV.
const OVERRIDE_SECTIONS = new Set(["overrides", "resolutions", "pnpm.overrides"]);

// The package an override or resolution key is about: the last package of a pnpm `a>b` chain or of a Yarn `a/**/b` path, without
// its version range.
function overrideTarget(key) {
  const last = key.slice(key.lastIndexOf(">") + 1);
  const parts = last.split("/");
  const scoped = parts.length > 1 && parts[parts.length - 2].startsWith("@");
  const tail = scoped ? parts.slice(-2).join("/") : parts[parts.length - 1];
  const at = tail.indexOf("@", 1);
  return at < 0 ? tail : tail.slice(0, at);
}

// An npm package name, scoped or not, in the characters npm allows; a version or range (`18.2.0`, `1.x`, `~3`) is not one.
const NPM_NAME = /^(?:@[A-Za-z0-9-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9-][A-Za-z0-9._~-]*$/;
const VERSION_LIKE = /^v?\d+(?:\.(?:\d+|x|\*))*(?:[-+][0-9A-Za-z.+-]*)?$/i;
const isPackageName = (text) => NPM_NAME.test(text) && !VERSION_LIKE.test(text);

// The package an npm alias (`npm:<name>@<range>`, `npm:<name>`, in any case) names, and whether a range follows it; null for any
// other value, or when the text after `npm:` is no package name (`npm:^4.17.21`), which leaves the key's package.
function aliasParts(value) {
  if (value.slice(0, 4).toLowerCase() !== "npm:") return null;
  const spec = value.slice(4);
  const at = spec.indexOf("@", 1);
  const name = at < 0 ? spec : spec.slice(0, at);
  return isPackageName(name) ? { name, ranged: at >= 0 } : null;
}
const aliasTarget = (value) => aliasParts(value)?.name ?? null;

// The package a `patch:` value patches: the alias its inner resolution names, else the package named before it; null when it names
// none.
function patchTarget(value) {
  if (!value.startsWith("patch:")) return null;
  let body = value.slice("patch:".length).split("#", 1)[0];
  try {
    body = decodeURIComponent(body);
  } catch {
    return null;
  }
  const at = body.indexOf("@", 1);
  if (at < 0) return null;
  const name = body.slice(0, at);
  return aliasTarget(body.slice(at + 1)) ?? (isPackageName(name) ? name : null);
}

// The longest tarball file name read: npm caps a name at 214 characters, so a longer one is no package's.
const MAX_TARBALL_FILE = 512;

// The package and version a tarball on the official npm registry is, from its file name, `<name>-<version>.tgz`, under
// `/<package>/-/` or `/@<scope>/<package>/-/` (the `/` after the scope possibly encoded), the scope kept; the file is what is
// downloaded, so its name wins over the folder's. null when the path is not one.
function registryTarball(value) {
  let segments;
  try {
    segments = decodeURIComponent(new URL(value).pathname).slice(1).split("/");
  } catch {
    return null;
  }
  const scope = segments[0].startsWith("@") ? segments[0] : null;
  const [dash, file, ...more] = segments.slice(scope === null ? 1 : 2);
  if (dash !== "-" || more.length > 0 || file === undefined || file.length > MAX_TARBALL_FILE || !file.endsWith(".tgz")) return null;
  const stem = file.slice(0, -".tgz".length);
  for (let at = stem.indexOf("-"); at > 0; at = stem.indexOf("-", at + 1)) {
    const version = stem.slice(at + 1);
    if (!SEMVER.test(version)) continue;
    const name = scope === null ? stem.slice(0, at) : `${scope}/${stem.slice(0, at)}`;
    return isPackageName(name) ? { name, version } : null;
  }
  return null;
}

// The packages a registry value names beyond its key, each with a version or null: the package an alias or a patch installs (for
// `npm:<tag>`, which npm reads as a package and Yarn as a tag of the key's package, both), or the package and version a registry
// tarball is; `UNNAMED` for an address on the registry that is no tarball it can read; null when it is a range or a tag for the
// key's package.
const UNNAMED = Object.freeze({});
function namedPackages(value, keyName) {
  const alias = aliasParts(value);
  if (alias !== null) return [{ name: alias.name, version: null }, ...(alias.ranged ? [] : [{ name: keyName, version: null }])];
  const patched = patchTarget(value);
  if (patched !== null) return [{ name: patched, version: null }];
  if (!/^https?:/i.test(value)) return null;
  const tarball = registryTarball(value);
  return tarball === null ? UNNAMED : [tarball];
}

// The values of one section, each with its name and the line of its value: walked iteratively, depth first in parse order, through
// nested override objects (`.` naming the package of the object it is in). A value that is neither a string nor, where overrides
// nest, an object is one it cannot read (`value: null`). A line is given only when the text at it is the value parsed.
function sectionValues(section, members, object, nests) {
  const values = [];
  const stack = [{ entries: Object.entries(section), next: 0, object, parent: null }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.next === frame.entries.length) {
      stack.pop();
      continue;
    }
    const [key, value] = frame.entries[frame.next++];
    const member = members(frame.object, key);
    const name = key === "." && frame.parent !== null ? frame.parent : key;
    if (typeof value === "string") values.push({ name, value, line: member?.text === value ? member.line : null });
    else if (nests && isObject(value)) stack.push({ entries: Object.entries(value), next: 0, object: member?.object, parent: name });
    else values.push({ name, value: null, line: member?.line ?? null });
  }
  return values;
}

// A package.json value: a local path is read from the manifest's folder (a path outside the project when it leaves the repository;
// inside it, an archive is bundled and a folder stays local).
function packageJsonVerdict(value, folder) {
  const verdict = classifyManifestValue("npm", value);
  return verdict.kind === "local" ? localPathVerdict(value, folder, verdict) : verdict;
}

// What one package.json dependency gives: its source when that is not the registry, or one it cannot read for a registry address
// that is no tarball; from the registry, in a checked section, the packages it names (the key's, or those an alias, a patch or a
// registry tarball names); in an override section, only packages an alias, a patch or a registry tarball names, which are
// installed in place of the key's; in any other section, nothing.
function dependencyFound(packageName, { value, line }, { checked, overrides }, folder) {
  const verdict = packageJsonVerdict(value, folder);
  if (!verdict.expected) return [{ entry: { name: packageName, version: null, line, classified: verdict }, checked }];
  const named = namedPackages(value, packageName);
  if (named === UNNAMED) return [{ entry: unreadableNamed(packageName, line), checked }];
  if (named === null) return checked ? [{ entry: { name: packageName, version: null, line }, checked: true }] : [];
  if (!checked && !overrides) return [];
  return named.map(({ name, version }) => ({ entry: { name, version, line }, checked: true }));
}

// package.json's dependencies in every section that can name a source, and the overrides in `pnpm.overrides`. A section that is
// not an object is one it cannot read.
function readPackageJson(text, folder = "") {
  const unmarked = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const json = parseJson(unmarked);
  if (!isObject(json)) return [];
  const members = jsonMembers(unmarked);
  const sections = [];
  for (const [name, value] of Object.entries(json)) {
    const member = members(ROOT_OBJECT, name);
    if (SOURCE_SECTIONS.has(name)) sections.push({ name, value, member, nests: name === "overrides" });
    else if (name === "pnpm" && isObject(value) && Object.hasOwn(value, "overrides")) {
      sections.push({ name: "pnpm.overrides", value: value.overrides, member: members(member?.object, "overrides"), nests: false });
    }
  }
  const found = [];
  if (Object.hasOwn(json, "workspaces")) {
    const member = members(ROOT_OBJECT, "workspaces");
    const { workspaces } = json;
    const listed = isObject(workspaces) && Object.hasOwn(workspaces, "packages");
    const patterns = listed ? workspaces.packages : workspaces;
    const line = (listed ? members(member?.object, "packages") : member)?.line ?? null;
    for (const entry of workspaceEntries(patterns, line, folder)) found.push({ entry, checked: false });
  }
  for (const { name, value, member, nests } of sections) {
    const checked = CHECKED_SECTIONS.has(name);
    if (!isObject(value)) {
      found.push({ entry: unnamedEntry(member?.line ?? null), checked });
      continue;
    }
    for (const dependency of sectionValues(value, members, member?.object, nests)) {
      const packageName = checked ? dependency.name : overrideTarget(dependency.name);
      if (dependency.value === null) found.push({ entry: unreadableNamed(packageName, dependency.line), checked });
      else found.push(...dependencyFound(packageName, dependency, { checked, overrides: OVERRIDE_SECTIONS.has(name) }, folder));
    }
  }
  return manifestEntries(found, (name) => name);
}

// pyproject.toml

const TOML_LAYOUT = "not TOML it can read";
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WHITESPACE = /\s/;

// The text of a one-line string, basic or literal; null for any other value.
const stringOf = (value) => ((value.kind === "string" || value.kind === "literal") && value.text !== undefined ? value.text : null);
const isTrue = (value) => value.kind === "scalar" && value.text === "true";

// The most parts of a key path kept: more than any section that names a source has. One part past it is kept, so a longer path
// still reads as deeper than every section, without a long path being copied for each value under it.
const MAX_PATH = 10;
const joined = (path, more) => path.concat(more.slice(0, MAX_PATH + 1)).slice(0, MAX_PATH + 1);

// Every value of a TOML file with its key path (at most MAX_PATH parts and one more): the table it is in, its own dotted key and,
// for an inline table, each of its entries in turn; an array of tables adds the number of its element to the path, so it never
// reads as a name.
function tomlValues(text) {
  const values = [];
  let table = [];
  const elements = new Map();
  for (const statement of tomlStatements(text, TOML_LAYOUT, { anyLayout: true })) {
    if (statement.header) {
      table = joined([], statement.header);
      if (statement.array) {
        const id = JSON.stringify(table);
        const element = elements.get(id) ?? 0;
        elements.set(id, element + 1);
        table = joined(table, [element]);
      }
      continue;
    }
    const stack = [{ path: joined(table, statement.path), value: statement.value }];
    while (stack.length > 0) {
      const { path, value } = stack.pop();
      if (value.kind !== "table") values.push({ path, value });
      else for (let k = value.entries.length - 1; k >= 0; k--) stack.push({ path: joined(path, value.entries[k].path), value: value.entries[k].value });
    }
  }
  return values;
}

// The path after `prefix`, or null when the path does not start with it.
function after(path, prefix) {
  if (path.length < prefix.length || prefix.some((part, k) => path[k] !== part)) return null;
  return path.slice(prefix.length);
}

// The project's own folder as PDM (`file:///${PROJECT_ROOT}`) and Hatch (`{root:uri}`) write it in a dependency's URL.
const PROJECT_ROOTS = ["file:///${PROJECT_ROOT}", "{root:uri}"];

// An address with the project's folder written as PDM or Hatch write it, as a path from the pyproject's folder; any other unchanged.
function projectRelative(address) {
  for (const root of PROJECT_ROOTS) {
    if (address === root) return ".";
    if (address.startsWith(`${root}/`)) return `./${address.slice(root.length + 1)}`;
  }
  return address;
}

// The entries of one address a requirement installs from (`name` null when it gives none), a local one kept so its name is held
// back from OSV.
function requirementAddressEntries(address, name, line, folder) {
  const entries = addressEntries(projectRelative(address), name, line, folder);
  return entries.length > 0 ? entries : [{ name, version: null, line, classified: LOCAL }];
}

// A PEP 508 requirement: `name [extras] @ url ; marker`, or `name [extras] specifiers ; marker`. A URL ends at whitespace, after
// which only a marker may follow. One that is not a requirement it can read keeps its name when it has one; a bare URL has none.
function requirementEntries(text, line, folder) {
  const requirement = text.trim();
  const parts = SCHEME.test(requirement) ? null : splitName(requirement);
  if (parts === null) return [unnamedEntry(line)];
  if (parts.rest.startsWith("@")) {
    const address = parts.rest.slice(1).trimStart();
    const end = address.search(WHITESPACE);
    const marker = end < 0 ? "" : address.slice(end).trim();
    if (marker !== "" && !marker.startsWith(";")) return [unreadableNamed(parts.name, line)];
    return requirementAddressEntries(end < 0 ? address : address.slice(0, end), parts.name, line, folder);
  }
  const specified = specifierEntries({ name: parts.name, rest: parts.rest.split(";", 1)[0] }, line);
  if (specified !== null && specified[0].classified !== undefined) return specified;
  return [{ name: parts.name, version: null, line }];
}

// How a list's items may be written besides PEP 508 strings: a dependency group's `{ include-group = "name" }`, which names no
// source; uv's extra build dependency `{ requirement = "…", match-runtime = … }`; PDM's editable `-e <address>`.
const GROUPS = "groups";
const BUILD = "build";
const EDITABLE = "editable";

// The requirement in a uv extra build dependency table, or null when the table is not one.
function buildRequirement(item) {
  const fields = tableFields(item);
  if (fields === null || [...fields.keys()].some((field) => field !== "requirement" && field !== "match-runtime")) return null;
  return fields.has("requirement") ? stringOf(fields.get("requirement")) : null;
}

const isIncludeGroup = (item) => {
  const fields = tableFields(item);
  return fields !== null && fields.size === 1 && fields.has("include-group") && stringOf(fields.get("include-group")) !== null;
};

// An array of PEP 508 strings, with the other items its `form` allows; any other item is one it cannot read.
function requirementListEntries(value, folder, form) {
  if (value.kind !== "array") return [unnamedEntry(value.line)];
  return value.items.flatMap((item) => {
    const text = stringOf(item);
    if (text !== null && form === EDITABLE && /^-e\s/.test(`${text.trim()} `)) {
      const address = text.trim().slice(2).trim();
      return address === "" ? [unnamedEntry(item.line)] : requirementAddressEntries(address, null, item.line, folder);
    }
    if (text !== null) return requirementEntries(text, item.line, folder);
    if (form === GROUPS && isIncludeGroup(item)) return [];
    const requirement = form === BUILD ? buildRequirement(item) : null;
    return requirement === null ? [unnamedEntry(item.line)] : requirementEntries(requirement, item.line, folder);
  });
}

// An index a dependency names, found by name among the file's indexes (the first of a name wins, as uv and Poetry take it; names
// compared by `sameName`): its address as an index, or a find-links page for a flat one; `builtIn` when no index has the name and
// the tool knows it.
function namedIndexVerdict(indexes, name, folder, builtIn, sameName = (a, b) => a === b) {
  const index = indexes.find((candidate) => candidate.name !== null && sameName(candidate.name, name));
  if (index === undefined) return builtIn ?? NAMED_INDEX;
  if (index.url === null) return builtIn ?? UNREADABLE;
  return pythonAddress(index.url, folder, { role: index.flat ? "find-links" : "index" });
}

// A git repository, one archive or a path a uv or Poetry dependency names; a git commit is the `rev` when it is a commit id.
function addressVerdict(kind, address, rev, folder) {
  if (kind === "url") return pythonAddress(address, folder, { direct: true });
  if (kind === "path") return pythonAddress(address, folder, { pathField: true });
  const verdict = pythonAddress(address, folder, { git: true });
  return verdict.kind === "git" && OBJECT_ID.test(rev) ? { ...verdict, commit: rev } : verdict;
}

// The fields that name an index by name: uv's `index`, Poetry's `source`.
const INDEX_FIELDS = new Set(["index", "source"]);

// What a dependency table names, given the tool's fields (`kinds`: those that each name a source, at most one of which may be
// given, and exactly one when `required`). A field the tool does not have, a second source, or a source field that is not a string
// is one it cannot read. With no source field, the dependency is from the registry; an index field is found by `namedIndex`.
function tableVerdict(fields, folder, { kinds, known, required, namedIndex }) {
  if ([...fields.keys()].some((field) => !known.has(field))) return UNREADABLE;
  const given = kinds.filter((kind) => fields.has(kind));
  if (given.length > 1) return UNREADABLE;
  if (given.length === 0) return required ? UNREADABLE : EXPECTED;
  const [kind] = given;
  if (kind === "workspace") return isTrue(fields.get(kind)) ? LOCAL : UNREADABLE;
  const address = stringOf(fields.get(kind));
  const rev = fields.has("rev") ? stringOf(fields.get("rev")) : "";
  if (address === null || rev === null) return UNREADABLE;
  return INDEX_FIELDS.has(kind) ? namedIndex(address) : addressVerdict(kind, address, rev, folder);
}

// The fields of an inline table whose keys are single names, given once; null when it is not one.
function tableFields(value) {
  if (value.kind !== "table") return null;
  const fields = new Map();
  for (const entry of value.entries) {
    if (entry.path.length !== 1 || fields.has(entry.path[0])) return null;
    fields.set(entry.path[0], entry.value);
  }
  return fields;
}

const UV_KINDS = ["git", "url", "path", "index", "workspace"];
const UV_FIELDS = new Set([...UV_KINDS, "rev", "tag", "branch", "subdirectory", "lfs", "editable", "package", "marker", "extra", "group"]);
const POETRY_KINDS = ["git", "url", "path", "source"];
const POETRY_FIELDS = new Set([
  ...POETRY_KINDS, "version", "branch", "tag", "rev", "subdirectory", "develop", "python", "platform", "markers", "optional", "extras",
  "allow-prereleases", "allows-prereleases",
]);

// A `[tool.uv.sources]` entry: exactly one of git, url, path, index or workspace; an index is found among [[tool.uv.index]].
const uvSourceVerdict = (fields, folder, indexes) =>
  tableVerdict(fields, folder, {
    kinds: UV_KINDS,
    known: UV_FIELDS,
    required: true,
    namedIndex: (name) => namedIndexVerdict(indexes.uv, name, folder),
  });

// Poetry compares source names lowercased.
const sameIgnoringCase = (a, b) => a.toLowerCase() === b.toLowerCase();

// A Poetry dependency table: at most one of git, url, path or source; with none it is the registry; a source is found among
// [[tool.poetry.source]], where `pypi` is PyPI unless the file names its own.
const poetryVerdict = (fields, folder, indexes) =>
  tableVerdict(fields, folder, {
    kinds: POETRY_KINDS,
    known: POETRY_FIELDS,
    required: false,
    namedIndex: (name) => namedIndexVerdict(indexes.poetry, name, folder, name.toLowerCase() === "pypi" ? EXPECTED : undefined, sameIgnoringCase),
  });

// The indexes a file names by name, `[[tool.uv.index]]` or `[[tool.poetry.source]]`, as tables or as an array of inline tables.
function namedIndexes(values, prefix) {
  const tables = new Map();
  for (const { path, value } of values) {
    const rest = after(path, prefix);
    if (rest === null) continue;
    if (rest.length === 0 && value.kind === "array") value.items.forEach((item, k) => tables.set(`item${k}`, tableFields(item) ?? new Map()));
    else if (rest.length === 2 && typeof rest[0] === "number" && typeof rest[1] === "string") {
      if (!tables.has(rest[0])) tables.set(rest[0], new Map());
      tables.get(rest[0]).set(rest[1], value);
    }
  }
  return [...tables.values()].map((fields) => ({
    name: fields.has("name") ? stringOf(fields.get("name")) : null,
    url: fields.has("url") ? stringOf(fields.get("url")) : null,
    flat: fields.has("format") && stringOf(fields.get("format")) === "flat",
  }));
}

const PROJECT_DEPENDENCIES = ["project", "dependencies"];
const OPTIONAL_DEPENDENCIES = ["project", "optional-dependencies"];
const DEPENDENCY_GROUPS = ["dependency-groups"];
// Lists of PEP 508 strings that are build or development inputs: read for sources, their names never sent to OSV.
const OTHER_REQUIREMENT_LISTS = [
  ["build-system", "requires"],
  ["tool", "uv", "dev-dependencies"],
  ["tool", "uv", "override-dependencies"],
  ["tool", "uv", "constraint-dependencies"],
  ["tool", "uv", "build-constraint-dependencies"],
];
// Tables of named lists that are build or development inputs, each with the form its items may take.
const OTHER_REQUIREMENT_TABLES = [
  { prefix: ["tool", "uv", "extra-build-dependencies"], form: BUILD },
  { prefix: ["tool", "pdm", "dev-dependencies"], form: EDITABLE },
];
const UV_SOURCES = ["tool", "uv", "sources"];
const UV_WORKSPACE_MEMBERS = ["tool", "uv", "workspace", "members"];
const POETRY_TABLES = [["tool", "poetry", "dependencies"], ["tool", "poetry", "dev-dependencies"]];
const POETRY_GROUPS = ["tool", "poetry", "group"];

// Where a value sits among the sections that can name a source: a list of requirements, a uv or Poetry dependency (its name and
// the field, if any, the value is), something in such a section in a shape it cannot read (`bad`), or nothing that names one.
function placeOf(path) {
  const members = after(path, UV_WORKSPACE_MEMBERS);
  if (members !== null) return members.length === 0 ? { workspace: true } : { bad: true };
  const project = after(path, PROJECT_DEPENDENCIES);
  if (project !== null) return project.length === 0 ? { list: true, checked: true } : { bad: true };
  for (const prefix of OTHER_REQUIREMENT_LISTS) {
    const other = after(path, prefix);
    if (other !== null) return other.length === 0 ? { list: true } : { bad: true };
  }
  for (const { prefix, form } of OTHER_REQUIREMENT_TABLES) {
    const other = after(path, prefix);
    if (other !== null) return other.length === 1 && typeof other[0] === "string" ? { list: true, form } : { bad: true };
  }
  const optional = after(path, OPTIONAL_DEPENDENCIES);
  if (optional !== null) return optional.length === 1 && typeof optional[0] === "string" ? { list: true } : { bad: true };
  const groups = after(path, DEPENDENCY_GROUPS);
  if (groups !== null) return groups.length === 1 && typeof groups[0] === "string" ? { list: true, form: GROUPS } : { bad: true };
  const uv = after(path, UV_SOURCES);
  if (uv !== null) return dependencyPlace("uv", path, uv, false);
  for (const prefix of POETRY_TABLES) {
    const poetry = after(path, prefix);
    if (poetry !== null) return dependencyPlace("poetry", path, poetry, prefix[2] === "dependencies");
  }
  const group = after(path, POETRY_GROUPS);
  if (group !== null && group[1] === "dependencies") {
    if (typeof group[0] !== "string") return { bad: true };
    return dependencyPlace("poetry", path, group.slice(2), false);
  }
  return null;
}

// A value under a uv or Poetry dependency table (`rest` being its path after the table): the dependency's name, the field the value
// is (none when it is the whole value), and the path up to the name, which identifies the dependency. A value deeper than a field
// makes the dependency one it cannot read.
function dependencyPlace(tool, path, rest, checked) {
  if (rest.length === 0 || typeof rest[0] !== "string") return { bad: true };
  const element = typeof rest[1] === "number" ? rest[1] : undefined;
  const fieldAt = element === undefined ? 1 : 2;
  const field = rest.length === fieldAt + 1 && typeof rest[fieldAt] === "string" ? rest[fieldAt] : undefined;
  const id = JSON.stringify(path.slice(0, path.length - rest.length + 1));
  return { tool, checked, name: rest[0], element, field, deeper: rest.length > 1 && field === undefined, id };
}

const newTable = () => ({ fields: new Map(), lines: new Map() });

// One value of a uv or Poetry dependency, added to what is known of it: its whole value, a field of its own table, or a field of
// one of its `[[…]]` tables. A field given twice, a second whole value or a value deeper than a field makes it one it cannot read.
function addDependencyValue(dependency, place, value) {
  if (place.deeper) dependency.broken = true;
  else if (place.field === undefined) {
    dependency.broken ||= dependency.whole;
    Object.assign(dependency, { whole: true, value });
  } else {
    if (place.element !== undefined && !dependency.elements.has(place.element)) dependency.elements.set(place.element, newTable());
    const table = place.element === undefined ? dependency.own : dependency.elements.get(place.element);
    if (table.fields.has(place.field)) dependency.broken = true;
    else {
      table.fields.set(place.field, value);
      table.lines.set(place.field, value.line);
    }
  }
}

// One uv or Poetry dependency's entries: from its own table, from each of its `[[…]]` tables, or from its whole value (a version
// string for Poetry; an array of tables, one source per marker or constraint), each table's at the line of its source field. A
// dependency written in more than one of those ways, or broken as it was added, is one it cannot read.
function dependencyEntries(dependency, folder, indexes) {
  const verdictOf = dependency.tool === "uv" ? uvSourceVerdict : poetryVerdict;
  const kinds = dependency.tool === "uv" ? UV_KINDS : POETRY_KINDS;
  const entry = (verdict, line) => ({ entry: { name: dependency.name, version: null, line, ...(verdict.expected ? {} : { classified: verdict }) }, checked: dependency.checked });
  const fromTable = ({ fields, lines }) => entry(verdictOf(fields, folder, indexes), lines.get(kinds.find((kind) => lines.has(kind))) ?? dependency.line);
  const ways = [dependency.whole, dependency.own.fields.size > 0, dependency.elements.size > 0].filter(Boolean).length;
  if (dependency.broken || ways > 1) return [entry(UNREADABLE, dependency.line)];
  if (dependency.elements.size > 0) return [...dependency.elements.values()].map(fromTable);
  if (!dependency.whole) return [fromTable(dependency.own)];
  const { value } = dependency;
  if (dependency.tool === "poetry" && stringOf(value) !== null) return [entry(EXPECTED, value.line)];
  if (value.kind !== "array") return [entry(UNREADABLE, value.line)];
  return value.items.map((item) => {
    const fields = tableFields(item);
    return entry(fields === null ? UNREADABLE : verdictOf(fields, folder, indexes), item.line);
  });
}

// `[tool.uv.workspace] members`: an array of folder patterns, each at its own line; any other value is one it cannot read.
function workspaceMemberEntries(value, folder) {
  if (value.kind !== "array") return [unnamedEntry(value.line)];
  return value.items.flatMap((item) => {
    const pattern = stringOf(item);
    return pattern === null ? [unnamedEntry(item.line)] : workspaceEntries([pattern], item.line, folder);
  });
}

// pyproject.toml's dependencies in every section that can name a source: PEP 508 strings in [project] dependencies,
// [project.optional-dependencies], [dependency-groups], [build-system] requires, uv's dev, override, constraint and build
// dependencies and PDM's dev-dependencies; [tool.uv.sources]; Poetry's dependency tables. Pixi and Hatch environments are not read. Each value is placed by
// its whole key path, so dotted keys, inline tables and table headers read alike, and any value in those sections in a shape it does
// not know is one it cannot read. The names of [project] dependencies and [tool.poetry.dependencies] are sent to OSV.
function readPyproject(text, folder = "") {
  const values = tomlValues(text.startsWith("\uFEFF") ? text.slice(1) : text);
  const indexes = { uv: namedIndexes(values, ["tool", "uv", "index"]), poetry: namedIndexes(values, ["tool", "poetry", "source"]) };
  // Lists and dependencies, in the order of their first value.
  const units = [];
  const dependencies = new Map();
  for (const { path, value } of values) {
    const place = placeOf(path);
    if (place === null) continue;
    if (place.bad) units.push({ bad: value.line });
    else if (place.workspace) units.push({ workspace: value });
    else if (place.list) units.push({ list: value, checked: place.checked === true, form: place.form });
    else if (!(place.tool === "poetry" && place.name === "python")) {
      let dependency = dependencies.get(place.id);
      if (dependency === undefined) {
        const { tool, name, checked } = place;
        dependency = { tool, name, checked, line: value.line, own: newTable(), elements: new Map(), whole: false, broken: false };
        dependencies.set(place.id, dependency);
        units.push({ dependency });
      }
      addDependencyValue(dependency, place, value);
    }
  }
  const found = units.flatMap((unit) => {
    if (unit.bad !== undefined) return [{ entry: unnamedEntry(unit.bad), checked: false }];
    if (unit.workspace) return workspaceMemberEntries(unit.workspace, folder).map((entry) => ({ entry, checked: false }));
    if (unit.list) return requirementListEntries(unit.list, folder, unit.form).map((entry) => ({ entry, checked: unit.checked }));
    return dependencyEntries(unit.dependency, folder, indexes);
  });
  return manifestEntries(found, (name) => (name === null ? null : normalisePyPI(name)));
}

module.exports = { readPackageJson, readPyproject };

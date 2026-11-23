// ABOUTME: Reads every pyproject.toml: its names for OSV (a covering lockfile only keeps from OSV the names it sent), every dependency,
// ABOUTME: source and workspace member from outside the registry or the repository, its tools' index settings and uv's install-wide lists.
"use strict";

const { OBJECT_ID } = require("../util");
const { EXPECTED, FIND_LINKS, INDEX, LOCAL, UNREADABLE } = require("../packageSources");
const { manifestEntries, normalisePyPI, unnamedEntry, withoutBom, workspaceEntries } = require("./shared");
const { after, arrayTables, stringOf, tableFields, tomlValues } = require("./toml");
const { pythonAddress } = require("./python");
const { BUILD, EDITABLE, GROUPS, requirementListEntries } = require("./requirementLists");
const { pyprojectConfigEntries, UV_REQUIREMENT_LISTS, uvRequirementFound } = require("./pythonConfig");

const NAMED_INDEX = Object.freeze({ expected: false, kind: "host", address: null, text: "an index it cannot resolve" });

const isTrue = (value) => value.kind === "scalar" && value.text === "true";

// An index a dependency names, found by name among the file's indexes (the first of a name wins, as uv and Poetry take it; names
// compared by `sameName`): its address as an index, or a find-links page for a flat one; `builtIn` when no index has the name and
// the tool knows it.
function namedIndexVerdict(indexes, name, folder, builtIn, sameName = (a, b) => a === b) {
  const index = indexes.find((candidate) => candidate.name !== null && sameName(candidate.name, name));
  if (index === undefined) return builtIn ?? NAMED_INDEX;
  if (index.url === null) return builtIn ?? UNREADABLE;
  return pythonAddress(index.url, folder, { role: index.flat ? FIND_LINKS : INDEX });
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
// given, and exactly one when `required`). A field the tool does not have, a second source, or a source field that is not a
// string is one it cannot read. With no source field, the dependency is from the registry; an index field is found by
// `namedIndex`.
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

const UV_KINDS = ["git", "url", "path", "index", "workspace"];
const UV_FIELDS = new Set([
  ...UV_KINDS, "rev", "tag", "branch", "subdirectory", "lfs", "editable", "package", "marker", "extra", "group",
]);
const POETRY_KINDS = ["git", "url", "path", "source"];
const POETRY_FIELDS = new Set([
  ...POETRY_KINDS, "version", "branch", "tag", "rev", "subdirectory", "develop", "python", "platform", "markers", "optional",
  "extras", "allow-prereleases", "allows-prereleases",
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
    namedIndex: (name) => {
      const builtIn = name.toLowerCase() === "pypi" ? EXPECTED : undefined;
      return namedIndexVerdict(indexes.poetry, name, folder, builtIn, sameIgnoringCase);
    },
  });

// The indexes a file names by name, `[[tool.uv.index]]` or `[[tool.poetry.source]]`, as tables or as an array of inline tables.
function namedIndexes(values, prefix) {
  return arrayTables(values, prefix).tables.map(({ fields: given }) => {
    const fields = given ?? new Map();
    return {
      name: fields.has("name") ? stringOf(fields.get("name")) : null,
      url: fields.has("url") ? stringOf(fields.get("url")) : null,
      flat: fields.has("format") && stringOf(fields.get("format")) === "flat",
    };
  });
}

const PROJECT_DEPENDENCIES = ["project", "dependencies"];
const OPTIONAL_DEPENDENCIES = ["project", "optional-dependencies"];
const DEPENDENCY_GROUPS = ["dependency-groups"];
// Lists of PEP 508 strings that are build or development inputs: read for sources, their names never sent to OSV.
const OTHER_REQUIREMENT_LISTS = [
  ["build-system", "requires"],
  ["tool", "uv", "dev-dependencies"],
  ...UV_REQUIREMENT_LISTS.map((list) => ["tool", "uv", list]),
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

// A value under a uv or Poetry dependency table (`rest` being its path after the table): the dependency's name, the field the
// value is (none when it is the whole value), and the path up to the name, which identifies the dependency. A value deeper than a
// field makes the dependency one it cannot read.
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
// one of its `[[…]]` tables. A field given twice, a second whole value or a value deeper than a field makes it one it cannot
// read.
function addDependencyValue(dependency, place, value) {
  if (place.deeper) dependency.broken = true;
  else if (place.field === undefined) {
    dependency.broken ||= dependency.whole;
    Object.assign(dependency, { whole: true, value });
  } else {
    const { element } = place;
    if (element !== undefined && !dependency.elements.has(element)) dependency.elements.set(element, newTable());
    const table = element === undefined ? dependency.own : dependency.elements.get(element);
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
  const entry = (verdict, line) => {
    const source = verdict.expected ? {} : { classified: verdict };
    return { entry: { name: dependency.name, version: null, line, ...source }, checked: dependency.checked };
  };
  const fromTable = ({ fields, lines }) => {
    const kindLine = lines.get(kinds.find((kind) => lines.has(kind)));
    return entry(verdictOf(fields, folder, indexes), kindLine ?? dependency.line);
  };
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
// [project.optional-dependencies], [dependency-groups], [build-system] requires, uv's dev, override, constraint, build and
// dependency-metadata dependencies and PDM's dev-dependencies; [tool.uv.sources]; Poetry's dependency tables. Pixi and Hatch environments are not
// read. Each value is placed by its whole key path, so dotted keys, inline tables and table headers read alike, and any value in
// those sections in a shape it does not know is one it cannot read. The names of [project] dependencies and
// [tool.poetry.dependencies] are sent to OSV. Its settings that name an index or a source follow, read from the same values.
function readPyproject(text, folder = "") {
  const values = tomlValues(withoutBom(text));
  const indexes = {
    uv: namedIndexes(values, ["tool", "uv", "index"]),
    poetry: namedIndexes(values, ["tool", "poetry", "source"]),
  };
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
  // uv's install-wide lists are placed with the other lists above; only its dependency-metadata tables are read here.
  for (const uvFound of uvRequirementFound(values, ["tool", "uv"], folder, [])) found.push(uvFound);
  const entries = manifestEntries(found, (name) => (name === null ? null : normalisePyPI(name)));
  return [...entries, ...pyprojectConfigEntries(values, folder)];
}

module.exports = { readPyproject };

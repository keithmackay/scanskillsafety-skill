// ABOUTME: Reads a pyproject.toml: with no uv or Poetry lockfile, the names sent to OSV and every dependency, source and workspace
// ABOUTME: member from outside the registry or the repository; always, its uv, Poetry, PDM and Rye index settings; fails closed.
"use strict";

const { OBJECT_ID } = require("../util");
const { EXPECTED, LOCAL, UNREADABLE } = require("../packageSources");
const { configEntry, manifestEntries, normalisePyPI, unnamedEntry, unreadableNamed, workspaceEntries } = require("./shared");
const { tomlStatements } = require("./toml");
const { pythonAddress } = require("./python");
const { addressEntries, ENV_INDEX, specifierEntries, splitName } = require("./requirements");

const NAMED_INDEX = Object.freeze({ expected: false, kind: "host", address: null, text: "a named index" });

const TOML_LAYOUT = "not TOML it can read";
const withoutBom = (text) => (text.startsWith("\uFEFF") ? text.slice(1) : text);
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WHITESPACE = /\s/;

// The text of a one-line string, basic or literal; null for any other value.
const stringOf = (value) => {
  const oneLine = value.kind === "string" || value.kind === "literal";
  return oneLine && value.text !== undefined ? value.text : null;
};
const isTrue = (value) => value.kind === "scalar" && value.text === "true";

// The most parts of a key path kept: more than any section that names a source has. One part past it is kept, so a longer path
// still reads as deeper than every section, without a long path being copied for each value under it.
const MAX_PATH = 10;
const cappedPath = (path, more) => path.concat(more.slice(0, MAX_PATH + 1)).slice(0, MAX_PATH + 1);

// The path of a table header (at most MAX_PATH parts and one more), each array of tables in it followed by the number of its
// element: a new one for an `[[…]]` header's own array, the last one for an array it names on the way, as TOML reads
// `[index.cache-control]` after `[[index]]` as a table of that index. `elements` holds each array's last element by its path.
function headerPath(statement, elements) {
  const parts = statement.header.slice(0, MAX_PATH + 1);
  const own = statement.array && statement.header.length === parts.length;
  const path = [];
  parts.forEach((part, k) => {
    path.push(part);
    const id = JSON.stringify(path);
    if (own && k === parts.length - 1) {
      const element = (elements.get(id) ?? -1) + 1;
      elements.set(id, element);
      path.push(element);
    } else if (elements.has(id)) path.push(elements.get(id));
  });
  return cappedPath([], path);
}

// Every value of a TOML file with its key path (at most MAX_PATH parts and one more): the table it is in, its own dotted key and,
// for an inline table, each of its entries in turn; an array of tables adds the number of its element to the path, so it never
// reads as a name.
function tomlValues(text) {
  const values = [];
  let table = [];
  const elements = new Map();
  for (const statement of tomlStatements(text, TOML_LAYOUT, { anyLayout: true })) {
    if (statement.header) {
      table = headerPath(statement, elements);
      continue;
    }
    const stack = [{ path: cappedPath(table, statement.path), value: statement.value }];
    while (stack.length > 0) {
      const { path, value } = stack.pop();
      if (value.kind !== "table") values.push({ path, value });
      else {
        for (let k = value.entries.length - 1; k >= 0; k--) {
          stack.push({ path: cappedPath(path, value.entries[k].path), value: value.entries[k].value });
        }
      }
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

// An address with the project's folder written as PDM or Hatch write it, as a path from the pyproject's folder; any other
// unchanged.
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
    // A multi-line string has no text, so like any other item it does not know it is one it cannot read.
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

// The tables of an array of tables at `prefix`, written as `[[…]]` tables or as an array of inline tables: each its fields by name
// (null for an item that is not an inline table of single names), the line it starts on, and the names of fields with values
// nested below them. `badLine` is the line of the first value at the prefix in any other shape, or null.
function arrayTables(values, prefix) {
  const tables = new Map();
  let badLine = null;
  for (const { path, value } of values) {
    const rest = after(path, prefix);
    if (rest === null) continue;
    if (rest.length === 0 && value.kind === "array") {
      value.items.forEach((item, k) => tables.set(`item${k}`, { fields: tableFields(item), line: item.line, nested: new Set() }));
    } else if (rest.length >= 2 && typeof rest[0] === "number" && typeof rest[1] === "string") {
      if (!tables.has(rest[0])) tables.set(rest[0], { fields: new Map(), line: value.line, nested: new Set() });
      const table = tables.get(rest[0]);
      if (rest.length > 2) table.nested.add(rest[1]);
      else table.fields.set(rest[1], value);
    } else badLine ??= value.line;
  }
  return { tables: [...tables.values()], badLine };
}

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

// Config settings that name where packages come from.

// An index or find-links address a setting names, `role` saying which: one set from an environment variable is said to be so;
// PDM's and Hatch's project folder is read as a path; a path inside the repository is a folder of archives; PyPI's index gives
// nothing.
function configAddressEntries(address, line, folder, role) {
  const relative = projectRelative(address);
  if (relative.includes("${")) return [configEntry(line, ENV_INDEX)];
  const verdict = pythonAddress(relative, folder, { pathField: true, role });
  return verdict.expected ? [] : [configEntry(line, verdict)];
}

// uv's settings that name an index or a find-links page: one address, or a list of them.
const UV_ADDRESS_SETTINGS = new Map([
  ["index-url", { role: "index", list: false }],
  ["extra-index-url", { role: "index", list: true }],
  ["find-links", { role: "find-links", list: true }],
]);

// uv's index-url, extra-index-url and find-links at `prefix` (the top of uv.toml, [tool.uv] in pyproject.toml); a setting that is
// not a string, or a list of strings where uv takes one, is one it cannot read.
function uvSettingEntries(values, prefix, folder) {
  const out = [];
  for (const { path, value } of values) {
    const rest = after(path, prefix);
    if (rest === null || !UV_ADDRESS_SETTINGS.has(rest[0])) continue;
    const { role, list } = UV_ADDRESS_SETTINGS.get(rest[0]);
    const items = list && value.kind === "array" ? value.items : [value];
    const addresses = items.map(stringOf);
    const shaped = rest.length === 1 && list === (value.kind === "array") && addresses.every((address) => address !== null);
    if (!shaped) out.push(configEntry(value.line, UNREADABLE));
    else items.forEach((item, k) => out.push(...configAddressEntries(addresses[k], item.line, folder, role)));
  }
  return out;
}

// The url of each table at `prefix` (uv's indexes, Poetry's and PDM's sources), read as what the table says it is (`roleOf`: an
// index or a find-links page, or null for a kind the tool does not take). A table with no url is one it cannot read unless the
// tool needs none for it (`urlOptional`); a malformed section is one it cannot read, once.
function sourceTableEntries(values, prefix, folder, { roleOf, urlOptional = () => false }) {
  const { tables, badLine } = arrayTables(values, prefix);
  const out = badLine === null ? [] : [configEntry(badLine, UNREADABLE)];
  for (const { fields, line, nested } of tables) {
    const url = fields?.get("url");
    const urlLine = url?.line ?? line;
    if (fields === null || nested.has("url")) out.push(configEntry(urlLine, UNREADABLE));
    else if (url === undefined) {
      if (!urlOptional(fields)) out.push(configEntry(line, UNREADABLE));
    } else {
      const role = roleOf(fields);
      const address = stringOf(url);
      if (role === null || address === null) out.push(configEntry(urlLine, UNREADABLE));
      else out.push(...configAddressEntries(address, urlLine, folder, role));
    }
  }
  return out;
}

// What a table's field names it as, by its value: `kinds` maps each value the tool takes to a role; with no field, `absent`.
const roleByField = (field, kinds, absent) => (fields) => {
  if (!fields.has(field)) return absent;
  return kinds.get(stringOf(fields.get(field))) ?? null;
};

const UV_INDEX_ROLE = roleByField("format", new Map([["simple", "index"], ["flat", "find-links"]]), "index");
const PDM_SOURCE_ROLE = roleByField("type", new Map([["index", "index"], ["find_links", "find-links"]]), "index");

const RYE_SOURCE_ROLE = roleByField("type", new Map([["index", "index"], ["find-links", "find-links"]]), "index");

// uv's settings and indexes at `prefix` (the top of uv.toml, or [tool.uv] in pyproject.toml), and its settings for `uv pip` below
// it in [pip].
const uvConfigEntries = (values, prefix, folder) => [
  ...uvSettingEntries(values, prefix, folder),
  ...uvSettingEntries(values, [...prefix, "pip"], folder),
  ...sourceTableEntries(values, [...prefix, "index"], folder, { roleOf: UV_INDEX_ROLE }),
];

// uv's lists of PEP 508 strings that apply to every install, read whether or not a lockfile is present.
const UV_REQUIREMENT_LISTS = ["override-dependencies", "constraint-dependencies"];

// uv's override and constraint lists and each `dependency-metadata` table's `requires-dist` at `prefix` (the top of uv.toml, or
// [tool.uv] in pyproject.toml), as a manifest's found entries whose names are never sent to OSV; a list or table in any other
// shape is one it cannot read.
function uvRequirementFound(values, prefix, folder) {
  const entries = [];
  for (const { path, value } of values) {
    const rest = after(path, prefix);
    if (rest === null || !UV_REQUIREMENT_LISTS.includes(rest[0])) continue;
    if (rest.length === 1) for (const entry of requirementListEntries(value, folder)) entries.push(entry);
    else entries.push(unnamedEntry(value.line));
  }
  const { tables, badLine } = arrayTables(values, [...prefix, "dependency-metadata"]);
  if (badLine !== null) entries.push(unnamedEntry(badLine));
  for (const { fields, line, nested } of tables) {
    if (fields === null || nested.has("requires-dist")) entries.push(unnamedEntry(line));
    else if (fields.has("requires-dist")) for (const entry of requirementListEntries(fields.get("requires-dist"), folder)) entries.push(entry);
  }
  return entries.map((entry) => ({ entry, checked: false }));
}

// Those lists as entries, without a manifest's other lists: only the packages from outside the registry.
const uvRequirementEntries = (values, prefix, folder) =>
  manifestEntries(uvRequirementFound(values, prefix, folder), (name) => (name === null ? null : normalisePyPI(name)));

// pdm.toml's indexes: [pypi] url, PyPI's replacement, an index; and [pypi.<name>] url, an index or, with `type = "find_links"`, a
// find-links page. A url in any other place under [pypi], one that is not a string, or a type PDM does not take is one it cannot
// read.
function pdmTomlEntries(values, folder) {
  const types = new Map();
  for (const { path, value } of values) {
    if (path.length === 3 && path[0] === "pypi" && typeof path[1] === "string" && path[2] === "type") types.set(path[1], value);
  }
  const roleOf = (name) => (name === null ? "index" : PDM_SOURCE_ROLE(types.has(name) ? new Map([["type", types.get(name)]]) : new Map()));
  const out = [];
  for (const { path, value } of values) {
    if (path[0] !== "pypi") continue;
    const rest = path.slice(1);
    const named = rest.length === 2 && typeof rest[0] === "string" && rest[1] === "url";
    const atUrl = (rest.length === 1 && rest[0] === "url") || named;
    const address = atUrl ? stringOf(value) : null;
    const role = atUrl ? roleOf(named ? rest[0] : null) : null;
    const misplaced = rest.length === 0 || typeof rest[0] !== "string" || rest.slice(0, 2).includes("url");
    if (address !== null && role !== null) out.push(...configAddressEntries(address, value.line, folder, role));
    else if (atUrl || misplaced) out.push(configEntry(value.line, UNREADABLE));
  }
  return out;
}

// pyproject.toml's settings that name where packages come from: uv's, Poetry's sources (one named PyPI needs no url), PDM's and
// Rye's.
const pyprojectConfigEntries = (values, folder) => [
  ...uvConfigEntries(values, ["tool", "uv"], folder),
  ...sourceTableEntries(values, ["tool", "poetry", "source"], folder, {
    roleOf: () => "index",
    urlOptional: (fields) => fields.has("name") && stringOf(fields.get("name"))?.toLowerCase() === "pypi",
  }),
  ...sourceTableEntries(values, ["tool", "pdm", "source"], folder, { roleOf: PDM_SOURCE_ROLE }),
  ...sourceTableEntries(values, ["tool", "rye", "sources"], folder, { roleOf: RYE_SOURCE_ROLE }),
];

const PROJECT_DEPENDENCIES = ["project", "dependencies"];
const OPTIONAL_DEPENDENCIES = ["project", "optional-dependencies"];
const DEPENDENCY_GROUPS = ["dependency-groups"];
// Lists of PEP 508 strings that are build or development inputs: read for sources, their names never sent to OSV.
const OTHER_REQUIREMENT_LISTS = [
  ["build-system", "requires"],
  ["tool", "uv", "dev-dependencies"],
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
  for (const uvFound of uvRequirementFound(values, ["tool", "uv"], folder)) found.push(uvFound);
  const entries = manifestEntries(found, (name) => (name === null ? null : normalisePyPI(name)));
  return [...entries, ...pyprojectConfigEntries(values, folder)];
}

// pyproject.toml read, for a target with a uv or Poetry lockfile, only for its settings that name where packages come from and
// uv's lists that apply to every install.
function readPyprojectConfig(text, folder = "") {
  const values = tomlValues(withoutBom(text));
  return [...uvRequirementEntries(values, ["tool", "uv"], folder), ...pyprojectConfigEntries(values, folder)];
}

module.exports = { readPyproject, readPyprojectConfig, tomlValues, uvConfigEntries, uvRequirementEntries, pdmTomlEntries };

// ABOUTME: Reads the packages in Python lockfiles, each with its line: poetry.lock and uv.lock package blocks and where each comes
// ABOUTME: from, read strictly as Poetry and uv write their TOML; and the one rule for where a path in a Python file points.
"use strict";

const { OBJECT_ID } = require("../util");
const { classifySource, LOCAL, UNREADABLE } = require("../packageSources");
const { bundled, gitRepositorySource, isPackageArchive, OUTSIDE_PROJECT, pathFrom, staysInside, unnamedEntry, Unreadable, UNREADABLE_ENTRY } = require("./shared");
const { tomlStatements } = require("./toml");

// The fields Poetry writes in [package.source].
const POETRY_SOURCE_FIELDS = new Set(["type", "url", "reference", "resolved_reference", "subdirectory"]);
// The kinds of uv `source`, one per source; `subdirectory` may sit beside `url`.
const UV_SOURCE_KINDS = ["registry", "git", "url", "path", "directory", "editable", "virtual"];
// The fields uv writes in an `sdist` or a `wheels` item.
const UV_FILE_FIELDS = new Set(["url", "path", "filename", "hash", "size", "upload-time"]);
const PROJECT = Object.freeze({ project: true });
// A Poetry block with no [package.source]: from whatever index the project is set to use.
const NO_SOURCE = Object.freeze({});

// The starts of an address that make it a path rather than a URL: absolute, home, or relative to the lockfile's folder.
const PATH_STARTS = ["/", "~", "./", "../"];
const DRIVE = /^[A-Za-z]:(?:[\\/]|$)/;

// Where an address in a Python lockfile points, `folder` being the lockfile's folder in the repository. A `file:` URL is outside
// the project. A path (absolute, home, a drive, starting `./` or `../`, or, in a field that holds a path, any name with no `:`) is
// local while it stays inside the repository and outside the project otherwise; inside it, an archive, or a folder a field names
// as an index or find-links, holds packages as files and is bundled. The archive is judged on the path as pip normalises it, so a
// trailing slash or `.` segment still names it. Any other address is classified: as a git
// repository when the field names one, as one archive when it pins one, and by what the field names (`role`, an index or
// find-links).
function pythonAddress(address, folder, { pathField = false, git = false, direct = false, role } = {}) {
  if (/^file:/i.test(address)) return OUTSIDE_PROJECT;
  const named = PATH_STARTS.some((start) => address.startsWith(start)) || DRIVE.test(address);
  if (named || (pathField && !address.includes(":"))) {
    if (!staysInside(folder, address)) return OUTSIDE_PROJECT;
    const repositoryPath = pathFrom(folder, address);
    return role !== undefined || isPackageArchive(repositoryPath) ? bundled(repositoryPath) : LOCAL;
  }
  return classifySource("PyPI", git ? gitRepositorySource(address, "").source : address, { direct, role });
}

// Where a Poetry package comes from, by its [package.source] `type`: an index (`legacy`), a git repository at
// `resolved_reference`, one archive (`url`), or a file or folder. Any other type, or no `url`, is one it cannot read.
function poetryOrigin(block, folder) {
  if (block.source === null) return NO_SOURCE;
  const type = block.source.get("type");
  const url = block.source.get("url");
  if (url === undefined) return UNREADABLE_ENTRY;
  if (type === "legacy") return { classified: pythonAddress(url, folder, { role: "index" }) };
  if (type === "url") return { classified: pythonAddress(url, folder, { direct: true }) };
  if (type === "file" || type === "directory") return { classified: pythonAddress(url, folder, { pathField: true }) };
  if (type !== "git") return UNREADABLE_ENTRY;
  const verdict = pythonAddress(url, folder, { git: true });
  const commit = block.source.get("resolved_reference") ?? "";
  return { classified: verdict.kind === "git" && OBJECT_ID.test(commit) ? { ...verdict, commit } : verdict };
}

// The fields of an inline table written as uv writes one, by name; null when it is not one or a name is given twice.
function uvTable(value) {
  if (value === undefined || value.kind !== "table" || !value.exact) return null;
  const fields = new Map();
  for (const entry of value.entries) {
    if (fields.has(entry.key)) return null;
    fields.set(entry.key, entry.value);
  }
  return fields;
}

// A uv `source`: exactly one kind, a string: an index (a folder when it is a path), a git repository with its commit after `#`, one
// archive, a file or folder, or the project itself (`editable` or `virtual` inside the repository).
function uvSourceVerdict(value, folder) {
  const fields = uvTable(value);
  const kinds = fields ? UV_SOURCE_KINDS.filter((kind) => fields.has(kind)) : [];
  if (kinds.length !== 1) return UNREADABLE;
  const [kind] = kinds;
  const extra = kind === "url" && fields.has("subdirectory") ? 1 : 0;
  const address = fields.get(kind);
  if (fields.size !== 1 + extra || address.kind !== "string") return UNREADABLE;
  if (kind === "git") return pythonAddress(address.raw, folder, { git: true });
  if (kind === "url") return pythonAddress(address.raw, folder, { direct: true });
  const verdict = pythonAddress(address.raw, folder, { pathField: true, role: kind === "registry" ? "index" : undefined });
  return (kind === "editable" || kind === "virtual") && verdict === LOCAL ? PROJECT : verdict;
}

// A uv `sdist` or `wheels` item: the address of its `url` or its `path`, null when it names neither.
function uvFileVerdict(value, folder) {
  const fields = uvTable(value);
  if (!fields || [...fields.keys()].some((name) => !UV_FILE_FIELDS.has(name)) || (fields.has("url") && fields.has("path"))) {
    return UNREADABLE;
  }
  const address = fields.get("url") ?? fields.get("path");
  if (address === undefined) return null;
  if (address.kind !== "string") return UNREADABLE;
  return pythonAddress(address.raw, folder, { pathField: fields.has("path") });
}

// Where a uv package comes from: the first address that is neither the registry nor a path inside the project among its source,
// its sdist and its wheels, else what its source is. A package with no source, or a project with files, is one it cannot read.
function uvOrigin(block, folder) {
  const source = block.fields.get("source");
  if (source === undefined) return UNREADABLE_ENTRY;
  const verdicts = [uvSourceVerdict(source.value, folder)];
  const sdist = block.fields.get("sdist");
  if (sdist !== undefined) verdicts.push(uvFileVerdict(sdist.value, folder));
  const wheels = block.fields.get("wheels");
  if (wheels !== undefined) {
    const laidOut = wheels.value.kind === "array" && wheels.value.exact;
    if (laidOut) verdicts.push(...wheels.value.items.map((item) => uvFileVerdict(item, folder)));
    else verdicts.push(UNREADABLE);
  }
  const named = verdicts.filter((verdict) => verdict !== null);
  if (named[0] === PROJECT) return named.length === 1 ? PROJECT : UNREADABLE_ENTRY;
  const reported = named.find((verdict) => !verdict.expected && verdict.kind !== "local");
  return { classified: reported ?? named[0] };
}

// Poetry writes a package's source as a [package.source] table; uv as `source`, `sdist` and `wheels` fields of the block. Each
// writes its own other sub-tables of a [[package]] block, none of which names where the package comes from.
const POETRY = {
  tool: "Poetry",
  sourceTable: true,
  writesEmptyList: true,
  otherTables: new Set(["dependencies", "extras"]),
  foreignFields: ["source", "sdist", "wheels"],
  origin: poetryOrigin,
};
const UV = {
  tool: "uv",
  sourceTable: false,
  writesEmptyList: false,
  otherTables: new Set(["optional-dependencies", "dev-dependencies", "metadata", "group-requires-python"]),
  foreignFields: [],
  origin: uvOrigin,
};

// A block field's text: undefined when it is not given, null when it is not a basic string with no escape.
function fieldText(block, name) {
  const field = block.fields.get(name);
  if (field === undefined) return undefined;
  return field.value.kind === "string" && field.value.plain ? field.value.raw : null;
}

// What a finished block stands for: the project itself (skipped, `{ project: true }`), or an entry. A block in a shape the tool
// does not write, or with neither a version nor a source of its own, is one it cannot read; one with no name it can read is one
// it cannot name.
function blockEntry(block, format, folder) {
  const name = fieldText(block, "name");
  const version = fieldText(block, "version");
  const origin = format.origin(block, folder);
  const odd = format.foreignFields.some((field) => block.fields.has(field));
  const unversioned = version === undefined && origin === NO_SOURCE;
  const unreadable = block.unreadable || odd || name === null || version === null || unversioned;
  if (origin === PROJECT && !unreadable) return PROJECT;
  if (typeof name !== "string") return unnamedEntry(block.line);
  return { name, version: version ?? null, line: block.fields.get("name").line, ...(unreadable ? UNREADABLE_ENTRY : origin) };
}

// A field of a block's own table, written as the tool writes one and given once, or the block is one it cannot read.
function readBlockField(block, { key, exact, value, line }) {
  if (!exact || block.fields.has(key)) block.unreadable = true;
  else block.fields.set(key, { value, line });
}

// A field of Poetry's [package.source]: one Poetry writes, written as it writes it, a basic string with no escape, given once.
function readSourceField(block, { key, exact, value }) {
  const known = exact && POETRY_SOURCE_FIELDS.has(key) && !block.source.has(key);
  if (known && value.kind === "string" && value.plain) block.source.set(key, value.raw);
  else block.unreadable = true;
}

// `package = []` written as Poetry writes it for a project with no dependencies.
const isEmptyPackageList = ({ key, exact, value }) =>
  key === "package" && exact && value.kind === "array" && value.items.length === 0 && value.exact;

// poetry.lock and uv.lock, read statement by statement. Each [[package]] block runs through its sub-tables until the next
// [[package]] or another top-level table. Before the first table, a key is a bare name other than `package`, except Poetry's
// `package = []`, after which no package table may follow; a package sub-table with no block before it, among other tables, means
// the file is not one it can read, and a file with neither blocks nor that empty list is one with no packages found in it. In a
// block, every field of its own table and of Poetry's [package.source] must be written as the tool writes it, or the block is one
// it cannot read; a sub-table it does not know is one too.
function readPackageBlocks(text, format, folder) {
  const layout = `not laid out as ${format.tool} writes it`;
  const out = [];
  let block = null;
  let blocks = 0;
  let emptyList = false;
  let table = "root";
  const finish = () => {
    if (!block) return;
    const entry = blockEntry(block, format, folder);
    block = null;
    if (entry !== PROJECT) out.push(entry);
  };
  for (const statement of tomlStatements(text, layout)) {
    if (statement.header) {
      const [top, sub, ...deeper] = statement.header;
      if (top !== "package") {
        finish();
        table = "other";
      } else if (emptyList) throw new Unreadable(layout);
      else if (statement.array && sub === undefined) {
        finish();
        blocks++;
        block = { line: statement.line, fields: new Map(), source: null, unreadable: false };
        table = "block";
      } else if (!block) throw new Unreadable(layout);
      else if (format.otherTables.has(sub)) table = "other";
      else if (format.sourceTable && sub === "source" && !statement.array && deeper.length === 0 && block.source === null) {
        block.source = new Map();
        table = "source";
      } else {
        block.unreadable = true;
        table = "other";
      }
    } else if (table === "root") {
      if (format.writesEmptyList && !emptyList && isEmptyPackageList(statement)) emptyList = true;
      else if (statement.key === null || statement.key === "package") throw new Unreadable(layout);
    } else if (table === "block") readBlockField(block, statement);
    else if (table === "source") readSourceField(block, statement);
  }
  finish();
  if (blocks === 0 && !emptyList) throw new Unreadable("no packages found in it");
  return out;
}

// text: the lockfile; folder: its folder in the repository, which a relative path in it is read from.
const readPoetryLock = (text, folder = "") => readPackageBlocks(text, POETRY, folder);
const readUvLock = (text, folder = "") => readPackageBlocks(text, UV, folder);

module.exports = { readPoetryLock, readUvLock, pythonAddress };

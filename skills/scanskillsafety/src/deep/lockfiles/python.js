// ABOUTME: Reads the packages in Python lockfiles, each with its line: poetry.lock and uv.lock package blocks and where each comes
// ABOUTME: from, read strictly as Poetry and uv write their TOML, and the pinned versions in a requirements file.
"use strict";

const { classifySource, LOCAL, UNREADABLE } = require("../packageSources");
const { found, gitRepositorySource, linesOf, unnamedEntry, Unreadable, UNREADABLE_ENTRY } = require("./shared");

const BARE_KEY_CHAR = /[A-Za-z0-9_-]/;
const HEADER_CHAR = /[A-Za-z0-9_.-]/;
// The characters of an unquoted TOML value Poetry and uv write: integers, booleans and dates without a space.
const SCALAR_CHAR = /[A-Za-z0-9_.:+-]/;
// How deep arrays and inline tables nest; Poetry and uv write three levels at most.
const MAX_NESTING = 8;
const LONE_CR = /\r(?!\n)/;

// Whether the whitespace, newlines and comments around an array's items (`gaps`: after `[`, then after each item and each comma)
// are laid out as Poetry and uv write an array: all on one line as `[a, b]`, or one item per line, indented four spaces, each
// followed by a comma, with `]` alone on the last line.
function arrayLaidOut(gaps, items) {
  if (items === 0) return gaps.length === 1 && gaps[0] === "";
  const oneLine = gaps.length === 2 * items && gaps.every((gap, k) => gap === (k > 0 && k % 2 === 0 ? " " : ""));
  const perLine = gaps.length === 2 * items + 1 && gaps.every((gap, k) => gap === (k === 2 * items ? "\n" : k % 2 === 0 ? "\n    " : ""));
  return oneLine || perLine;
}

// The statements of a TOML file, in order: table headers `{ line, header, array }` and key/value pairs `{ line, key, exact,
// value }`. A key is its name when it is one bare key, otherwise null; `exact` says the pair is written as Poetry and uv write one:
// at the start of its line, `name = value`, nothing after the value. A value is a string (`plain` when it is a basic string with no
// escape), a literal string, a scalar, an array or an inline table, each `exact` when written as uv writes it. TOML that neither
// tool writes in a way that changes which table a line belongs to (a multi-line string, a statement that does not start its line,
// a header that is not bare names joined by dots, an inline table across lines, a tab or a lone carriage return between tokens,
// values nested deeper than MAX_NESTING) means the file is not one it can read.
function tomlStatements(text, layout) {
  const fail = () => {
    throw new Unreadable(layout);
  };
  if (LONE_CR.test(text)) fail();
  let i = 0;
  let line = 1;
  const atLineEnd = () => i >= text.length || text[i] === "\n" || (text[i] === "\r" && text[i + 1] === "\n");
  const spaces = () => {
    const start = i;
    while (text[i] === " ") i++;
    return i - start;
  };
  const skipComment = () => {
    if (text[i] !== "#") return false;
    while (!atLineEnd()) i++;
    return true;
  };
  const newline = () => {
    i += text[i] === "\r" ? 2 : 1;
    line++;
  };

  function basicString() {
    if (text.startsWith('"""', i)) fail();
    let plain = true;
    const start = ++i;
    while (text[i] !== '"') {
      if (atLineEnd()) fail();
      if (text[i] === "\\") {
        plain = false;
        i++;
        if (atLineEnd()) fail();
      }
      i++;
    }
    return { kind: "string", text: text.slice(start, i++), plain, exact: plain };
  }

  function literalString() {
    if (text.startsWith("'''", i)) fail();
    i++;
    while (text[i] !== "'") {
      if (atLineEnd()) fail();
      i++;
    }
    i++;
    return { kind: "literal", exact: false };
  }

  function scalar() {
    const start = i;
    while (i < text.length && SCALAR_CHAR.test(text[i])) i++;
    if (i === start) fail();
    return { kind: "scalar", text: text.slice(start, i), exact: true };
  }

  // A key, dotted or not, each part bare or quoted, as TOML allows; its name when it is one bare key, otherwise null.
  function key() {
    let name = null;
    for (let parts = 1; ; parts++) {
      const start = i;
      if (text[i] === '"') basicString();
      else if (text[i] === "'") literalString();
      else {
        while (i < text.length && BARE_KEY_CHAR.test(text[i])) i++;
        if (i === start) fail();
      }
      const quoted = text[start] === '"' || text[start] === "'";
      name = parts === 1 && !quoted ? text.slice(start, i) : null;
      const end = i;
      spaces();
      if (text[i] !== ".") {
        i = end;
        return name;
      }
      i++;
      spaces();
    }
  }

  // The whitespace, newlines and comments between array items, newlines written as `\n`.
  function arrayGap() {
    const start = i;
    for (;;) {
      if (text[i] === " ") i++;
      else if (text[i] === "#") skipComment();
      else if (i < text.length && atLineEnd()) newline();
      else break;
    }
    return text.slice(start, i).replace(/\r\n/g, "\n");
  }

  function array(depth) {
    i++;
    const items = [];
    const gaps = [arrayGap()];
    while (text[i] !== "]") {
      items.push(value(depth + 1));
      gaps.push(arrayGap());
      if (text[i] === ",") {
        i++;
        gaps.push(arrayGap());
      } else if (text[i] !== "]") fail();
    }
    i++;
    return { kind: "array", items, exact: items.every((item) => item.exact) && arrayLaidOut(gaps, items.length) };
  }

  // An inline table on one line; `exact` when written as uv writes one, `{ name = value, name = value }` with bare names.
  function inlineTable(depth) {
    i++;
    const entries = [];
    const leading = spaces();
    if (text[i] === "}") {
      i++;
      return { kind: "table", entries, exact: leading === 0 };
    }
    let exact = leading === 1;
    for (;;) {
      const name = key();
      const before = spaces();
      if (text[i] !== "=") fail();
      i++;
      const after = spaces();
      const item = value(depth + 1);
      entries.push({ key: name, value: item });
      exact = exact && name !== null && before === 1 && after === 1 && item.exact;
      const trailing = spaces();
      if (text[i] === "}") {
        i++;
        return { kind: "table", entries, exact: exact && trailing === 1 };
      }
      if (text[i] !== ",") fail();
      i++;
      const gap = spaces();
      exact = exact && trailing === 0 && gap === 1;
      if (text[i] === "}") fail();
    }
  }

  function value(depth = 0) {
    if (depth > MAX_NESTING) fail();
    if (text[i] === '"') return basicString();
    if (text[i] === "'") return literalString();
    if (text[i] === "[") return array(depth);
    if (text[i] === "{") return inlineTable(depth);
    return scalar();
  }

  function header() {
    const array = text.startsWith("[[", i);
    i += array ? 2 : 1;
    const start = i;
    while (i < text.length && HEADER_CHAR.test(text[i])) i++;
    const path = text.slice(start, i).split(".");
    const close = array ? "]]" : "]";
    if (path.includes("") || !text.startsWith(close, i)) fail();
    i += close.length;
    return { header: path, array };
  }

  function pair() {
    const name = key();
    const before = spaces();
    if (text[i] !== "=") fail();
    i++;
    const after = spaces();
    return { key: name, exact: name !== null && before === 1 && after === 1, value: value() };
  }

  const statements = [];
  while (i < text.length) {
    const indent = spaces();
    if (skipComment() || atLineEnd()) {
      if (i < text.length) newline();
      continue;
    }
    if (indent > 0) fail();
    const statement = { line, ...(text[i] === "[" ? header() : pair()) };
    const trailing = spaces();
    const commented = skipComment();
    if (!atLineEnd()) fail();
    if (statement.exact) statement.exact = trailing === 0 && !commented;
    statements.push(statement);
    if (i < text.length) newline();
  }
  return statements;
}

// Sub-tables of a [[package]] block that never name where the package comes from.
const OTHER_PACKAGE_TABLES = new Set(["dependencies", "extras", "optional-dependencies", "dev-dependencies", "metadata"]);
// The fields Poetry writes in [package.source].
const POETRY_SOURCE_FIELDS = new Set(["type", "url", "reference", "resolved_reference", "subdirectory"]);
// The kinds of uv `source`, one per source; `subdirectory` may sit beside `url`.
const UV_SOURCE_KINDS = ["registry", "git", "url", "path", "directory", "editable", "virtual"];
// The fields uv writes in an `sdist` or a `wheels` item.
const UV_FILE_FIELDS = new Set(["url", "path", "filename", "hash", "size", "upload-time"]);
const OUTSIDE_PROJECT = Object.freeze({ expected: false, kind: "url", address: null, text: "a path outside the project" });
const PROJECT = Object.freeze({ project: true });
// A Poetry block with no [package.source]: from whatever index the project is set to use.
const NO_SOURCE = Object.freeze({});

// A relative path that never leaves the lockfile's folder, `..` segments included; an absolute path, a home path, a drive or a
// scheme leaves it.
function staysInside(path) {
  if (path === "" || path.startsWith("/") || path.startsWith("~") || path.includes(":") || path.includes("\\")) return false;
  let depth = 0;
  for (const segment of path.split("/")) {
    if (segment === "..") depth--;
    else if (segment !== "." && segment !== "") depth++;
    if (depth < 0) return false;
  }
  return true;
}

// Where a Poetry package comes from, by its [package.source] `type`: an index (`legacy`), a git repository at
// `resolved_reference`, one archive (`url`), or a file or folder, local when it stays inside the project. Any other type, or no
// `url`, is one it cannot read.
function poetryOrigin(block) {
  if (block.source === null) return NO_SOURCE;
  const type = block.source.get("type");
  const url = block.source.get("url");
  if (url === undefined) return UNREADABLE_ENTRY;
  if (type === "legacy") return { source: url };
  if (type === "url") return { source: url, direct: true };
  if (type === "git") return gitRepositorySource(url, block.source.get("resolved_reference") ?? "");
  if (type === "file" || type === "directory") return { classified: staysInside(url) ? LOCAL : OUTSIDE_PROJECT };
  return UNREADABLE_ENTRY;
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

// A uv `source`: exactly one kind, a string: an index (a folder when it has no `:`), a git repository with its commit after `#`,
// one archive, a local path, or the project itself (`editable`, `virtual`).
function uvSourceVerdict(value) {
  const fields = uvTable(value);
  const kinds = fields ? UV_SOURCE_KINDS.filter((kind) => fields.has(kind)) : [];
  if (kinds.length !== 1) return UNREADABLE;
  const [kind] = kinds;
  const extra = kind === "url" && fields.has("subdirectory") ? 1 : 0;
  const address = fields.get(kind);
  if (fields.size !== 1 + extra || address.kind !== "string") return UNREADABLE;
  if (kind === "editable" || kind === "virtual") return PROJECT;
  if (kind === "path" || kind === "directory") return LOCAL;
  if (kind === "registry") return address.text.includes(":") ? classifySource("PyPI", address.text) : LOCAL;
  if (kind === "git") return classifySource("PyPI", gitRepositorySource(address.text, "").source);
  return classifySource("PyPI", address.text, { direct: true });
}

// A uv `sdist` or `wheels` item: the address of its `url`, local for a `path`, null when it names neither.
function uvFileVerdict(value) {
  const fields = uvTable(value);
  if (!fields || [...fields.keys()].some((name) => !UV_FILE_FIELDS.has(name)) || (fields.has("url") && fields.has("path"))) {
    return UNREADABLE;
  }
  const address = fields.get("url") ?? fields.get("path");
  if (address === undefined) return null;
  if (address.kind !== "string") return UNREADABLE;
  return fields.has("url") ? classifySource("PyPI", address.text) : LOCAL;
}

// Where a uv package comes from: the first address that is not the registry among its source, its sdist and its wheels, else a
// local one, else the registry. A package with no source, or a project with files, is one it cannot read.
function uvOrigin(block) {
  const source = block.fields.get("source");
  if (source === undefined) return UNREADABLE_ENTRY;
  const verdicts = [uvSourceVerdict(source.value)];
  const sdist = block.fields.get("sdist");
  if (sdist !== undefined) verdicts.push(uvFileVerdict(sdist.value));
  const wheels = block.fields.get("wheels");
  if (wheels !== undefined) {
    if (wheels.value.kind === "array" && wheels.value.exact) verdicts.push(...wheels.value.items.map(uvFileVerdict));
    else verdicts.push(UNREADABLE);
  }
  const named = verdicts.filter((verdict) => verdict !== null);
  if (named[0] === PROJECT) return named.length === 1 ? PROJECT : UNREADABLE_ENTRY;
  const reported = named.find((verdict) => !verdict.expected && verdict.kind !== "local");
  return { classified: reported ?? named.find((verdict) => verdict.kind === "local") ?? named[0] };
}

// Poetry writes a package's source as a [package.source] table; uv as `source`, `sdist` and `wheels` fields of the block.
const POETRY = { tool: "Poetry", sourceTable: true, foreignFields: ["source", "sdist", "wheels"], origin: poetryOrigin };
const UV = { tool: "uv", sourceTable: false, foreignFields: [], origin: uvOrigin };

// A block field's text: undefined when it is not given, null when it is not a basic string with no escape.
function fieldText(block, name) {
  const field = block.fields.get(name);
  if (field === undefined) return undefined;
  return field.value.kind === "string" && field.value.plain ? field.value.text : null;
}

// What a finished block stands for: the project itself (skipped, `{ project: true }`), or an entry, null when a block that names
// no source of its own has no version. A block in a shape the tool does not write is one it cannot read; one with no name it can
// read is one it cannot name.
function blockEntry(block, format) {
  const name = fieldText(block, "name");
  const version = fieldText(block, "version");
  const origin = format.origin(block);
  const odd = format.foreignFields.some((field) => block.fields.has(field));
  const unreadable = block.unreadable || odd || name === null || version === null;
  if (origin === PROJECT && !unreadable) return PROJECT;
  if (typeof name !== "string") return { entry: unnamedEntry(block.line) };
  if (version === undefined && origin === NO_SOURCE && !unreadable) return { entry: null };
  return { entry: { name, version: version ?? null, line: block.fields.get("name").line, ...(unreadable ? UNREADABLE_ENTRY : origin) } };
}

// A field of a block's own table, written as the tool writes one and given once, or the block is one it cannot read.
function readBlockField(block, { key, exact, value, line }) {
  if (!exact || block.fields.has(key)) block.unreadable = true;
  else block.fields.set(key, { value, line });
}

// A field of Poetry's [package.source]: one Poetry writes, written as it writes it, a basic string with no escape, given once.
function readSourceField(block, { key, exact, value }) {
  const known = exact && POETRY_SOURCE_FIELDS.has(key) && !block.source.has(key);
  if (known && value.kind === "string" && value.plain) block.source.set(key, value.text);
  else block.unreadable = true;
}

// poetry.lock and uv.lock, read statement by statement. Each [[package]] block runs through its sub-tables until the next
// [[package]] or another top-level table. Before the first table, a key is a bare name other than `package`; a package sub-table
// with no block before it, among other tables, means the file is not one it can read. In a block, every field of its own table
// and of Poetry's [package.source] must be written as the tool writes it, or the block is one it cannot read; a sub-table it does
// not know is one too.
function readPackageBlocks(text, format) {
  const layout = `not laid out as ${format.tool} writes it`;
  const out = [];
  let entries = 0;
  let block = null;
  let table = "root";
  const finish = () => {
    if (!block) return;
    const read = blockEntry(block, format);
    block = null;
    if (read === PROJECT) return;
    entries++;
    if (read.entry) out.push(read.entry);
  };
  for (const statement of tomlStatements(text, layout)) {
    if (statement.header) {
      const [top, sub, ...deeper] = statement.header;
      if (top !== "package") {
        finish();
        table = "other";
      } else if (statement.array && sub === undefined) {
        finish();
        block = { line: statement.line, fields: new Map(), source: null, unreadable: false };
        table = "block";
      } else if (!block) throw new Unreadable(layout);
      else if (OTHER_PACKAGE_TABLES.has(sub)) table = "other";
      else if (format.sourceTable && sub === "source" && !statement.array && deeper.length === 0 && block.source === null) {
        block.source = new Map();
        table = "source";
      } else {
        block.unreadable = true;
        table = "other";
      }
    } else if (table === "root") {
      if (statement.key === null || statement.key === "package") throw new Unreadable(layout);
    } else if (table === "block") readBlockField(block, statement);
    else if (table === "source") readSourceField(block, statement);
  }
  finish();
  return found(out, entries);
}

const readPoetryLock = (text) => readPackageBlocks(text, POETRY);
const readUvLock = (text) => readPackageBlocks(text, UV);

const PINNED_REQUIREMENT = /^([A-Za-z0-9._-]+)(\[[^\]]*\])?==([^\s;#]+)/;

function readRequirements(text) {
  const out = [];
  let entries = 0;
  linesOf(text).forEach((line, i) => {
    if (/^\s*[^\s#-]/.test(line)) entries++;
    const match = PINNED_REQUIREMENT.exec(line);
    if (match) out.push({ name: match[1], version: match[3], line: i + 1 });
  });
  return found(out, entries, "no pinned versions in it");
}

module.exports = { readPoetryLock, readUvLock, readRequirements };

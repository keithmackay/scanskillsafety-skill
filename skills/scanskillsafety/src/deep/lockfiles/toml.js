// ABOUTME: Reads TOML statement by statement: table headers and key/value pairs with their lines, either strictly as Poetry and
// ABOUTME: uv write their lockfiles (anything else is unreadable) or in any layout TOML allows, for hand-written files.
"use strict";

const { Unreadable } = require("./shared");

const BARE_KEY_CHAR = /[A-Za-z0-9_-]/;
// The characters of an unquoted TOML value Poetry and uv write: integers, booleans and dates without a space.
const SCALAR_CHAR = /[A-Za-z0-9_.:+-]/;
// How deep arrays and inline tables nest; Poetry and uv write three levels at most.
const MAX_NESTING = 8;
const LONE_CR = /\r(?!\n)/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^[0-9A-Fa-f]+$/;
// TOML's escapes in a basic string, other than \u and \U.
const ESCAPES = new Map([["b", "\b"], ["t", "\t"], ["n", "\n"], ["f", "\f"], ["r", "\r"], ['"', '"'], ["\\", "\\"]]);

// The gaps Poetry and uv leave around the items of an array of `items` items (after `[`, then after each item and each comma),
// in each layout they write: all on one line as `[a, b]`; or one item per line, indented four spaces and followed by a comma, with
// `]` alone on the last line.
function writtenGaps(items) {
  if (items === 0) return [[""]];
  const oneLine = [""];
  const perLine = ["\n    "];
  for (let item = 1; item <= items; item++) {
    const last = item === items;
    oneLine.push("", ...(last ? [] : [" "]));
    perLine.push("", last ? "\n" : "\n    ");
  }
  return [oneLine, perLine];
}

// Whether an array's gaps, its whitespace, newlines and comments, are laid out as Poetry and uv write an array.
const arrayLaidOut = (gaps, items) =>
  writtenGaps(items).some((written) => written.length === gaps.length && written.every((gap, k) => gap === gaps[k]));

// The statements of a TOML file, in order: table headers `{ line, header, array }` and key/value pairs `{ line, key, path, exact,
// value }`. A key is its name when it is one bare key, otherwise null, and `path` is its dotted parts; `exact` says the pair is
// written as Poetry and uv write one: at the start of its line, `name = value`, nothing after the value. A value, with the line
// it starts on, is a string (`plain` when it is a basic string with no escape), a literal string, a scalar, an array or an inline
// table, each `exact` when written as uv writes it. TOML that neither tool writes in a way that changes which table a line
// belongs to (a multi-line string, a statement that does not start its line, a header that is not bare names joined by dots, an
// inline table across lines, a tab or a lone carriage return between tokens, values nested deeper than MAX_NESTING) means the
// file is not one it can read.
// With `anyLayout`, it reads any layout TOML 1.0 allows instead: indentation, tabs, quoted and spaced header parts, multi-line
// strings (kind `multiline`, with no text) and a date-time with a space. An inline table across lines, values nested deeper than
// MAX_NESTING, or a lone carriage return still mean the file is not one it can read.
// In either mode a basic string's `text` is decoded (`raw` is as written), and a string holding an escape TOML does not define
// has no text, so a reader treats it as one it cannot read.
function tomlStatements(text, layout, { anyLayout = false } = {}) {
  const fail = () => {
    throw new Unreadable(layout);
  };
  if (LONE_CR.test(text)) fail();
  let i = 0;
  let line = 1;
  const atLineEnd = () => i >= text.length || text[i] === "\n" || (text[i] === "\r" && text[i + 1] === "\n");
  const isBlank = (c) => c === " " || (anyLayout && c === "\t");
  const spaces = () => {
    const start = i;
    while (isBlank(text[i])) i++;
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

  // The character an escape at `i` stands for, past which `i` moves; null for an escape TOML does not define, past whose first
  // character `i` moves. A backslash ending the line fails.
  function escape() {
    const letter = text[i + 1];
    i++;
    if (atLineEnd()) fail();
    i++;
    if (ESCAPES.has(letter)) return ESCAPES.get(letter);
    const digits = letter === "u" ? 4 : letter === "U" ? 8 : 0;
    const hex = text.slice(i, i + digits);
    if (digits === 0 || hex.length !== digits || !HEX.test(hex)) return null;
    const code = parseInt(hex, 16);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
    i += digits;
    return String.fromCodePoint(code);
  }

  // A multi-line string, `"""` or `'''`, up to its closing quotes (which may be followed by up to two more of the same quote).
  function multilineString(quotes) {
    i += 3;
    for (;;) {
      if (i >= text.length) fail();
      if (text.startsWith(quotes, i)) {
        let extra = 0;
        while (extra < 2 && text[i + 3 + extra] === quotes[0]) extra++;
        i += 3 + extra;
        return { kind: "multiline", exact: false };
      }
      if (quotes === '"""' && text[i] === "\\") i++;
      if (i < text.length && atLineEnd()) newline();
      else i++;
    }
  }

  function basicString() {
    if (text.startsWith('"""', i)) {
      if (anyLayout) return multilineString('"""');
      fail();
    }
    let plain = true;
    let readable = true;
    let decoded = "";
    const start = ++i;
    let from = start;
    while (text[i] !== '"') {
      if (atLineEnd()) fail();
      if (text[i] !== "\\") {
        i++;
        continue;
      }
      plain = false;
      decoded += text.slice(from, i);
      const character = escape();
      if (character === null) readable = false;
      else decoded += character;
      from = i;
    }
    const raw = text.slice(start, i);
    const value = readable ? decoded + text.slice(from, i) : undefined;
    i++;
    return { kind: "string", text: value, raw, plain, exact: plain };
  }

  function literalString() {
    if (text.startsWith("'''", i)) {
      if (anyLayout) return multilineString("'''");
      fail();
    }
    const start = ++i;
    while (text[i] !== "'") {
      if (atLineEnd()) fail();
      i++;
    }
    return { kind: "literal", text: text.slice(start, i++), exact: false };
  }

  function scalar() {
    const start = i;
    const scan = () => {
      while (i < text.length && SCALAR_CHAR.test(text[i])) i++;
    };
    scan();
    if (i === start) fail();
    if (anyLayout && LOCAL_DATE.test(text.slice(start, i)) && text[i] === " " && /\d/.test(text[i + 1] ?? "")) {
      i++;
      scan();
    }
    return { kind: "scalar", text: text.slice(start, i), exact: true };
  }

  // A key, dotted or not, each part bare or quoted, as TOML allows: its name when it is one bare key, otherwise null; its parts;
  // whether every part is bare; and whether any space sits around a dot.
  function key() {
    let name = null;
    let bare = true;
    let spaced = false;
    const path = [];
    for (let parts = 1; ; parts++) {
      const start = i;
      if (text.startsWith('"""', i) || text.startsWith("'''", i)) fail();
      if (text[i] === '"') path.push(basicString().text);
      else if (text[i] === "'") path.push(literalString().text);
      else {
        while (i < text.length && BARE_KEY_CHAR.test(text[i])) i++;
        if (i === start) fail();
        path.push(text.slice(start, i));
      }
      const quoted = text[start] === '"' || text[start] === "'";
      bare &&= !quoted;
      name = parts === 1 && !quoted ? text.slice(start, i) : null;
      const end = i;
      const before = spaces();
      if (text[i] !== ".") {
        i = end;
        return { name, path, bare, spaced };
      }
      i++;
      const after = spaces();
      spaced ||= before > 0 || after > 0;
    }
  }

  // The whitespace, newlines and comments between array items, newlines written as `\n`.
  function arrayGap() {
    const start = i;
    for (;;) {
      if (isBlank(text[i])) i++;
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
      const { name, path } = key();
      const before = spaces();
      if (text[i] !== "=") fail();
      i++;
      const after = spaces();
      const item = value(depth + 1);
      entries.push({ key: name, path, value: item });
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
    const startLine = line;
    let item;
    if (text[i] === '"') item = basicString();
    else if (text[i] === "'") item = literalString();
    else if (text[i] === "[") item = array(depth);
    else if (text[i] === "{") item = inlineTable(depth);
    else item = scalar();
    item.line = startLine;
    return item;
  }

  function header() {
    const array = text.startsWith("[[", i);
    i += array ? 2 : 1;
    const close = array ? "]]" : "]";
    const leading = spaces();
    const { path, bare, spaced } = key();
    const trailing = spaces();
    if (!text.startsWith(close, i)) fail();
    // Poetry and uv write a header as bare names joined by dots, with no space anywhere in it.
    if (!anyLayout && (!bare || spaced || leading > 0 || trailing > 0)) fail();
    i += close.length;
    return { header: path, array };
  }

  function pair() {
    const { name, path } = key();
    const before = spaces();
    if (text[i] !== "=") fail();
    i++;
    const after = spaces();
    return { key: name, path, exact: name !== null && before === 1 && after === 1, value: value() };
  }

  const statements = [];
  while (i < text.length) {
    const indent = spaces();
    if (skipComment() || atLineEnd()) {
      if (i < text.length) newline();
      continue;
    }
    if (indent > 0 && !anyLayout) fail();
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

// Values as read in any layout, by their whole key path.

const TOML_LAYOUT = "not TOML it can read";

// The text of a one-line string, basic or literal; null for any other value.
const stringOf = (value) => {
  const oneLine = value.kind === "string" || value.kind === "literal";
  return oneLine && value.text !== undefined ? value.text : null;
};

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

module.exports = { tomlStatements, tomlValues, after, arrayTables, stringOf, tableFields };

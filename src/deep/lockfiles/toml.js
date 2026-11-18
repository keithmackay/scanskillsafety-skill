// ABOUTME: Reads TOML statement by statement as Poetry and uv write it: table headers and key/value pairs with their lines, and
// ABOUTME: whether each is written exactly as those tools write it; TOML they would read into another table is unreadable.
"use strict";

const { Unreadable } = require("./shared");

const BARE_KEY_CHAR = /[A-Za-z0-9_-]/;
const HEADER_CHAR = /[A-Za-z0-9_.-]/;
// The characters of an unquoted TOML value Poetry and uv write: integers, booleans and dates without a space.
const SCALAR_CHAR = /[A-Za-z0-9_.:+-]/;
// How deep arrays and inline tables nest; Poetry and uv write three levels at most.
const MAX_NESTING = 8;
const LONE_CR = /\r(?!\n)/;

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

module.exports = { tomlStatements };

// ABOUTME: Makes text from a target (its file paths, lines quoted from it, commands it names, a tool's complaint about it) safe to
// ABOUTME: print: every control, format, line separator and paragraph separator character is replaced with "?", so it cannot
// ABOUTME: reorder, hide or rewrite the output; and cuts text to a length by whole characters.
"use strict";

const printable = (text) => String(text).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "?");

// The text cut to max characters (code points), with `mark` added only when it was cut.
function cut(text, max, mark = "") {
  if (text.length <= max) return text;
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join("")}${mark}`;
}

// Lines of output joined, each made printable as a whole, so a string from the target or a service anywhere in a line (a line
// break in it included) cannot write a terminal escape or start a line of its own.
const printableLines = (lines) => lines.map(printable).join("\n");

// A copy of a result with every string in it made printable, for --json.
function printableStrings(value) {
  if (typeof value === "string") return printable(value);
  if (Array.isArray(value)) return value.map(printableStrings);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, printableStrings(v)]));
  return value;
}

module.exports = { printable, cut, printableLines, printableStrings };

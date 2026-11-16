// ABOUTME: Makes text from a target (its file paths, lines quoted from it, commands it names, a tool's complaint about it) safe to
// ABOUTME: print: every control and format character is replaced with "?", so it cannot reorder, hide or rewrite the output.
"use strict";

const printable = (text) => String(text).replace(/[\p{Cc}\p{Cf}]/gu, "?");

// printable, cut to max characters (code points).
const printableCut = (text, max) => Array.from(printable(text)).slice(0, max).join("");

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

module.exports = { printable, printableCut, printableLines, printableStrings };

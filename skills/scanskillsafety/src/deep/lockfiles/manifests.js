// ABOUTME: Reads the names of the packages a manifest asks for, package.json or pyproject.toml, for a target with no lockfile
// ABOUTME: for that ecosystem.
"use strict";

const { isObject } = require("../util");
const { parseJson } = require("./shared");

function packageJsonNames(text) {
  const json = parseJson(text);
  const sections = ["dependencies", "optionalDependencies", "peerDependencies"];
  return sections.flatMap((section) => (isObject(json) && isObject(json[section]) ? Object.keys(json[section]) : []));
}

// The quoted strings of a TOML array starting at `from`, up to its closing bracket outside quotes (comments skipped), and where
// the array ends.
function quotedStrings(text, from) {
  const strings = [];
  let quote = null;
  let current = "";
  let i = from;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        strings.push(current);
        quote = null;
        current = "";
      } else current += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") {
      while (i + 1 < text.length && text[i + 1] !== "\n") i++;
    } else if (c === "]") break;
  }
  return { strings, end: i };
}

const TABLE_HEADER = /^\[\[?([^[\]]+)\]\]?\s*(#.*)?$/;

function pyprojectNames(text) {
  const names = [];
  let table = null;
  // Lines are walked with their offsets, so a dependencies list is read once from where it starts and the lines it spans skipped.
  const lineBreak = /\r?\n/g;
  let start = 0;
  let readUpTo = 0;
  while (start <= text.length) {
    const match = lineBreak.exec(text);
    const end = match ? match.index : text.length;
    const line = text.slice(start, end);
    const lineStart = start;
    start = match ? lineBreak.lastIndex : text.length + 1;
    if (lineStart < readUpTo) continue;
    const header = TABLE_HEADER.exec(line);
    if (header) table = header[1].trim();
    else if (table === "project" && /^dependencies\s*=\s*\[/.test(line)) {
      const list = quotedStrings(text, lineStart + line.indexOf("[") + 1);
      readUpTo = list.end;
      names.push(...list.strings.map((requirement) => requirement.trim().split(/[<>=!~;[ (]/)[0]));
    } else if (table === "tool.poetry.dependencies") {
      const key = /^(["']?)([A-Za-z0-9._-]+)\1\s*=/.exec(line);
      if (key && key[2] !== "python") names.push(key[2]);
    }
  }
  return names.filter(Boolean);
}

module.exports = { packageJsonNames, pyprojectNames };

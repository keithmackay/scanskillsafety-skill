// ABOUTME: Helpers the lockfile and manifest readers share: line and YAML-field reading, the Unreadable error, JSON key lines,
// ABOUTME: the semver test, unreadable and unnamed entries, and GitHub and codeload addresses.
"use strict";

const { OBJECT_ID } = require("../util");
const { NAME_SEGMENT, UNREADABLE } = require("../packageSources");

const unquote = (s) => s.replace(/^["']|["']$/g, "");
const linesOf = (text) => text.split(/\r?\n/);
const leadingSpaces = (line) => {
  let n = 0;
  while (line[n] === " ") n++;
  return n;
};

// A carriage return that does not end a line, or a tab: YAML reads either differently from a reader that goes line by line.
const LONE_CR_OR_TAB = /\t|\r(?!\n)/;
// A name as pnpm and Yarn write their YAML fields: no quotes, escapes, tags, anchors or merge keys.
const PLAIN_NAME = /^[A-Za-z]+$/;

// A `key: value` or `key:` line's key, as written, and its value, both trimmed; null for any other text.
function fieldOf(text) {
  const sep = text.indexOf(": ");
  if (sep > 0) return { key: text.slice(0, sep).trim(), value: text.slice(sep + 2).trim() };
  return text.length > 1 && text.endsWith(":") ? { key: text.slice(0, -1).trim(), value: "" } : null;
}

const startsWithAny = (value, chars) => value !== "" && chars.includes(value[0]);

const COLLECTION_OR_QUOTE_CLOSERS = new Map([["{", "}"], ["[", "]"], ['"', '"'], ["'", "'"]]);

// A value that opens a collection or a quoted string and does not close it on the same line, so YAML reads on into the next.
function opensUnclosed(value) {
  const closer = COLLECTION_OR_QUOTE_CLOSERS.get(value[0]);
  return closer !== undefined && (value.length < 2 || !value.endsWith(closer));
}

class Unreadable extends Error {}
const unsupportedVersion = (version) => new Unreadable(`lockfileVersion ${version ?? "(none)"} is not a version it can read`);

// A lockfile with entries but no package read from them is one it could not make out, not one that holds nothing.
function found(packages, entries, reason = "no packages found in it") {
  if (entries > 0 && packages.length === 0) throw new Unreadable(reason);
  return packages;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Unreadable("not valid JSON");
  }
}

const isWhitespace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
// An integer-like key is listed by Object.entries before every other key, out of document order.
const isIndexKey = (key) => /^(0|[1-9]\d{0,8})$/.test(key);
const KEY_LOOKAHEAD = 1000;

// Every key of valid JSON text whose value is an object, decoded, with its line, in document order: one pass over the text.
function objectKeys(text) {
  const keys = [];
  let line = 1;
  let i = 0;
  const skipWhitespace = () => {
    while (i < text.length && isWhitespace(text[i])) if (text[i++] === "\n") line++;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") line++;
    if (c !== '"') {
      i++;
      continue;
    }
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    const raw = text.slice(start, ++i);
    skipWhitespace();
    if (text[i] !== ":") continue;
    i++;
    skipWhitespace();
    if (text[i] === "{") keys.push({ key: JSON.parse(raw), line });
  }
  return keys;
}

// The line of each `"key": {` in a JSON lockfile, asked for in document order, so a name that appears twice gets the right one.
// A key not found close ahead, or one out of document order, has no line rather than a wrong one.
function jsonKeyLines(text) {
  const keys = objectKeys(text);
  let cursor = 0;
  return (key) => {
    if (isIndexKey(key)) return null;
    const end = Math.min(keys.length, cursor + KEY_LOOKAHEAD);
    for (let i = cursor; i < end; i++) {
      if (keys[i].key === key) {
        cursor = i + 1;
        return keys[i].line;
      }
    }
    return null;
  };
}

// A version as npm writes one for a package it installed by version. Any other npm version text is never kept or sent to OSV:
// in a version 1 `version` (a git URL, a tarball URL, `file:`) it is the package's source; anywhere else it is no version at all.
const SEMVER = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$/;
// An entry whose source a reader could not make out, whatever the classifier would say.
const UNREADABLE_ENTRY = Object.freeze({ classified: UNREADABLE });
// An entry it cannot even name: reported as a source it could not read, with nothing from it kept, so it is never left out.
const unnamedEntry = (line) => ({ name: null, version: null, line, ...UNREADABLE_ENTRY });

const CODELOAD = "https://codeload.github.com/";

// A GitHub repository at one commit, shown as the repository, when its user, name and commit are ones it can read; null otherwise.
function githubCommit(user, repo, commit) {
  if (!NAME_SEGMENT.test(user) || !NAME_SEGMENT.test(repo) || !OBJECT_ID.test(commit)) return null;
  return { expected: false, kind: "git", address: `https://github.com/${user}/${repo}`, commit };
}

// A GitHub shorthand that Yarn classic resolved to a codeload tarball (`https://codeload.github.com/u/r/tar.gz/<sha>`): a git
// source, shown as the repository, with the commit from the path. Anything else on codeload is left to the classifier.
function codeloadSource(resolved) {
  if (!resolved.startsWith(CODELOAD)) return null;
  const segments = resolved.slice(CODELOAD.length).split("/", 5);
  if (segments.length !== 4 || segments[2] !== "tar.gz") return null;
  return githubCommit(segments[0], segments[1], segments[3]);
}

// An address a lockfile records: a codeload tarball is the GitHub repository it came from; any other is left to the classifier.
function addressSource(address, direct = false) {
  const codeload = codeloadSource(address);
  return codeload ? { classified: codeload } : { source: address, direct };
}

module.exports = {
  unquote,
  linesOf,
  leadingSpaces,
  LONE_CR_OR_TAB,
  PLAIN_NAME,
  fieldOf,
  startsWithAny,
  opensUnclosed,
  Unreadable,
  unsupportedVersion,
  found,
  parseJson,
  jsonKeyLines,
  SEMVER,
  UNREADABLE_ENTRY,
  unnamedEntry,
  githubCommit,
  addressSource,
};

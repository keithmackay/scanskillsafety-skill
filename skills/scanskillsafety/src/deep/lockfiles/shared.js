// ABOUTME: Helpers the lockfile and manifest readers share: line and YAML-field reading, the Unreadable error, JSON key lines,
// ABOUTME: the semver and PEP 440 tests, unreadable and unnamed entries, git, GitHub and codeload addresses, and repository paths.
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
// A version as PEP 440 defines one, in any spelling Python's packaging accepts: `[v][N!]N(.N)*`, then optional pre-release,
// post-release and development parts, then an optional `+local` part. It is checked in pieces, the release by one character
// class and the parts after it by a pattern whose optional groups do not repeat, so no input makes either backtrack far.
const PEP440_RELEASE = /^v?(?:\d+!)?\d[\d.]*/i;
const PEP440_SUFFIXES = /^(?:[-_.]?(?:alpha|a|beta|b|preview|pre|c|rc)[-_.]?\d*)?(?:-\d+|[-_.]?(?:post|rev|r)[-_.]?\d*)?(?:[-_.]?dev[-_.]?\d*)?$/i;
const PEP440_LOCAL = /^[a-z0-9][a-z0-9._-]*$/i;
const DOUBLED_OR_TRAILING_SEPARATOR = /[._-]{2}|[._-]$/;

function isPep440(version) {
  const plus = version.indexOf("+");
  const local = plus < 0 ? null : version.slice(plus + 1);
  if (local !== null && (!PEP440_LOCAL.test(local) || DOUBLED_OR_TRAILING_SEPARATOR.test(local))) return false;
  const publicPart = plus < 0 ? version : version.slice(0, plus);
  const match = PEP440_RELEASE.exec(publicPart);
  if (!match) return false;
  const release = match[0].endsWith(".") ? match[0].slice(0, -1) : match[0];
  return !release.includes("..") && PEP440_SUFFIXES.test(publicPart.slice(release.length));
}

const OUTSIDE_PROJECT = Object.freeze({ expected: false, kind: "url", address: null, text: "a path outside the project" });

// The path, inside the repository, of a relative path read from a folder; null when it climbs above the repository root.
function pathFrom(folder, path) {
  const segments = [];
  for (const segment of [...folder.split("/"), ...path.split("/")]) {
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else if (segment !== "." && segment !== "") segments.push(segment);
  }
  return segments.join("/");
}

// A relative path that, read from the lockfile's folder, never climbs above the repository root; an absolute path, a home path, a
// drive or a scheme leaves it.
function staysInside(folder, path) {
  if (path === "" || path.startsWith("/") || path.startsWith("~") || path.includes(":") || path.includes("\\")) return false;
  return pathFrom(folder, path) !== null;
}

// A package archive by its file name: the forms the spec names and the others pip reads as archives. A `#` fragment, a `?` query
// or Berry's `::` parameters after the path are not part of it.
const PACKAGE_ARCHIVE = /\.(?:whl|egg|zip|tar|tgz|tar\.gz|tar\.bz2|tbz|tar\.xz|txz|tar\.lz|tlz|tar\.lzma)$/i;
const isPackageArchive = (path) => PACKAGE_ARCHIVE.test(path.split("#", 1)[0].split("?", 1)[0].split("::", 1)[0]);

// Package files kept in the repository (an archive, or a folder used as an index), shown by their repository path: no stage of
// the scan reads binary files, so what they hold is never checked. Judging by the name may over-report (a folder named like an
// archive, query text in a path), which only adds a warning the reader can see past.
const bundled = (repositoryPath) =>
  Object.freeze({ expected: false, kind: "bundled", address: repositoryPath === "" ? "." : repositoryPath, text: "a bundled package file the scan cannot read" });

// What a local source in a JavaScript lockfile (`file:x.tgz`, `./x.tgz`, a folder) is, read from the lockfile's folder: an archive
// inside the repository is bundled, one outside it a path outside the project; a folder or a workspace stays local.
function localArchiveVerdict(source, folder, local) {
  const path = source.replace(/^file:/i, "").split("#", 1)[0].split("?", 1)[0].split("::", 1)[0];
  if (!isPackageArchive(path)) return local;
  return staysInside(folder, path) ? bundled(pathFrom(folder, path)) : OUTSIDE_PROJECT;
}

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

// A git repository a lockfile records with its commit: an http(s) address is marked as git, and the commit is kept only when it is
// a commit id.
function gitRepositorySource(repo, commit) {
  const source = repo.startsWith("https:") || repo.startsWith("http:") ? `git+${repo}` : repo;
  return OBJECT_ID.test(commit) ? { source, commit } : { source };
}

// An address a lockfile records: a codeload tarball is the GitHub repository it came from; any other is left to the classifier.
function addressSource(address, direct = false) {
  const codeload = codeloadSource(address);
  return codeload ? { classified: codeload } : { source: address, direct };
}

module.exports = {
  OUTSIDE_PROJECT,
  pathFrom,
  staysInside,
  isPackageArchive,
  bundled,
  localArchiveVerdict,
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
  isPep440,
  UNREADABLE_ENTRY,
  unnamedEntry,
  githubCommit,
  gitRepositorySource,
  addressSource,
};

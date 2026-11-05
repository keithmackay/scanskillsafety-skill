// ABOUTME: Finds the scripts in test and eval folders that a file outside them runs, so a payload can't hide in a folder the
// ABOUTME: script scan skips: a skill, command, hook, script or non-test package.json script that names one gets it scanned.
"use strict";

const { MAX_FILES_PER_LISTING, MAX_BYTES_PER_FILE, MAX_BYTES_PER_LISTING } = require("../lib/scriptFiles");

// The test and eval folders lib/scriptFiles skips; its dependency and build folders stay skipped.
const TEST_FOLDERS = new Set(["test", "tests", "__tests__", "evals"]);
const DEPENDENCY_FOLDERS = new Set(["node_modules", "vendor", "dist", "build"]);
// lib/scriptFiles' script extensions, plus a file with none (`sh tests/payload`).
const SCRIPT_EXTENSION = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1|bat|cmd|rb)$/i;
// package.json scripts that run tests or evals are a test context.
const TEST_SCRIPT_NAME = /^(pre|post)?(test|eval)/i;

const WORD = /[\w-]+/g;

const segmentsOf = (path) => path.split("/");
const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);
const testFolderIndex = (path) => segmentsOf(path).slice(0, -1).findIndex((s) => TEST_FOLDERS.has(s));
const inTestFolder = (path) => testFolderIndex(path) >= 0;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isLaunchable(path) {
  const segments = segmentsOf(path);
  if (segments.slice(0, -1).some((s) => DEPENDENCY_FOLDERS.has(s))) return false;
  const name = baseName(path);
  return (SCRIPT_EXTENSION.test(name) && !/\.min\.js$/i.test(name)) || !name.includes(".");
}

// The ways a file can name a test file: from its test folder on (tests/run.sh, ./tests/util, ${ROOT}/tests/run.sh), and
// for Python as a module (python -m tests.run). Whole path segments only: mytests/run.sh is not tests/run.sh.
function referencePattern(path) {
  const tail = segmentsOf(path).slice(testFolderIndex(path));
  const withPath = tail.join("/");
  const forms = [withPath, withPath.replace(/\.[^./]+$/, "")];
  if (/\.py$/i.test(path)) forms.push(tail.join(".").replace(/\.py$/i, ""));
  const alternatives = [...new Set(forms)].map(escape).join("|");
  return new RegExp(`(?<![\\w.-])(?:${alternatives})(?![\\w/-]|\\.\\w)`);
}

// What a file can run from: a README is for people, and package.json runs only its scripts, bin and main.
function launchText(file) {
  if (baseName(file.path) === "README.md") return null;
  if (baseName(file.path) !== "package.json") return file.text;
  try {
    const pkg = JSON.parse(file.text);
    const scripts = Object.entries(pkg.scripts ?? {}).filter(([name]) => !TEST_SCRIPT_NAME.test(name)).map(([, cmd]) => cmd);
    const bins = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
    return [...scripts, ...bins, pkg.main ?? ""].join("\n");
  } catch {
    return file.text;
  }
}

// The files in the tree's test and eval folders that a file read so far runs, from outside those folders or from a test
// file already launched (launchedBy), within what is left of the script limits. `tried` holds paths already looked for.
function findLaunchedTestFiles(tree, files, tried = new Set()) {
  const read = new Set(files.map((f) => f.path));
  const referrers = files
    .filter((f) => !inTestFolder(f.path) || f.launchedBy)
    .map((f) => ({ path: f.path, text: launchText(f) }))
    .filter((f) => f.text)
    .map((f) => ({ ...f, words: new Set(f.text.match(WORD) ?? []) }));
  const scripts = files.filter((f) => f.script);
  let count = scripts.length;
  let bytes = scripts.reduce((sum, f) => sum + Math.min(Buffer.byteLength(f.text), MAX_BYTES_PER_FILE), 0);
  const launched = [];
  let truncated = false;
  const candidates = tree
    .filter((f) => inTestFolder(f.path) && isLaunchable(f.path) && !read.has(f.path) && !tried.has(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of candidates) {
    // A file can only name this one if the first word of its name is in it; that check is cheap, the pattern is not.
    const firstWord = baseName(f.path).match(WORD)?.[0];
    const pattern = referencePattern(f.path);
    const by = referrers.find((r) => r.path !== f.path && r.words.has(firstWord) && pattern.test(r.text));
    if (!by) continue;
    const cost = Math.min(f.size, MAX_BYTES_PER_FILE);
    if (count + 1 > MAX_FILES_PER_LISTING || bytes + cost > MAX_BYTES_PER_LISTING) {
      truncated = true;
      continue;
    }
    launched.push({ path: f.path, by: by.path });
    count += 1;
    bytes += cost;
  }
  return { launched, truncated };
}

module.exports = { findLaunchedTestFiles };

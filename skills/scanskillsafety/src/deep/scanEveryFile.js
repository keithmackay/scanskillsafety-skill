// ABOUTME: Runs the static rules on every file of a deep scan: scripts, configs and package.json with the script rules, the rest
// ABOUTME: as prose. Findings in test files nothing launches are kept apart, so test fixtures do not set the rating.
"use strict";

const { scanText } = require("../../lib/scanText");
const { scanScriptFile } = require("../../lib/scanScriptFile");
const { isScriptPath } = require("../../lib/scriptFiles");
const { findLaunchedTestFiles, isInTestFolder, NO_LIMITS } = require("../../lib/launchedTestFiles");

const isPackageJson = (p) => p === "package.json" || p.endsWith("/package.json");
const readWithScriptRules = (p) => isScriptPath(p) || isPackageJson(p);
// A package.json is read both ways: its install scripts with the script rules, and its text with the prose rules, as the plain scan
// reads the root one.
const scanOne = (f) => [
  ...(readWithScriptRules(f.path) ? scanScriptFile(f.path, f.text) : []),
  ...(!readWithScriptRules(f.path) || isPackageJson(f.path) ? scanText(f.text).findings.map((finding) => ({ file: f.path, ...finding })) : []),
];

// The first round looks for test files the files outside test folders run; each later round looks only in the files the round
// before launched, since every file read earlier has already been looked through and `tried` holds every launched path. So a
// long chain of test files costs its length, not its length times the size of the repository.
function launchedTestFiles(files) {
  const tree = files.map((f) => ({ path: f.path, size: f.size }));
  const byPath = new Map(files.map((f) => [f.path, f]));
  let referrers = files.filter((f) => !isInTestFolder(f.path)).map((f) => ({ path: f.path, text: f.text, script: readWithScriptRules(f.path) }));
  const launched = [];
  const tried = new Set();
  for (;;) {
    const round = findLaunchedTestFiles(tree, referrers, tried, NO_LIMITS);
    if (round.launched.length === 0) return launched;
    referrers = [];
    for (const { path, by } of round.launched) {
      tried.add(path);
      launched.push(path);
      referrers.push({ path, text: byPath.get(path).text, script: true, launchedBy: by });
    }
  }
}

function scanEveryFile(files) {
  const launched = launchedTestFiles(files);
  const counted = new Set(launched);
  const findings = [];
  const testFindings = [];
  for (const f of files) {
    const found = scanOne(f);
    (isInTestFolder(f.path) && !counted.has(f.path) ? testFindings : findings).push(...found);
  }
  return { findings, testFindings, launched };
}

module.exports = { scanEveryFile };

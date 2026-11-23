// ABOUTME: Runs the static rules on every file of a deep scan: scripts, configs and package.json with the script rules, the rest
// ABOUTME: as prose. Findings in test files nothing launches, these and any other stage's, are kept apart, so test fixtures do not
// ABOUTME: set the rating.
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

// Whether a file is in a test folder and nothing launches it (`launched`: the set of test files something runs), so its findings
// are kept apart and do not set the rating.
const isUncountedTestFile = (path, launched) => isInTestFolder(path) && !launched.has(path);

// Findings split by their file: those in test files nothing launches apart from the rest.
function splitTestFindings(found, launched) {
  const findings = [];
  const testFindings = [];
  for (const finding of found) (isUncountedTestFile(finding.file, launched) ? testFindings : findings).push(finding);
  return { findings, testFindings };
}

function scanEveryFile(files) {
  const launched = launchedTestFiles(files);
  const { findings, testFindings } = splitTestFindings(files.flatMap(scanOne), new Set(launched));
  return { findings, testFindings, launched };
}

module.exports = { scanEveryFile, splitTestFindings };

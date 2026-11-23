"use strict";
// ABOUTME: Tests the wording for packages and settings from outside the registry: what each kind of source is called, and the
// ABOUTME: whole warning text, a subject followed by what it comes from or what the line names.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { packageSource, lineText, sourceDetail, fieldText } = require("../../src/deep/sourceText");

const SHA1 = "3f2a9c1e5b7d4f6a8c0e2b4d6f8a0c2e4b6d8f0a";
const group = (kind, address, packages, extra = {}) => ({
  ecosystem: "npm", kind, address, file: "package-lock.json", line: 3, ...extra,
  packages: packages.slice(0, 5).map((name, k) => ({ name, version: null, line: 3 + k })), total: packages.length,
});
const line = (from, kind, address, extra = {}) => ({ ecosystem: "npm", kind, address, file: ".npmrc", line: 1, from, ...extra, packages: [], total: 0 });

test("what packages come from: an address, git with its commit, a bundled file, or a fixed text when there is no address", () => {
  assert.equal(packageSource(group("host", "https://m.example", ["a"])), "https://m.example");
  assert.equal(packageSource(group("git", "https://github.com/u/r", ["a"], { commit: SHA1 })), `git https://github.com/u/r (commit ${SHA1})`);
  assert.equal(packageSource(group("git", "https://github.com/u/r", ["a"])), "git https://github.com/u/r");
  assert.equal(packageSource(group("bundled", "vendor/a.tgz", ["a"], { text: "a bundled package file the scan cannot read" })), "vendor/a.tgz, a bundled package file the scan cannot read");
  assert.equal(packageSource(group("url", null, ["a"], { text: "a script that produces the package" })), "a script that produces the package");
});

test("packages: one by its name, several by their count, an unreadable source said so", () => {
  assert.equal(sourceDetail(group("host", "https://m.example", ["lodash"])), "lodash comes from https://m.example");
  assert.equal(sourceDetail(group("host", "https://m.example", Array.from({ length: 1234 }, (_, k) => `p${k}`))), "1,234 packages come from https://m.example");
  assert.equal(sourceDetail(group("git", "https://github.com/u/r", [null])), "a package comes from git https://github.com/u/r");
  assert.equal(sourceDetail(group("unreadable", null, ["x"])), "x has a source it could not read");
  assert.equal(sourceDetail(group("unreadable", null, ["x", null])), "2 packages have a source it could not read");
  assert.equal(sourceDetail(group("http", "http://m.example", ["a", "b"])), "2 packages come from http://m.example");
});

test("setting and index lines: each kind in one wording, a verb phrase after the file and line", () => {
  const cases = [
    [line("config", "host", "https://npm.example.com"), "names the npm registry https://npm.example.com for installs in this folder"],
    [line("config", "host", "https://npm.example.com", { scope: "@myco" }), "names the npm registry https://npm.example.com for @myco installs in this folder"],
    [line("config", "host", "https://uv.example.com", { ecosystem: "PyPI" }), "names the PyPI registry https://uv.example.com for installs in this folder"],
    [line("requirements", "host", "https://pypi.example.com"), "names the package index https://pypi.example.com"],
    [line("requirements", "host", null, { text: "an index set from an environment variable" }), "names an index set from an environment variable"],
    [line("config", "host", null, { text: "an index set from an environment variable" }), "names an index set from an environment variable"],
    [line("requirements", "url", null, { text: "a path outside the project" }), "names a path outside the project"],
    [line("config", "http", "http://m.example"), "names the npm registry http://m.example for installs in this folder"],
    [line("config", "http", "http://uv.example.com", { ecosystem: "PyPI" }), "names the PyPI registry http://uv.example.com for installs in this folder"],
    [line("requirements", "http", "http://pypi.example.com"), "names the package index http://pypi.example.com"],
    [line("config", "http", "http://m.example", { role: "allows-http" }), "allows plain http from http://m.example"],
    [line("requirements", "http", "http://pypi.example.com", { role: "allows-http" }), "allows plain http from http://pypi.example.com"],
    [line("requirements", "host", "https://links.example", { role: "find-links" }), "names a find-links page https://links.example"],
    [line("requirements", "http", "http://links.example", { role: "find-links" }), "names a find-links page http://links.example"],
    [line("config", "host", "https://links.example", { ecosystem: "PyPI", role: "find-links" }), "names a find-links page https://links.example"],
    [line("requirements", "bundled", "wheels", { role: "find-links", text: "a bundled package file the scan cannot read" }), "names wheels, a bundled package file the scan cannot read"],
    [line("config", "http", null, { text: "strict-ssl=false turns off certificate checks" }), "strict-ssl=false turns off certificate checks"],
    [line("config", "http", null, { text: "cafile replaces the trusted certificates" }), "cafile replaces the trusted certificates"],
    [line("config", "host", null, { text: "hides the registry from package-lock.json" }), "hides the registry from package-lock.json"],
    [line("requirements", "bundled", "wheels", { text: "a bundled package file the scan cannot read" }), "names wheels, a bundled package file the scan cannot read"],
    [line("config", "unreadable", null), "names a source it could not read"],
    [line("requirements", "unreadable", null), "names a source it could not read"],
  ];
  for (const [entry, expected] of cases) {
    assert.equal(lineText(entry), expected, JSON.stringify(entry));
    assert.equal(sourceDetail(entry), expected, JSON.stringify(entry));
  }
});

test("a field longer than 300 characters is cut there and marked with …, in a package's source and in a line's text", () => {
  const long = `https://m.example/${"a".repeat(400)}`;
  const cut = `${long.slice(0, 300)}…`;
  assert.equal(fieldText(long), cut);
  assert.equal(fieldText("x".repeat(300)), "x".repeat(300));
  assert.equal(packageSource(group("url", long, ["a"])), cut);
  assert.equal(packageSource(group("git", long, ["a"], { commit: SHA1 })), `git ${cut} (commit ${SHA1})`);
  assert.equal(sourceDetail(group("host", long, ["a"])), `a comes from ${cut}`);
  assert.equal(lineText(line("config", "host", long)), `names the npm registry ${cut} for installs in this folder`);
  assert.equal(lineText(line("config", "host", "https://m.example", { scope: `@${"s".repeat(400)}` })), `names the npm registry https://m.example for @${"s".repeat(299)}… installs in this folder`);
  assert.equal(lineText(line("requirements", "bundled", long, { text: "a bundled package file the scan cannot read" })), `names ${cut}, a bundled package file the scan cannot read`);
});

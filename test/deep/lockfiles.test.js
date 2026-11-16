"use strict";
// ABOUTME: Tests reading the packages a target pulls in: one real-shaped fixture per supported lockfile format and version, names
// ABOUTME: from manifests when an ecosystem has no lockfile, and formats it cannot read listed rather than ignored.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { readPackages } = require("../../src/deep/lockfiles");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", "lockfiles", name), "utf-8");
const one = (filePath, fixtureName) => readPackages([{ path: filePath, text: fixture(fixtureName) }]);
const npm = (name, version, file, line) => ({ ecosystem: "npm", name, version, file, line });
const pypi = (name, version, file, line) => ({ ecosystem: "PyPI", name, version, file, line });
const EMPTY = { packages: [], namesOnly: [], couldNotRead: [], notChecked: [] };

test("package-lock.json version 1: every dependency, nested ones too, with the line naming it", () => {
  assert.deepEqual(one("package-lock.json", "package-lock.v1.json"), {
    ...EMPTY,
    packages: [
      npm("ansi-regex", "5.0.1", "package-lock.json", 7),
      npm("strip-ansi", "6.0.1", "package-lock.json", 12),
      npm("wrap-ansi", "7.0.0", "package-lock.json", 20),
      npm("ansi-regex", "4.1.1", "package-lock.json", 28),
    ],
  });
});

test("package-lock.json version 2: the packages section, not the root entry or the older dependencies section", () => {
  assert.deepEqual(one("app/package-lock.json", "package-lock.v2.json").packages, [
    npm("ansi-regex", "5.0.1", "app/package-lock.json", 14),
    npm("strip-ansi", "6.0.1", "app/package-lock.json", 22),
  ]);
});

test("package-lock.json version 3: nested and scoped names, an alias by its real name; links and workspace folders skipped", () => {
  assert.deepEqual(one("npm-shrinkwrap.json", "package-lock.v3.json").packages, [
    npm("@isaacs/cliui", "8.0.2", "npm-shrinkwrap.json", 17),
    npm("ansi-regex", "6.1.0", "npm-shrinkwrap.json", 28),
    npm("string-width", "4.2.3", "npm-shrinkwrap.json", 40),
  ]);
});

test("a package-lock.json of another version, or not JSON, could not be read", () => {
  const read = readPackages([
    { path: "package-lock.json", text: JSON.stringify({ lockfileVersion: 4, packages: {} }) },
    { path: "sub/package-lock.json", text: "{ not json" },
  ]);
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [
      { file: "package-lock.json", reason: "lockfileVersion 4 is not a version it can read" },
      { file: "sub/package-lock.json", reason: "not valid JSON" },
    ],
  });
});

test("yarn.lock, classic: the first spec's name, the version line, an alias by its real name", () => {
  assert.deepEqual(one("yarn.lock", "yarn.classic.lock").packages, [
    npm("@babel/code-frame", "7.12.13", "yarn.lock", 5),
    npm("js-tokens", "4.0.0", "yarn.lock", 12),
    npm("string-width", "4.2.3", "yarn.lock", 17),
  ]);
});

test("yarn.lock, Berry: names before @npm:, the metadata and workspace entries skipped", () => {
  assert.deepEqual(one("yarn.lock", "yarn.berry.lock").packages, [
    npm("@actions/core", "1.2.6", "yarn.lock", 8),
    npm("js-tokens", "4.0.0", "yarn.lock", 15),
  ]);
});

test("a yarn.lock that is neither classic nor Berry could not be read", () => {
  assert.deepEqual(readPackages([{ path: "yarn.lock", text: "lockfile: something else\n" }]).couldNotRead, [
    { file: "yarn.lock", reason: "not a Yarn lockfile it can read" },
  ]);
});

test("pnpm-lock.yaml version 6: keys under packages, the leading slash and peer suffix removed", () => {
  assert.deepEqual(one("pnpm-lock.yaml", "pnpm-lock.v6.yaml").packages, [
    npm("@babel/helper-module-transforms", "7.23.3", "pnpm-lock.yaml", 17),
    npm("chalk", "2.4.2", "pnpm-lock.yaml", 24),
    npm("escape-string-regexp", "1.0.5", "pnpm-lock.yaml", 31),
  ]);
});

test("pnpm-lock.yaml version 9: quoted scoped keys under packages, not the snapshots", () => {
  assert.deepEqual(one("pnpm-lock.yaml", "pnpm-lock.v9.yaml").packages, [
    npm("@pnpm/exe", "9.15.0", "pnpm-lock.yaml", 17),
    npm("semver", "7.6.3", "pnpm-lock.yaml", 21),
  ]);
});

test("a pnpm-lock.yaml of another version could not be read", () => {
  assert.deepEqual(readPackages([{ path: "pnpm-lock.yaml", text: "lockfileVersion: 5.4\n\npackages:\n\n  /chalk/2.4.2:\n" }]).couldNotRead, [
    { file: "pnpm-lock.yaml", reason: "lockfileVersion 5.4 is not a version it can read" },
  ]);
});

test("poetry.lock: each package block's name and version, names normalised", () => {
  assert.deepEqual(one("poetry.lock", "poetry.lock").packages, [
    pypi("anyio", "4.4.0", "poetry.lock", 4),
    pypi("typing-extensions", "4.12.2", "poetry.lock", 19),
  ]);
});

test("uv.lock: each package block, the project itself (editable or virtual) skipped, names normalised", () => {
  assert.deepEqual(one("uv.lock", "uv.lock").packages, [
    pypi("anyio", "4.6.2.post1", "uv.lock", 5),
    pypi("markdown-it-py", "3.0.0", "uv.lock", 15),
  ]);
});

test("requirements*.txt: lines pinned with ==, extras and markers allowed; other lines ignored", () => {
  assert.deepEqual(one("requirements-dev.txt", "requirements.txt").packages, [
    pypi("certifi", "2024.8.30", "requirements-dev.txt", 2),
    pypi("charset-normalizer", "3.3.2", "requirements-dev.txt", 3),
    pypi("requests", "2.32.3", "requirements-dev.txt", 4),
    pypi("zope-interface", "7.0.3", "requirements-dev.txt", 7),
  ]);
});

test("lockfiles in vendored folders are ignored", () => {
  const text = fixture("yarn.classic.lock");
  assert.deepEqual(readPackages([{ path: "node_modules/x/yarn.lock", text }, { path: "vendor/y/yarn.lock", text }]), EMPTY);
});

test("the same package in two lockfiles is listed once, where it was first found", () => {
  const read = readPackages([
    { path: "a/package-lock.json", text: fixture("package-lock.v2.json") },
    { path: "b/package-lock.json", text: fixture("package-lock.v2.json") },
  ]);
  assert.deepEqual(read.packages.map((p) => p.file), ["a/package-lock.json", "a/package-lock.json"]);
});

test("with no npm lockfile, the names in each package.json's dependencies, optional and peer dependencies, with no version", () => {
  const manifest = JSON.stringify({
    dependencies: { chalk: "^5.0.0" },
    devDependencies: { tap: "^18.0.0" },
    optionalDependencies: { fsevents: "^2.3.0" },
    peerDependencies: { react: ">=18", chalk: "^5.0.0" },
  });
  const read = readPackages([
    { path: "package.json", text: manifest },
    { path: "node_modules/z/package.json", text: JSON.stringify({ dependencies: { zed: "1" } }) },
  ]);
  assert.deepEqual(read, {
    ...EMPTY,
    packages: [npm("chalk", null, "package.json", null), npm("fsevents", null, "package.json", null), npm("react", null, "package.json", null)],
    namesOnly: ["package.json"],
  });
});

test("with an npm lockfile anywhere, package.json names are not read", () => {
  const read = readPackages([
    { path: "package.json", text: JSON.stringify({ dependencies: { chalk: "^5.0.0" } }) },
    { path: "pnpm-lock.yaml", text: fixture("pnpm-lock.v9.yaml") },
  ]);
  assert.deepEqual(read.namesOnly, []);
  assert.ok(read.packages.every((p) => p.version !== null));
});

test("with no Python lockfile, pyproject.toml's project dependencies and Poetry's dependencies give names", () => {
  const pyproject = [
    "[project]",
    'name = "table-formatter"',
    "dependencies = [",
    '    "Requests[socks]>=2.31",',
    "    'rich ~= 13.0',",
    '    "typing_extensions; python_version < \'3.11\'",',
    "]",
    "",
    "[tool.poetry.dependencies]",
    'python = "^3.10"',
    'httpx = "^0.27"',
    '"ruamel.yaml" = { version = "^0.18" }',
    "",
    "[tool.poetry.group.dev.dependencies]",
    'pytest = "^8"',
  ].join("\n");
  assert.deepEqual(readPackages([{ path: "pyproject.toml", text: pyproject }]), {
    ...EMPTY,
    packages: [
      pypi("requests", null, "pyproject.toml", null),
      pypi("rich", null, "pyproject.toml", null),
      pypi("typing-extensions", null, "pyproject.toml", null),
      pypi("httpx", null, "pyproject.toml", null),
      pypi("ruamel-yaml", null, "pyproject.toml", null),
    ],
    namesOnly: ["pyproject.toml"],
  });
});

test("a one-line dependencies list in pyproject.toml is read too", () => {
  const read = readPackages([{ path: "pyproject.toml", text: '[project]\ndependencies = ["anyio>=4", "idna"]\n' }]);
  assert.deepEqual(read.packages.map((p) => p.name), ["anyio", "idna"]);
});

test("with a Python lockfile, pyproject.toml names are not read", () => {
  const read = readPackages([
    { path: "pyproject.toml", text: '[project]\ndependencies = ["anyio>=4"]\n' },
    { path: "uv.lock", text: fixture("uv.lock") },
  ]);
  assert.deepEqual(read.namesOnly, []);
});

test("Cargo, Go and Ruby lockfiles are listed as not checked", () => {
  const read = readPackages([
    { path: "Cargo.lock", text: "version = 3\n" },
    { path: "tools/go.sum", text: "" },
    { path: "Gemfile.lock", text: "GEM\n" },
    { path: "vendor/x/Gemfile.lock", text: "GEM\n" },
  ]);
  assert.deepEqual(read, { ...EMPTY, notChecked: ["Cargo.lock", "tools/go.sum", "Gemfile.lock"] });
});

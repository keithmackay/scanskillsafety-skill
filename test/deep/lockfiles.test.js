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
const EMPTY = { packages: [], namesOnly: [], couldNotRead: [], notChecked: [], sourced: [], notRecorded: [] };

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

test("a lockfile left out of the file list could not be read, with the reason it was left out", () => {
  const leftOut = [
    { path: "package-lock.json", reason: "larger than 5 MB" },
    { path: "node_modules/x/yarn.lock", reason: "larger than 5 MB" },
    { path: "logo.png", reason: "binary" },
  ];
  const read = readPackages([{ path: "package.json", text: JSON.stringify({ dependencies: { chalk: "^5.0.0" } }) }], leftOut);
  assert.deepEqual(read, { ...EMPTY, couldNotRead: [{ file: "package-lock.json", reason: "larger than 5 MB, not checked" }] });
});

test("lockfiles with Windows line endings read the same", () => {
  const crlf = (name) => fixture(name).replace(/\n/g, "\r\n");
  const cases = [
    ["yarn.lock", "yarn.classic.lock"], ["yarn.lock", "yarn.berry.lock"], ["pnpm-lock.yaml", "pnpm-lock.v6.yaml"],
    ["pnpm-lock.yaml", "pnpm-lock.v9.yaml"], ["poetry.lock", "poetry.lock"], ["uv.lock", "uv.lock"], ["requirements.txt", "requirements.txt"],
    ["package-lock.json", "package-lock.v1.json"], ["package-lock.json", "package-lock.v3.json"],
  ];
  for (const [file, name] of cases) {
    assert.deepEqual(readPackages([{ path: file, text: crlf(name) }]), one(file, name), name);
  }
  const pyproject = '[project]\r\ndependencies = [\r\n  "anyio>=4",\r\n  "idna",\r\n]\r\n\r\n[tool.poetry.dependencies]\r\npython = "^3.10"\r\nhttpx = "^0.27"\r\n';
  assert.deepEqual(readPackages([{ path: "pyproject.toml", text: pyproject }]).packages.map((p) => p.name), ["anyio", "idna", "httpx"]);
});

test("a lockfile with entries it cannot make out could not be read, rather than read as holding nothing", () => {
  const read = readPackages([
    { path: "yarn.lock", text: "# yarn lockfile v1\n\nsomething odd\n  resolved x\n" },
    { path: "a/pnpm-lock.yaml", text: "lockfileVersion: '9.0'\n\npackages:\n\n  no-version-here:\n    resolution: {}\n" },
    { path: "b/package-lock.json", text: JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/x": { resolved: "y" } } }) },
    { path: "c/package-lock.json", text: JSON.stringify({ lockfileVersion: 1, dependencies: { x: { resolved: "y" } } }) },
    { path: "poetry.lock", text: '[[package]]\nname = "x"\n' },
    { path: "requirements.txt", text: "# tools\nrequests>=2\n" },
    { path: "package.json", text: JSON.stringify({ dependencies: { chalk: "^5.0.0" } }) },
  ]);
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [
      { file: "yarn.lock", reason: "a package source it could not read" },
      { file: "a/pnpm-lock.yaml", reason: "a package source it could not read" },
      { file: "b/package-lock.json", reason: "no packages found in it" },
      { file: "c/package-lock.json", reason: "no packages found in it" },
      { file: "poetry.lock", reason: "a package source it could not read" },
      { file: "requirements.txt", reason: "no pinned versions in it" },
    ],
    sourced: [
      { ecosystem: "npm", file: "yarn.lock", line: 3, name: null, version: null, kind: "unreadable", address: null },
      { ecosystem: "npm", file: "a/pnpm-lock.yaml", line: 5, name: null, version: null, kind: "unreadable", address: null },
      { ecosystem: "PyPI", file: "poetry.lock", line: 2, name: "x", version: null, kind: "unreadable", address: null },
    ],
  });
});

test("a lockfile that truly lists no dependency is read as holding none", () => {
  const read = readPackages([
    { path: "package-lock.json", text: JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "t" }, "node_modules/w": { link: true, resolved: "w" } } }) },
    { path: "a/package-lock.json", text: JSON.stringify({ lockfileVersion: 1 }) },
    { path: "yarn.lock", text: "__metadata:\n  version: 8\n\n\"t@workspace:.\":\n  version: 0.0.0-use.local\n  resolution: \"t@workspace:.\"\n" },
    { path: "pnpm-lock.yaml", text: "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n" },
    { path: "uv.lock", text: 'version = 1\n\n[[package]]\nname = "t"\nversion = "0.1.0"\nsource = { editable = "." }\n' },
    { path: "requirements.txt", text: "# nothing yet\n\n" },
  ]);
  assert.deepEqual(read, EMPTY);
});

test("an oversized Cargo, Go or Ruby lockfile is still listed as not checked", () => {
  const read = readPackages([], [{ path: "Cargo.lock", reason: "larger than 5 MB" }, { path: "vendor/go.sum", reason: "larger than 5 MB" }]);
  assert.deepEqual(read, { ...EMPTY, notChecked: ["Cargo.lock"] });
});

const quickly = (fn, ms = 2000) => {
  const start = Date.now();
  const value = fn();
  const took = Date.now() - start;
  assert.ok(took < ms, `took ${took} ms`);
  return value;
};

test("files named like built-in object properties are not taken for lockfiles or manifests", () => {
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.deepEqual(readPackages([{ path: `x/${name}`, text: "hi" }], [{ path: name, reason: "binary" }]), EMPTY, name);
  }
});

test("a package-lock.json version 1 nested 20,000 levels deep is read without running out of stack", () => {
  let text = '{"lockfileVersion":1,"dependencies":';
  for (let i = 0; i < 20000; i++) text += `{"p${i}":{"version":"1.0.0","dependencies":`;
  text += "{}" + "}}".repeat(20000) + "}";
  const read = quickly(() => readPackages([{ path: "package-lock.json", text }]));
  assert.equal(read.packages.length, 20000);
  assert.deepEqual(read.packages[19999], npm("p19999", "1.0.0", "package-lock.json", 1));
});

test("lockfile keys written with escapes, by the thousand, are read quickly; a key it cannot place has no line", () => {
  const keys = Array.from({ length: 20000 }, (_, i) => `"node_modules/\\u0061${i}":{"version":"1.0.0"}`);
  const text = `{"lockfileVersion":2,"packages":{\n${keys.join(",\n")}}}`;
  const read = quickly(() => readPackages([{ path: "package-lock.json", text }]));
  assert.equal(read.packages.length, 20000);
  assert.deepEqual(read.packages[1], npm("a1", "1.0.0", "package-lock.json", 3));
  const numbered = '{\n  "lockfileVersion": 1,\n  "dependencies": {\n    "b": { "version": "1.0.0" },\n    "7": { "version": "2.0.0" }\n  }\n}';
  assert.deepEqual(readPackages([{ path: "package-lock.json", text: numbered }]).packages, [
    npm("7", "2.0.0", "package-lock.json", null),
    npm("b", "1.0.0", "package-lock.json", 4),
  ]);
});

test("a pyproject.toml built to make the reader backtrack or rescan is read quickly", () => {
  quickly(() => readPackages([{ path: "pyproject.toml", text: "[".repeat(100000) }]));
  const read = quickly(() => readPackages([{ path: "pyproject.toml", text: "[project]\n" + "dependencies = [\n".repeat(20000) }]));
  assert.deepEqual(read.packages, []);
});

test("pyproject.toml comments: after a table header, and inside the dependencies list", () => {
  const text = '[project]  # the package\ndependencies = [\n  # "commented-out>=1",\n  "anyio>=4",  # async\n]\n';
  assert.deepEqual(readPackages([{ path: "pyproject.toml", text }]).packages.map((p) => p.name), ["anyio"]);
});

test("a yarn.lock entry whose spec has no version part keeps its whole name", () => {
  const text = '# yarn lockfile v1\n\nleft-pad:\n  version "1.3.0"\n';
  assert.deepEqual(readPackages([{ path: "yarn.lock", text }]).packages, [npm("left-pad", "1.3.0", "yarn.lock", 3)]);
});

const SHA1 = "3f2a9c1e5b7d4f6a8c0e2b4d6f8a0c2e4b6d8f0a";
const UNREADABLE_SOURCE = "a package source it could not read";
const sourced = (name, version, file, line, kind, address, extra = {}) => ({ ecosystem: "npm", file, line, name, version, kind, address, ...extra });

test("package-lock.json version 3 sources: the registry and entries recording no host are checked; a mirror and git are not; file: and bundled entries are not reported as sourced", () => {
  const file = "package-lock.json";
  assert.deepEqual(one(file, "package-lock.v3.sources.json"), {
    ...EMPTY,
    packages: [npm("bundler", "2.0.0", file, 18), npm("bundled", "0.3.1", file, 26), npm("no-host", "1.0.0", file, 45)],
    sourced: [
      sourced("left-pad", "1.3.0", file, 31, "git", "ssh://github.com/someone/left-pad.git", { commit: SHA1 }),
      sourced("lodash", "4.17.21", file, 40, "host", "https://registry.npmmirror.com"),
    ],
  });
});

test("package-lock.json version 1: a git URL as the version is the source, and the version is not kept", () => {
  const file = "package-lock.json";
  assert.deepEqual(one(file, "package-lock.v1.git.json"), {
    ...EMPTY,
    packages: [npm("ansi-regex", "5.0.1", file, 7)],
    sourced: [sourced("left-pad", null, file, 12, "git", "https://github.com/someone/left-pad.git", { commit: SHA1 })],
  });
});

test("package-lock.json version 1: a file: version is local; a tarball URL as the version pins one archive", () => {
  const text = JSON.stringify({
    lockfileVersion: 1,
    dependencies: {
      mine: { version: "file:../mine" },
      tiny: { version: "https://files.example.com/a/tiny-1.0.0.tgz" },
    },
  }, null, 2);
  assert.deepEqual(readPackages([{ path: "package-lock.json", text }]), {
    ...EMPTY,
    sourced: [sourced("tiny", null, "package-lock.json", 7, "url", "https://files.example.com/tiny-1.0.0.tgz")],
  });
});

test("package-lock.json version 1: a git version holding a credential is never kept or shown", () => {
  const text = JSON.stringify({ lockfileVersion: 1, dependencies: { x: { version: `git+https://SECRET@github.com/u/r.git#${SHA1}` } } });
  const read = readPackages([{ path: "package-lock.json", text }]);
  assert.deepEqual(read.sourced, [sourced("x", null, "package-lock.json", 1, "git", "https://github.com/u/r.git", { commit: SHA1 })]);
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("yarn.lock, classic sources: the registry is checked, a mirror is not and its #sha1 is no commit; a codeload link is git", () => {
  assert.deepEqual(one("yarn.lock", "yarn.classic.sources.lock"), {
    ...EMPTY,
    packages: [npm("js-tokens", "4.0.0", "yarn.lock", 5)],
    sourced: [
      sourced("left-pad", "1.3.0", "yarn.lock", 10, "git", "https://github.com/someone/left-pad", { commit: SHA1 }),
      sourced("lodash", "4.17.21", "yarn.lock", 14, "host", "https://registry.npmmirror.com"),
    ],
  });
});

test("yarn.lock, Berry sources: npm: and a patch of an npm: package are checked; #commit= is git; an https tarball pins one archive; portal: is local", () => {
  assert.deepEqual(one("yarn.lock", "yarn.berry.sources.lock"), {
    ...EMPTY,
    packages: [npm("js-tokens", "4.0.0", "yarn.lock", 8), npm("resolve", "1.22.1", "yarn.lock", 28)],
    sourced: [
      sourced("left-pad", "1.3.0", "yarn.lock", 15, "git", "https://github.com/someone/left-pad.git", { commit: SHA1 }),
      sourced("tiny", "1.0.0", "yarn.lock", 43, "url", "https://files.example.com/tiny-1.0.0.tgz"),
    ],
  });
});

test("yarn.lock, Berry: a patch whose encoding cannot be decoded is a source it could not read", () => {
  const text = '__metadata:\n  version: 8\n\n"x@patch:x@npm%E0%A4%A#./p.patch":\n  version: 1.0.0\n  resolution: "x@patch:x@npm%E0%A4%A#./p.patch"\n';
  const read = readPackages([{ path: "yarn.lock", text }]);
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }],
    sourced: [sourced("x", "1.0.0", "yarn.lock", 4, "unreadable", null)],
  });
});

test("the source fixtures read the same with Windows line endings", () => {
  const crlf = (name) => fixture(name).replace(/\n/g, "\r\n");
  const cases = [
    ["package-lock.json", "package-lock.v3.sources.json"], ["package-lock.json", "package-lock.v1.git.json"],
    ["yarn.lock", "yarn.classic.sources.lock"], ["yarn.lock", "yarn.berry.sources.lock"],
  ];
  for (const [file, name] of cases) {
    assert.deepEqual(readPackages([{ path: file, text: crlf(name) }]), one(file, name), name);
  }
});

test("the same package from the registry in one lockfile and a mirror in another: the mirror is reported whatever the file order", () => {
  const lock = (resolved) => JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/lodash": { version: "4.17.21", resolved } } });
  const registry = { path: "a/package-lock.json", text: lock("https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz") };
  const mirror = { path: "b/package-lock.json", text: lock("https://registry.npmmirror.com/lodash/-/lodash-4.17.21.tgz") };
  for (const files of [[registry, mirror], [mirror, registry]]) {
    assert.deepEqual(readPackages(files), {
      ...EMPTY,
      packages: [npm("lodash", "4.17.21", "a/package-lock.json", 1)],
      sourced: [sourced("lodash", "4.17.21", "b/package-lock.json", 1, "host", "https://registry.npmmirror.com")],
    });
  }
});

test("a resolved address it cannot read is reported, once per file, never sent to OSV, and never shown", () => {
  const text = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "node_modules/x": { version: "1.0.0", resolved: "weird:SECRET token" },
      "node_modules/y": { version: "2.0.0", resolved: "%%%SECRET" },
    },
  });
  const read = readPackages([{ path: "package-lock.json", text }]);
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [{ file: "package-lock.json", reason: UNREADABLE_SOURCE }],
    sourced: [sourced("x", "1.0.0", "package-lock.json", 1, "unreadable", null), sourced("y", "2.0.0", "package-lock.json", 1, "unreadable", null)],
  });
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("a yarn.lock with a resolution line millions of characters long is read quickly", () => {
  const text = `__metadata:\n  version: 8\n\n"x@npm:1":\n  version: 1.0.0\n  resolution: "x@${"a@".repeat(2000000)}"\n`;
  const read = quickly(() => readPackages([{ path: "yarn.lock", text }]));
  assert.deepEqual(read.couldNotRead, [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }]);
});

test("package-lock.json version 1: an alias whose version is a URL is classified from it, and the version is not kept", () => {
  const text = JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: `npm:b@git+https://SECRET@github.com/u/r.git#${SHA1}` } } });
  const read = readPackages([{ path: "package-lock.json", text }]);
  assert.deepEqual(read, {
    ...EMPTY,
    sourced: [sourced("b", null, "package-lock.json", 1, "git", "https://github.com/u/r.git", { commit: SHA1 })],
  });
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("package-lock.json version 3: a version that is not semver is never kept; with no source of its own the entry is unreadable", () => {
  const bad = "git+https://SECRET@github.com/u/r.git";
  const text = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "node_modules/a": { version: bad, resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" },
      "node_modules/b": { version: bad, resolved: "https://registry.npmmirror.com/b/-/b-1.0.0.tgz" },
      "node_modules/c": { version: bad },
    },
  });
  const read = readPackages([{ path: "package-lock.json", text }]);
  assert.deepEqual(read, {
    ...EMPTY,
    packages: [npm("a", null, "package-lock.json", 1)],
    couldNotRead: [{ file: "package-lock.json", reason: UNREADABLE_SOURCE }],
    sourced: [
      sourced("b", null, "package-lock.json", 1, "host", "https://registry.npmmirror.com"),
      sourced("c", null, "package-lock.json", 1, "unreadable", null),
    ],
  });
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("yarn.lock, classic: a version that is not semver is never kept; with no source of its own the entry is unreadable", () => {
  const text = [
    "# yarn lockfile v1", "",
    "a@^1:", '  version "git+https://SECRET@github.com/u/r.git"', '  resolved "https://registry.npmmirror.com/a/-/a-1.0.0.tgz"', "",
    "b@^1:", '  version "git+https://SECRET@github.com/u/r.git"', "",
  ].join("\n");
  const read = readPackages([{ path: "yarn.lock", text }]);
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }],
    sourced: [sourced("a", null, "yarn.lock", 3, "host", "https://registry.npmmirror.com"), sourced("b", null, "yarn.lock", 7, "unreadable", null)],
  });
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("yarn.lock, Berry: a version that is not semver from npm: has no source of its own, so the entry is unreadable", () => {
  const text = '__metadata:\n  version: 8\n\n"a@npm:^1":\n  version: git+https://SECRET@github.com/u/r.git\n  resolution: "a@npm:1.0.0"\n';
  const read = readPackages([{ path: "yarn.lock", text }]);
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }],
    sourced: [sourced("a", null, "yarn.lock", 4, "unreadable", null)],
  });
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("yarn.lock: a second source line in a classic entry replaces the first entirely; in a Berry entry it is a source it could not read", () => {
  const berry = '__metadata:\n  version: 8\n\n"a@npm:^1":\n  version: 1.0.0\n  resolution: "a@https://files.example.com/a-1.0.0.tgz"\n  resolution: "a@npm:1.0.0"\n';
  assert.deepEqual(readPackages([{ path: "yarn.lock", text: berry }]).sourced, [sourced("a", "1.0.0", "yarn.lock", 4, "unreadable", null)]);
  const classic = [
    "# yarn lockfile v1", "",
    "a@^1:", '  version "1.0.0"', `  resolved "https://codeload.github.com/u/r/tar.gz/${SHA1}"`, '  resolved "https://registry.yarnpkg.com/a/-/a-1.0.0.tgz"', "",
  ].join("\n");
  assert.deepEqual(readPackages([{ path: "yarn.lock", text: classic }]), { ...EMPTY, packages: [npm("a", "1.0.0", "yarn.lock", 3)] });
});

test("a codeload address that is not a GitHub shorthand's tarball is left to the classifier", () => {
  const text = `# yarn lockfile v1\n\na@^1:\n  version "1.0.0"\n  resolved "https://codeload.github.com/u/r/zip/${SHA1}"\n`;
  assert.deepEqual(readPackages([{ path: "yarn.lock", text }]).sourced, [sourced("a", "1.0.0", "yarn.lock", 3, "host", "https://codeload.github.com")]);
});

const berryLock = (resolution) => `__metadata:\n  version: 8\n\n"x@npm:^1":\n  version: 1.0.0\n  resolution: "x@${resolution}"\n`;
const berrySourced = (resolution) => readPackages([{ path: "yarn.lock", text: berryLock(resolution) }]).sourced;

test("yarn.lock, Berry: a patch that names no package is a source it could not read", () => {
  assert.deepEqual(berrySourced("patch:nothing#./p.patch"), [sourced("x", "1.0.0", "yarn.lock", 4, "unreadable", null)]);
});

test("yarn.lock, Berry: a plain http address with #commit= is git, shown with http", () => {
  assert.deepEqual(berrySourced(`http://git.example/u/r.git#commit=${SHA1}`), [
    sourced("x", "1.0.0", "yarn.lock", 4, "git", "http://git.example/u/r.git", { commit: SHA1 }),
  ]);
});

test("yarn.lock, Berry: a patch of a git repository or an https tarball is classified by what it patches", () => {
  assert.deepEqual(berrySourced(`patch:x@https%3A//github.com/u/r.git%23commit=${SHA1}#./p.patch`), [
    sourced("x", "1.0.0", "yarn.lock", 4, "git", "https://github.com/u/r.git", { commit: SHA1 }),
  ]);
  assert.deepEqual(berrySourced("patch:x@https%3A//files.example.com/a/x-1.0.0.tgz#./p.patch"), [
    sourced("x", "1.0.0", "yarn.lock", 4, "url", "https://files.example.com/x-1.0.0.tgz"),
  ]);
});

test("pnpm-lock.yaml version 9 sources: integrity alone is checked; a mirror tarball, git, a codeload link and an https key are not; a directory is local", () => {
  const file = "pnpm-lock.yaml";
  assert.deepEqual(one(file, "pnpm-lock.v9.sources.yaml"), {
    ...EMPTY,
    packages: [npm("js-tokens", "4.0.0", file, 39)],
    sourced: [
      sourced("@scope/thing", "2.0.0", file, 35, "url", "https://files.example.com/thing-2.0.0.tgz"),
      sourced("left-pad", "1.3.0", file, 42, "git", "git@github.com:someone/left-pad.git", { commit: SHA1 }),
      sourced("lodash", "4.17.21", file, 46, "host", "https://registry.npmmirror.com"),
      sourced("other", "2.1.0", file, 56, "git", "https://gitlab.com/someone/other.git", { commit: SHA1 }),
      sourced("tiny", "1.0.0", file, 60, "git", "https://github.com/someone/tiny", { commit: SHA1 }),
    ],
  });
});

test("pnpm-lock.yaml version 6 sources: a github.com/u/r/<sha> key is git, named by the entry's name line", () => {
  const file = "pnpm-lock.yaml";
  assert.deepEqual(one(file, "pnpm-lock.v6.sources.yaml"), {
    ...EMPTY,
    packages: [npm("chalk", "2.4.2", file, 17)],
    sourced: [sourced("left-pad", "1.3.0", file, 22, "git", "https://github.com/someone/left-pad", { commit: SHA1 })],
  });
});

test("the pnpm source fixtures read the same with Windows line endings", () => {
  const crlf = (name) => fixture(name).replace(/\n/g, "\r\n");
  for (const name of ["pnpm-lock.v9.sources.yaml", "pnpm-lock.v6.sources.yaml"]) {
    assert.deepEqual(readPackages([{ path: "pnpm-lock.yaml", text: crlf(name) }]), one("pnpm-lock.yaml", name), name);
  }
});

const pnpmLock = (...lines) => ["lockfileVersion: '9.0'", "", "packages:", "", ...lines, ""].join("\n");
const pnpmRead = (...lines) => readPackages([{ path: "pnpm-lock.yaml", text: pnpmLock(...lines) }]);

test("pnpm-lock.yaml: a credential in a git key or repo is never shown, and a commit that is not a commit id is not kept", () => {
  const read = pnpmRead(
    "  x@git+https://SECRET@github.com/u/r.git#SECRETREF:",
    "    resolution: {commit: SECRETREF, repo: https://SECRET@github.com/u/r.git, type: git}",
  );
  assert.deepEqual(read, { ...EMPTY, sourced: [sourced("x", null, "pnpm-lock.yaml", 5, "git", "https://github.com/u/r.git")] });
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("pnpm-lock.yaml: a resolution on following lines is read up to the next field, so a dependency named like a resolution field is not", () => {
  const read = pnpmRead(
    "  a@1.0.0:",
    "    resolution:",
    `      commit: ${SHA1}`,
    "      repo: https://github.com/u/a.git",
    "      type: git",
    "    dependencies:",
    "      tarball: 1.0.0",
    "      type: 2.0.0",
    "",
    "  b@1.0.0:",
    "    resolution:",
    "      integrity: sha512-x",
    "    dependencies:",
    "      tarball: 1.0.0",
  );
  assert.deepEqual(read, {
    ...EMPTY,
    packages: [npm("b", "1.0.0", "pnpm-lock.yaml", 14)],
    sourced: [sourced("a", "1.0.0", "pnpm-lock.yaml", 5, "git", "https://github.com/u/a.git", { commit: SHA1 })],
  });
});

test("pnpm-lock.yaml: a file: key is local whatever its resolution; a resolution type it does not know is a source it could not read", () => {
  const read = pnpmRead(
    "  local@file:local-1.0.0.tgz:",
    "    resolution: {integrity: sha512-x, tarball: file:local-1.0.0.tgz}",
    "    version: 1.0.0",
    "",
    "  node@runtime:22.0.0:",
    "    resolution: {type: variations, variants: SECRET}",
    "    version: 22.0.0",
  );
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [{ file: "pnpm-lock.yaml", reason: UNREADABLE_SOURCE }],
    sourced: [sourced("node", "22.0.0", "pnpm-lock.yaml", 9, "unreadable", null)],
  });
  assert.ok(read.sourced.every((item) => item.kind !== "local"));
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("pnpm-lock.yaml: a key with no name takes the entry's name line and is classified by its resolution", () => {
  const read = pnpmRead(
    "  registry.npmmirror.com/tiny/-/tiny-1.0.0.tgz:",
    "    resolution: {tarball: https://registry.npmmirror.com/tiny/-/tiny-1.0.0.tgz}",
    "    name: tiny",
    "    version: 1.0.0",
  );
  assert.deepEqual(read.sourced, [sourced("tiny", "1.0.0", "pnpm-lock.yaml", 5, "host", "https://registry.npmmirror.com")]);
});

test("pnpm-lock.yaml: resolution fields named like built-in object properties are plain names; __proto__ is no plain name", () => {
  const read = pnpmRead("  a@1.0.0:", "    resolution: {constructor: y, hasOwnProperty: z, toString: w, integrity: sha512-x}");
  assert.deepEqual(read, { ...EMPTY, packages: [npm("a", "1.0.0", "pnpm-lock.yaml", 5)] });
  assert.deepEqual(pnpmRead("  a@1.0.0:", "    resolution: {__proto__: x, integrity: sha512-x}").sourced, [
    sourced("a", "1.0.0", "pnpm-lock.yaml", 5, "unreadable", null),
  ]);
});

test("a pnpm-lock.yaml with a resolution line millions of characters long is read quickly", () => {
  const long = `    resolution: {integrity: sha512-${"A".repeat(4000000)}}`;
  const read = quickly(() => pnpmRead("  a@1.0.0:", long));
  assert.deepEqual(read.packages, [npm("a", "1.0.0", "pnpm-lock.yaml", 5)]);
  const commas = quickly(() => pnpmRead("  a@1.0.0:", `    resolution: {integrity: sha512-x${", ".repeat(2000000)}}`));
  assert.deepEqual(commas.sourced, [sourced("a", "1.0.0", "pnpm-lock.yaml", 5, "unreadable", null)]);
});

const pnpmV6Read = (...lines) => readPackages([{ path: "pnpm-lock.yaml", text: ["lockfileVersion: '6.0'", "", "packages:", "", ...lines, ""].join("\n") }]);

test("pnpm-lock.yaml version 6: a tarball key is its address without the protocol, named by the entry's name line", () => {
  const read = pnpmV6Read(
    "  registry.npmjs.org/@s/p/-/p-1.0.0.tgz:",
    "    resolution: {integrity: sha512-x}",
    "    name: '@s/p'",
    "    version: 1.0.0",
  );
  assert.deepEqual(read, { ...EMPTY, packages: [npm("@s/p", "1.0.0", "pnpm-lock.yaml", 5)] });
});

test("pnpm-lock.yaml version 6: a key holding a credential before an @ is a source it could not read, named by the name line, never shown", () => {
  const read = pnpmV6Read(
    "  SECRET:pw@files.example.com/a/p-1.0.0.tgz:",
    "    resolution: {integrity: sha512-x}",
    "    name: p",
    "    version: 1.0.0",
  );
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [{ file: "pnpm-lock.yaml", reason: UNREADABLE_SOURCE }],
    sourced: [sourced("p", "1.0.0", "pnpm-lock.yaml", 5, "unreadable", null)],
  });
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("pnpm-lock.yaml: a resolution written in any shape but a one-line flow map or a block is a source it could not read", () => {
  const read = pnpmRead(
    "  a@1.0.0:",
    "    resolution: # mirror",
    "      tarball: https://evil.example/a-1.0.0.tgz",
    "",
    "  b@1.0.0:",
    "    resolution: &r",
    "      tarball: https://evil.example/b-1.0.0.tgz",
    "",
    "  c@1.0.0:",
    "    resolution: {integrity: sha512-x,",
    "      tarball: https://evil.example/c-1.0.0.tgz}",
    "",
    "  d@1.0.0:",
    "    resolution:   ",
    "      tarball: https://evil.example/d-1.0.0.tgz",
  );
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [{ file: "pnpm-lock.yaml", reason: UNREADABLE_SOURCE }],
    sourced: [
      sourced("a", "1.0.0", "pnpm-lock.yaml", 5, "unreadable", null),
      sourced("b", "1.0.0", "pnpm-lock.yaml", 9, "unreadable", null),
      sourced("c", "1.0.0", "pnpm-lock.yaml", 13, "unreadable", null),
      sourced("d", "1.0.0", "pnpm-lock.yaml", 17, "host", "https://evil.example"),
    ],
  });
});

test("pnpm-lock.yaml: a key that is neither the name line's name with a version nor a host and path is a source it could not read", () => {
  const read = pnpmRead("  alias@1.0.0:", "    resolution: {integrity: sha512-x}", "    name: real", "    version: 1.0.0");
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [{ file: "pnpm-lock.yaml", reason: UNREADABLE_SOURCE }],
    sourced: [sourced("real", "1.0.0", "pnpm-lock.yaml", 5, "unreadable", null)],
  });
});

test("pnpm-lock.yaml: a git resolution with no repository is a source it could not read", () => {
  const read = pnpmRead("  a@1.0.0:", `    resolution: {commit: ${SHA1}, type: git}`);
  assert.deepEqual(read.sourced, [sourced("a", "1.0.0", "pnpm-lock.yaml", 5, "unreadable", null)]);
});

test("pnpm-lock.yaml: a git key with a peer suffix is classified without it", () => {
  const read = pnpmRead(`  a@git+https://github.com/u/a.git#${SHA1}(react@18.2.0):`, "    resolution: {integrity: sha512-x}", "    version: 1.0.0");
  assert.deepEqual(read.sourced, [sourced("a", "1.0.0", "pnpm-lock.yaml", 5, "git", "https://github.com/u/a.git", { commit: SHA1 })]);
});

const unnamed = (line) => sourced(null, null, "pnpm-lock.yaml", line, "unreadable", null);

test("pnpm-lock.yaml version 6: a tarball key with no name line is a source it could not read with no name, never named from the key", () => {
  const read = pnpmV6Read(
    "  /chalk@2.4.2:",
    "    resolution: {integrity: sha512-x}",
    "",
    "  registry.npmmirror.com/@s/p/-/p-1.0.0.tgz:",
    "    resolution: {integrity: sha512-x}",
    "    version: 1.0.0",
    "",
    "  SECRET:pw@files.example.com/a/p-1.0.0.tgz:",
    "    resolution: {integrity: sha512-x}",
  );
  assert.deepEqual(read, {
    ...EMPTY,
    packages: [npm("chalk", "2.4.2", "pnpm-lock.yaml", 5)],
    couldNotRead: [{ file: "pnpm-lock.yaml", reason: UNREADABLE_SOURCE }],
    sourced: [unnamed(8), unnamed(12)],
  });
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("pnpm-lock.yaml: an entry whose name cannot be found is a source it could not read, with nothing from it kept", () => {
  const read = pnpmRead(
    "  a@1.0.0:",
    "    resolution: {integrity: sha512-x}",
    "",
    "  SECRETNAME:",
    "    resolution: {tarball: https://evil.example/SECRET/x.tgz}",
    "    version: 6.6.6-SECRET",
    "",
    "  x@latest:",
    "    resolution: {tarball: https://evil.example/SECRET/y.tgz}",
  );
  assert.deepEqual(read, {
    ...EMPTY,
    packages: [npm("a", "1.0.0", "pnpm-lock.yaml", 5)],
    couldNotRead: [{ file: "pnpm-lock.yaml", reason: UNREADABLE_SOURCE }],
    sourced: [unnamed(8), unnamed(12)],
  });
  assert.ok(!JSON.stringify(read).includes("SECRET"));
  assert.ok(!JSON.stringify(read).includes("evil"));
});

test("pnpm-lock.yaml: a quoted value in a resolution flow map is a source it could not read", () => {
  const read = pnpmRead("  a@1.0.0:", '    resolution: {integrity: "x\\", tarball: https://evil.example/a.tgz"}');
  assert.deepEqual(read.sourced, [sourced("a", "1.0.0", "pnpm-lock.yaml", 5, "unreadable", null)]);
});

test("pnpm-lock.yaml: an entry or resolution in a shape pnpm does not write is a source it could not read, never the registry", () => {
  const read = pnpmRead(
    "  a@1.0.0:",
    "    resolution:",
    "      tarball:",
    "        https://evil.example/a.tgz",
    "",
    "  b@1.0.0:",
    '    "resolution": {tarball: https://evil.example/b.tgz}',
    "",
    "  c@1.0.0: {resolution: {tarball: https://evil.example/c.tgz}}",
    "",
    "  d@1.0.0:",
    "    resolutions: {tarball: https://evil.example/d.tgz}",
    "    resolution: {integrity: sha512-x}",
    "",
    "  e@1.0.0:",
    "    resolution:",
    "      'tarball': https://evil.example/e.tgz",
    "",
    "  f@1.0.0:",
    "      tarball: https://evil.example/f.tgz",
  );
  assert.deepEqual(read, {
    ...EMPTY,
    packages: [npm("d", "1.0.0", "pnpm-lock.yaml", 15)],
    couldNotRead: [{ file: "pnpm-lock.yaml", reason: UNREADABLE_SOURCE }],
    sourced: [
      sourced("a", "1.0.0", "pnpm-lock.yaml", 5, "unreadable", null),
      sourced("b", "1.0.0", "pnpm-lock.yaml", 10, "unreadable", null),
      unnamed(13),
      sourced("e", "1.0.0", "pnpm-lock.yaml", 19, "unreadable", null),
      sourced("f", "1.0.0", "pnpm-lock.yaml", 23, "unreadable", null),
    ],
  });
  assert.ok(!JSON.stringify(read).includes("c.tgz"));
});

test("pnpm-lock.yaml: a packages section laid out at other indentations could not be read", () => {
  const layouts = [
    "packages:\n\n    a@1.0.0:\n      resolution: {tarball: https://evil.example/a.tgz}\n",
    "packages:\n\n  a@1.0.0:\n   resolution: {tarball: https://evil.example/a.tgz}\n",
    "packages:\n\n  a@1.0.0:\n    resolution:\n     tarball: https://evil.example/a.tgz\n",
    "packages:\n\n  a@1.0.0:\n\tresolution: {tarball: https://evil.example/a.tgz}\n",
  ];
  for (const layout of layouts) {
    const read = readPackages([{ path: "pnpm-lock.yaml", text: `lockfileVersion: '9.0'\n\n${layout}` }]);
    assert.deepEqual(read, { ...EMPTY, couldNotRead: [{ file: "pnpm-lock.yaml", reason: "not laid out as pnpm writes it" }] }, layout);
  }
});

test("pnpm-lock.yaml: comments and blank lines inside packages, at any indentation, are skipped without ending the section", () => {
  const read = pnpmRead(
    "  a@1.0.0:",
    "    resolution: {integrity: sha512-x}",
    "# a note",
    "   # another",
    "  b@1.0.0:",
    "    resolution: {tarball: https://evil.example/b.tgz}",
  );
  assert.deepEqual(read.sourced, [sourced("b", "1.0.0", "pnpm-lock.yaml", 9, "host", "https://evil.example")]);
});

test("yarn.lock: an entry header that does not end in a colon is a source it could not read with no name, never left out", () => {
  const classic = '# yarn lockfile v1\n\nleft-pad@^1\n  version "1.3.0"\n  resolved "https://evil.example/SECRET/x.tgz"\n';
  const berry = '__metadata:\n  version: 8\n\n"left-pad@npm:^1"\n  version: 1.3.0\n  resolution: "left-pad@https://evil.example/SECRET/x.tgz"\n';
  for (const [text, line] of [[classic, 3], [berry, 4]]) {
    const read = readPackages([{ path: "yarn.lock", text }]);
    assert.deepEqual(read, {
      ...EMPTY,
      couldNotRead: [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }],
      sourced: [sourced(null, null, "yarn.lock", line, "unreadable", null)],
    });
    assert.ok(!JSON.stringify(read).includes("SECRET"));
  }
});

test("yarn.lock: an entry with no version line is never left out; its source is classified, or with none it is unreadable", () => {
  const classic = [
    "# yarn lockfile v1", "",
    "a@^1:", '  resolved "https://registry.npmmirror.com/a/-/a-1.0.0.tgz"', "",
    "b@^1:", '  integrity "sha512-x"', "",
  ].join("\n");
  assert.deepEqual(readPackages([{ path: "yarn.lock", text: classic }]), {
    ...EMPTY,
    couldNotRead: [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }],
    sourced: [sourced("a", null, "yarn.lock", 3, "host", "https://registry.npmmirror.com"), sourced("b", null, "yarn.lock", 6, "unreadable", null)],
  });
  const berry = '__metadata:\n  version: 8\n\n"a@npm:^1":\n  resolution: "a@https://files.example.com/a-1.0.0.tgz"\n\n"b@npm:^1":\n  checksum: x\n';
  assert.deepEqual(readPackages([{ path: "yarn.lock", text: berry }]), {
    ...EMPTY,
    couldNotRead: [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }],
    sourced: [sourced("a", null, "yarn.lock", 4, "url", "https://files.example.com/a-1.0.0.tgz"), sourced("b", null, "yarn.lock", 7, "unreadable", null)],
  });
});

const PNPM_LAYOUT = "not laid out as pnpm writes it";
const EVIL = "https://evil.example/a.tgz";
const REGISTRY_B = ["  b@1.0.0:", "    resolution: {integrity: sha512-x}"];

test("pnpm-lock.yaml: YAML that pnpm does not write is a file or a source it could not read, never the registry", () => {
  const lock = (...lines) => ["lockfileVersion: '9.0'", "", "packages:", "", ...lines, ""].join("\n");
  const shapes = [
    ["A1 a flow map as packages", `lockfileVersion: '9.0'\n\npackages: {a@1.0.0: {resolution: {tarball: ${EVIL}}}}\n`, PNPM_LAYOUT],
    ["A2 a comment after packages:", `lockfileVersion: '9.0'\n\npackages: # c\n  a@1.0.0:\n    resolution: {tarball: ${EVIL}}\n`, PNPM_LAYOUT],
    ["A3 a tag after packages:", `lockfileVersion: '9.0'\n\npackages: !!map\n  a@1.0.0:\n    resolution: {tarball: ${EVIL}}\n`, PNPM_LAYOUT],
    ["A4 a top-level anchor merged in", `lockfileVersion: '9.0'\n\nsettings: &s\n  autoInstallPeers: true\n\n<<: *s\n\npackages:\n\n  a@1.0.0:\n    resolution: {integrity: sha512-x}\n`, PNPM_LAYOUT],
    ["C an entry merge key", lock(...REGISTRY_B, "    meta: &m", `      resolution: {tarball: ${EVIL}}`, "  a@1.0.0:", "    <<: *m"), UNREADABLE_SOURCE],
    ["E1 a quoted field name", lock("  a@1.0.0:", `    "resol\\u0075tion": {tarball: ${EVIL}}`), UNREADABLE_SOURCE],
    ["E2 a quoted flow key", lock("  a@1.0.0:", `    resolution: {"t\\u0061rball": ${EVIL}}`), UNREADABLE_SOURCE],
    ["G1 a tagged field name", lock("  a@1.0.0:", `    !!str resolution: {tarball: ${EVIL}}`), UNREADABLE_SOURCE],
    ["G2 a tagged flow key", lock("  a@1.0.0:", `    resolution: {!!str tarball: ${EVIL}}`), UNREADABLE_SOURCE],
    ["K a lone CR between fields", lock("  a@1.0.0:", `    version: 1.0.0\r    resolution: {tarball: ${EVIL}}`), PNPM_LAYOUT],
    ["K2 lone CRs at the top level", `lockfileVersion: '9.0'\n\nsettings: {}\rpackages:\r  a@1.0.0:\r    resolution: {tarball: ${EVIL}}\n`, PNPM_LAYOUT],
    ["T a tab after resolution:", lock("  a@1.0.0:", `    resolution:\t{tarball: ${EVIL}}`), PNPM_LAYOUT],
    ["V a list inside the flow map", lock("  a@1.0.0:", `    resolution: {tarball: ${EVIL}, x: [y, tarball: https://registry.npmjs.org/a/-/a-1.0.0.tgz]}`), UNREADABLE_SOURCE],
    ["F a passed-over flow map running onto the next line", lock("  a@1.0.0:", "    engines: {node: x,", "    resolution: {integrity: sha512-x}}"), UNREADABLE_SOURCE],
    ["Z a JSON-style flow map", lock("  a@1.0.0:", `    resolution: {"tarball":"${EVIL}"}`), UNREADABLE_SOURCE],
    ["W a flow key given twice", lock("  a@1.0.0:", `    resolution: {tarball: ${EVIL}, tarball: https://registry.npmjs.org/a/-/a-1.0.0.tgz}`), UNREADABLE_SOURCE],
    ["W2 a block key given twice", lock("  a@1.0.0:", "    resolution:", `      tarball: ${EVIL}`, "      tarball: https://registry.npmjs.org/a/-/a-1.0.0.tgz"), UNREADABLE_SOURCE],
    ["R a second resolution", lock("  a@1.0.0:", `    resolution: {tarball: ${EVIL}}`, "    resolution: {integrity: sha512-x}"), UNREADABLE_SOURCE],
    ["N an alias as a field value", lock(...REGISTRY_B, "  a@1.0.0:", "    version: *v", "    resolution: {integrity: sha512-x}"), UNREADABLE_SOURCE],
  ];
  for (const [shape, text, reason] of shapes) {
    const read = readPackages([{ path: "pnpm-lock.yaml", text }]);
    assert.deepEqual(read.couldNotRead, [{ file: "pnpm-lock.yaml", reason }], shape);
    assert.ok(!read.packages.some((p) => p.name === "a"), shape);
    assert.ok(!JSON.stringify(read).includes("evil"), shape);
  }
});

test("pnpm-lock.yaml: the top level is plain names, a document start and empty collections only", () => {
  const text = "---\nlockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n\noverrides: {}\n\npackages:\n\n  a@1.0.0:\n    resolution: {integrity: sha512-x}\n";
  assert.deepEqual(readPackages([{ path: "pnpm-lock.yaml", text }]), { ...EMPTY, packages: [npm("a", "1.0.0", "pnpm-lock.yaml", 11)] });
  for (const header of ["'packages':", '"packages":']) {
    const quoted = `lockfileVersion: '9.0'\n\n${header}\n\n  a@1.0.0:\n    resolution: {tarball: ${EVIL}}\n`;
    assert.deepEqual(readPackages([{ path: "pnpm-lock.yaml", text: quoted }]).couldNotRead, [{ file: "pnpm-lock.yaml", reason: PNPM_LAYOUT }], header);
  }
});

const YARN_LAYOUT = "not laid out as Yarn writes it";
const berryText = (...lines) => ["__metadata:", "  version: 8", "", ...lines, ""].join("\n");

test("yarn.lock, Berry: a lone CR or a tab could not be read", () => {
  for (const text of [berryText('"a@npm:^1":', "  version: 1.0.0\r  resolution: \"a@npm:1.0.0\""), berryText('"a@npm:^1":', "  version:\t1.0.0")]) {
    assert.deepEqual(readPackages([{ path: "yarn.lock", text }]), { ...EMPTY, couldNotRead: [{ file: "yarn.lock", reason: YARN_LAYOUT }] });
  }
});

test("yarn.lock, Berry: an escape, tag, anchor, alias, merge key or quoted field name is a source it could not read", () => {
  const entry = (...fields) => berryText('"a@npm:^1":', "  version: 1.0.0", ...fields);
  const shapes = [
    ["a tagged value", entry(`  resolution: !!str "a@${EVIL}"`)],
    ["an anchored value", entry('  resolution: &r "a@npm:1.0.0"')],
    ["an alias as a value", entry("  resolution: *r")],
    ["a merge key", entry('  resolution: "a@npm:1.0.0"', "  <<: *m")],
    ["a quoted field name", entry('  resolution: "a@npm:1.0.0"', `  "resolution": "a@${EVIL}"`)],
    ["an escape in a value", entry('  resolution: "a@https\\u003a//evil.example/a.tgz"')],
  ];
  for (const [shape, text] of shapes) {
    const read = readPackages([{ path: "yarn.lock", text }]);
    assert.deepEqual(read, {
      ...EMPTY,
      couldNotRead: [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }],
      sourced: [sourced("a", "1.0.0", "yarn.lock", 4, "unreadable", null)],
    }, shape);
  }
  const header = readPackages([{ path: "yarn.lock", text: berryText('"a@npm:^1\\u0020":', "  version: 1.0.0", '  resolution: "a@npm:1.0.0"') }]);
  assert.deepEqual(header.sourced, [sourced(null, null, "yarn.lock", 4, "unreadable", null)]);
});

test("yarn.lock, Berry: lines below a field other than resolution are passed over, whatever YAML they hold", () => {
  const text = berryText('"a@npm:^1":', "  version: 1.0.0", '  resolution: "a@npm:1.0.0"', "  dependencies:", "    b: *x", '    "c\\u0020": &y "npm:^1"');
  assert.deepEqual(readPackages([{ path: "yarn.lock", text }]), { ...EMPTY, packages: [npm("a", "1.0.0", "yarn.lock", 4)] });
});

test("yarn.lock, Berry: a header Berry does not write is an entry it cannot name", () => {
  const headers = ['? "a@npm:^1"', "{a@npm:^1: x}", '"a@npm:^1": &x', "'a@npm:^1':", '"a@npm:^1" #c:', "<<: *m"];
  for (const header of headers) {
    const read = readPackages([{ path: "yarn.lock", text: berryText(header, "  version: 1.0.0", `  resolution: "a@${EVIL}"`) }]);
    assert.deepEqual(read.sourced, [sourced(null, null, "yarn.lock", 4, "unreadable", null)], header);
    assert.ok(!JSON.stringify(read).includes("evil"), header);
  }
  const plain = readPackages([{ path: "yarn.lock", text: berryText("a@npm:^1:", "  version: 1.0.0", '  resolution: "a@npm:1.0.0"') }]);
  assert.deepEqual(plain, { ...EMPTY, packages: [npm("a", "1.0.0", "yarn.lock", 4)] });
});

test("yarn.lock, Berry: a version or resolution that is not a plain or double-quoted scalar on one line, or a field left open, is a source it could not read", () => {
  const entry = (...fields) => berryText('"a@npm:^1":', ...fields);
  const shapes = [
    ["a block scalar resolution", entry("  version: 1.0.0", "  resolution: |", `    a@${EVIL}`)],
    ["a single-quoted resolution", entry("  version: 1.0.0", `  resolution: 'a@${EVIL}'`)],
    ["a flow map resolution", entry("  version: 1.0.0", `  resolution: {a: ${EVIL}}`)],
    ["a flow list resolution", entry("  version: 1.0.0", `  resolution: [a@${EVIL}]`)],
    ["a resolution on the next line", entry("  version: 1.0.0", "  resolution:", `    "a@${EVIL}"`)],
    ["a folded version", entry("  version: >", "    1.0.0", `  resolution: "a@${EVIL}"`)],
    ["a flow map left open", entry("  version: 1.0.0", `  resolution: "a@${EVIL}"`, "  checksum: {x: y,", '  resolution: "a@npm:1.0.0"}')],
    ["a flow list left open", entry("  version: 1.0.0", `  resolution: "a@${EVIL}"`, "  checksum: [x,", '  resolution: "a@npm:1.0.0"]')],
    ["a quoted string left open", entry("  version: 1.0.0", `  resolution: "a@${EVIL}"`, '  checksum: "x', '  resolution: a@npm:1.0.0"')],
  ];
  for (const [shape, text] of shapes) {
    const read = readPackages([{ path: "yarn.lock", text }]);
    assert.deepEqual(read.couldNotRead, [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }], shape);
    assert.equal(read.sourced.length, 1, shape);
    assert.equal(read.sourced[0].kind, "unreadable", shape);
    assert.ok(!JSON.stringify(read).includes("evil"), shape);
  }
});

test("yarn.lock, Berry: version and resolution come from the one field read; any other shape around them is a source it could not read", () => {
  const entry = (...fields) => berryText('"a@npm:^1":', ...fields);
  const shapes = [
    ["a space before the colon", entry("  version: 1.0.0", `  resolution : "a@${EVIL}"`), "1.0.0"],
    ["a space before the version's colon", entry("  version : 9.9.9", '  resolution: "a@npm:1.0.0"'), null],
    ["a resolution continued on a deeper line", entry("  version: 1.0.0", "  resolution: a@npm:1.0.0", `   ${EVIL}`), "1.0.0"],
    ["a version continued on a deeper line", entry("  version: 1.0.0", "    2", '  resolution: "a@npm:1.0.0"'), "1.0.0"],
    ["a second version", entry("  version: 1.0.0", "  version: 2.0.0", '  resolution: "a@npm:1.0.0"'), "1.0.0"],
  ];
  for (const [shape, text, version] of shapes) {
    const read = readPackages([{ path: "yarn.lock", text }]);
    assert.deepEqual(read.sourced, [sourced("a", version, "yarn.lock", 4, "unreadable", null)], shape);
    assert.deepEqual(read.couldNotRead, [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }], shape);
  }
});

test("yarn.lock, Berry: an entry is skipped as a workspace by its resolution, not its header; a quoted __metadata is an entry", () => {
  const listed = berryText('"a@workspace:x, a@npm:1.0.0":', "  version: 1.0.0", `  resolution: "a@${EVIL}"`);
  assert.deepEqual(readPackages([{ path: "yarn.lock", text: listed }]).sourced, [sourced("a", "1.0.0", "yarn.lock", 4, "url", "https://evil.example/a.tgz")]);
  const workspace = berryText('"a@npm:1.0.0, a@workspace:x":', "  version: 1.0.0", '  resolution: "a@workspace:x"');
  assert.deepEqual(readPackages([{ path: "yarn.lock", text: workspace }]), EMPTY);
  const metadata = berryText('"__metadata":', "  version: 1.0.0", `  resolution: "a@${EVIL}"`);
  assert.deepEqual(readPackages([{ path: "yarn.lock", text: metadata }]).sourced, [sourced("__metadata", "1.0.0", "yarn.lock", 4, "url", "https://evil.example/a.tgz")]);
});

const classicText = (...lines) => ["# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.", "# yarn lockfile v1", "", "", ...lines, ""].join("\n");

test("yarn.lock, classic: a field in any shape but a plain name, one space and a plain or escape-free double-quoted value is a source it could not read", () => {
  const entry = (...fields) => classicText("a@^1.0.0:", '  version "1.0.0"', ...fields);
  const shapes = [
    ["a quoted key", entry(`  "resolved" "${EVIL}"`)],
    ["a key with a colon", entry(`  resolved: "${EVIL}"`)],
    ["a tab between key and value", entry(`  resolved\t"${EVIL}"`)],
    ["an escape in the host", entry('  resolved "https://registry.yarnpkg.com\\u002eevil.example/a.tgz"')],
    ["an escape deeper down", entry('  resolved "https://registry.yarnpkg.com/a/-/a-1.0.0.tgz"', "  dependencies:", '    "b\\u0020" "^1"')],
    ["text after the quoted value", entry(`  resolved "${EVIL}" # c`)],
    ["a line at 3 spaces", entry('  resolved "https://registry.yarnpkg.com/a/-/a-1.0.0.tgz"', `   resolved "${EVIL}"`)],
    ["a deeper line under a field with a value", entry('  resolved "https://registry.yarnpkg.com/a/-/a-1.0.0.tgz"', `    "${EVIL}"`)],
  ];
  for (const [shape, text] of shapes) {
    const read = readPackages([{ path: "yarn.lock", text }]);
    assert.deepEqual(read.sourced, [sourced("a", "1.0.0", "yarn.lock", 5, "unreadable", null)], shape);
    assert.deepEqual(read.couldNotRead, [{ file: "yarn.lock", reason: UNREADABLE_SOURCE }], shape);
  }
  const plain = classicText("a@^1.0.0:", "  version 1.0.0", '  resolved "https://registry.yarnpkg.com/a/-/a-1.0.0.tgz"', "  integrity sha512-x", "  dependencies:", '    b "^1"');
  assert.deepEqual(readPackages([{ path: "yarn.lock", text: plain }]), { ...EMPTY, packages: [npm("a", "1.0.0", "yarn.lock", 5)] });
});

test("yarn.lock, classic: no entry is skipped for its header", () => {
  const text = classicText("a@workspace:x, a@^1.0.0:", '  version "1.0.0"', `  resolved "${EVIL}"`);
  assert.deepEqual(readPackages([{ path: "yarn.lock", text }]).sourced, [sourced("a", "1.0.0", "yarn.lock", 5, "host", "https://evil.example")]);
});

test("yarn.lock, classic: a second version in an entry is a source it could not read", () => {
  const text = classicText("a@^1.0.0:", '  version "1.0.0"', '  version "2.0.0"', '  resolved "https://registry.yarnpkg.com/a/-/a-1.0.0.tgz"');
  assert.deepEqual(readPackages([{ path: "yarn.lock", text }]).sourced, [sourced("a", "1.0.0", "yarn.lock", 5, "unreadable", null)]);
});

test("yarn.lock, Berry: a workspace resolution is skipped only when it names a relative folder; any other is a source it could not read", () => {
  const lock = (resolution) => berryText('"a@workspace:x":', "  version: 1.0.0", `  resolution: "a@workspace:${resolution}"`);
  for (const folder of [".", "./packages/a", "../a", "packages/a"]) {
    assert.deepEqual(readPackages([{ path: "yarn.lock", text: lock(folder) }]), EMPTY, folder);
  }
  for (const odd of [EVIL, "/abs/a", "x:y", "a//b", ""]) {
    const read = readPackages([{ path: "yarn.lock", text: lock(odd) }]);
    assert.deepEqual(read.sourced, [sourced("a", "1.0.0", "yarn.lock", 4, "unreadable", null)], odd);
    assert.ok(!JSON.stringify(read).includes("evil"), odd);
  }
});

const pypiSourced = (name, version, file, line, kind, address, extra = {}) => ({ ecosystem: "PyPI", file, line, name, version, kind, address, ...extra });
const POETRY_LAYOUT = "not laid out as Poetry writes it";
const UV_LAYOUT = "not laid out as uv writes it";

test("poetry.lock sources: a block runs through its sub-tables to [package.source]; a mirror index and git are reported, a folder inside the project is local, one outside it is not", () => {
  const file = "poetry.lock";
  assert.deepEqual(one(file, "poetry.sources.lock"), {
    ...EMPTY,
    packages: [pypi("certifi", "2024.8.30", file, 4)],
    sourced: [
      pypiSourced("requests", "2.32.3", file, 15, "host", "https://mirror.example.com"),
      pypiSourced("left-pad", "1.3.0", file, 39, "git", "https://github.com/someone/left-pad.git", { commit: SHA1 }),
      pypiSourced("outside", "0.2.0", file, 67, "url", null, { text: "a path outside the project" }),
    ],
  });
});

test("uv.lock sources: git with its commit and a direct URL are reported; a mirror named by source, sdist and wheels is one package; a path and the project are not", () => {
  const file = "uv.lock";
  assert.deepEqual(one(file, "uv.sources.lock"), {
    ...EMPTY,
    packages: [pypi("anyio", "4.6.2.post1", file, 6)],
    sourced: [
      pypiSourced("idna", "3.10", file, 18, "host", "https://mirror.example.com"),
      pypiSourced("left-pad", "1.3.0", file, 28, "git", "https://github.com/someone/left-pad", { commit: SHA1 }),
      pypiSourced("sniffio", "1.3.1", file, 39, "url", "https://files.example.com/sniffio-1.3.1.tar.gz"),
    ],
  });
});

test("the Poetry and uv source fixtures read the same with Windows line endings", () => {
  for (const [file, name] of [["poetry.lock", "poetry.sources.lock"], ["uv.lock", "uv.sources.lock"]]) {
    assert.deepEqual(readPackages([{ path: file, text: fixture(name).replace(/\n/g, "\r\n") }]), one(file, name), name);
  }
});

const uvLock = (...lines) => ['version = 1', 'requires-python = ">=3.10"', "", "[[package]]", 'name = "a"', 'version = "1.0.0"', ...lines, ""].join("\n");
const poetryLock = (...lines) => ["[[package]]", 'name = "a"', 'version = "1.0.0"', 'description = ""', "files = []", ...lines, "", "[metadata]", 'lock-version = "2.0"', ""].join("\n");
const uvBlock = (name, source) => uvLock(`source = ${source}`).replace('name = "a"', `name = "${name}"`);

test("uv.lock: the first address that is not the registry among source, sdist and wheels decides; a wheel file name is no address", () => {
  const read = readPackages([{
    path: "uv.lock",
    text: uvLock(
      'source = { registry = "https://pypi.org/simple" }',
      'sdist = { url = "https://files.pythonhosted.org/packages/a-1.0.0.tar.gz", hash = "sha256:x", size = 1 }',
      "wheels = [",
      '    { url = "https://files.pythonhosted.org/packages/a-1.0.0-py3-none-any.whl", hash = "sha256:x", size = 1 },',
      '    { url = "https://mirror.example.com/a-1.0.0-cp312-win_amd64.whl", hash = "sha256:x", size = 1 },',
      '    { filename = "a-1.0.0-cp311-win_amd64.whl", hash = "sha256:x", size = 1 },',
      "]",
    ),
  }]);
  assert.deepEqual(read, { ...EMPTY, sourced: [pypiSourced("a", "1.0.0", "uv.lock", 5, "host", "https://mirror.example.com")] });
  const oneLine = readPackages([{ path: "uv.lock", text: uvLock('source = { registry = "https://pypi.org/simple" }', 'wheels = [{ url = "https://mirror.example.com/a.whl" }]') }]);
  assert.deepEqual(oneLine.sourced, [pypiSourced("a", "1.0.0", "uv.lock", 5, "host", "https://mirror.example.com")]);
});

test("uv.lock: a registry that is a folder is local; one that is neither a folder nor an address it can read is a source it could not read", () => {
  assert.deepEqual(readPackages([{ path: "uv.lock", text: uvLock('source = { registry = "wheels" }') }]), EMPTY);
  const read = readPackages([{ path: "uv.lock", text: uvLock('source = { registry = "weird:SECRET" }') }]);
  assert.deepEqual(read, {
    ...EMPTY,
    couldNotRead: [{ file: "uv.lock", reason: UNREADABLE_SOURCE }],
    sourced: [pypiSourced("a", "1.0.0", "uv.lock", 5, "unreadable", null)],
  });
  assert.ok(!JSON.stringify(read).includes("SECRET"));
});

test("uv.lock: a package with no source is a source it could not read; an editable or virtual source with anything else beside it is not the project", () => {
  const shapes = [uvLock(), uvLock('source = { editable = ".", url = "https://evil.example/a.tgz" }')];
  for (const text of shapes) {
    const read = readPackages([{ path: "uv.lock", text }]);
    assert.deepEqual(read.sourced, [pypiSourced("a", "1.0.0", "uv.lock", 5, "unreadable", null)], text);
    assert.ok(!JSON.stringify(read).includes("evil"), text);
  }
});

test("poetry.lock: url, file and git sources; a commit that is not a commit id is not kept; an absolute path is outside the project", () => {
  const block = (name, ...source) => ["[[package]]", `name = "${name}"`, 'version = "1.0.0"', "", "[package.source]", ...source, ""].join("\n");
  const text = [
    block("a", 'type = "url"', 'url = "https://files.example.com/x/a-1.0.0.tar.gz"'),
    block("b", 'type = "git"', 'url = "git@github.com:u/b.git"', 'reference = "main"', 'resolved_reference = "main"'),
    block("c", 'type = "file"', 'url = "dist/c-1.0.0.tar.gz"'),
    block("d", 'type = "file"', 'url = "/home/someone/d-1.0.0.tar.gz"'),
    block("e", 'type = "legacy"', 'url = "https://pypi.org/simple"', 'reference = "pypi-explicit"'),
    block("f", 'type = "directory"', 'url = "a/../../f"'),
  ].join("\n");
  assert.deepEqual(readPackages([{ path: "poetry.lock", text }]), {
    ...EMPTY,
    packages: [pypi("e", "1.0.0", "poetry.lock", 36)],
    sourced: [
      pypiSourced("a", "1.0.0", "poetry.lock", 2, "url", "https://files.example.com/a-1.0.0.tar.gz"),
      pypiSourced("b", "1.0.0", "poetry.lock", 10, "git", "git@github.com:u/b.git"),
      pypiSourced("d", "1.0.0", "poetry.lock", 28, "url", null, { text: "a path outside the project" }),
      pypiSourced("f", "1.0.0", "poetry.lock", 45, "url", null, { text: "a path outside the project" }),
    ],
  });
});

test("Python lockfiles: a version that is PEP 440 is kept; any other is never kept, and with no source of its own the entry is unreadable", () => {
  const versions = ["4.6.2.post1", "2024.8.30", "1!2.0", "1.0+local", "1.0rc1", "1.0.dev0", "1.0.0-beta.1", "v1.0", "1.0-1", "1.0+ubuntu-1.2"];
  const uv = versions.map((v, i) => uvLock('source = { registry = "https://pypi.org/simple" }').replace('version = "1.0.0"', `version = "${v}"`).replace('name = "a"', `name = "p${i}"`).split("\n").slice(3).join("\n")).join("\n");
  assert.deepEqual(readPackages([{ path: "uv.lock", text: `version = 1\n\n${uv}` }]).packages.map((p) => p.version), versions);
  const odd = ["https://SECRET@evil.example/x.tgz", "1.0.*", "1..0", "1.0.", "latest", "1.0\u001b[31m"];
  for (const version of odd) {
    const poetry = `[[package]]\nname = "a"\nversion = "${version}"\n`;
    const read = readPackages([{ path: "poetry.lock", text: poetry }]);
    assert.deepEqual(read, {
      ...EMPTY,
      couldNotRead: [{ file: "poetry.lock", reason: UNREADABLE_SOURCE }],
      sourced: [pypiSourced("a", null, "poetry.lock", 2, "unreadable", null)],
    }, version);
    const uvRead = readPackages([{ path: "uv.lock", text: uvLock('source = { registry = "https://pypi.org/simple" }').replace('version = "1.0.0"', `version = "${version}"`) }]);
    assert.deepEqual(uvRead, { ...EMPTY, packages: [pypi("a", null, "uv.lock", 5)] }, version);
    assert.ok(!JSON.stringify(read).includes("SECRET") && !JSON.stringify(uvRead).includes("SECRET"), version);
  }
  const requirements = readPackages([{ path: "requirements.txt", text: "x==1.0\u001b[31m\nidna==3.10\n" }]);
  assert.deepEqual(requirements, {
    ...EMPTY,
    packages: [pypi("idna", "3.10", "requirements.txt", 2)],
    couldNotRead: [{ file: "requirements.txt", reason: UNREADABLE_SOURCE }],
    sourced: [pypiSourced("x", null, "requirements.txt", 1, "unreadable", null)],
  });
});

test("a long run of digits as a Python version is checked quickly", () => {
  const read = quickly(() => readPackages([{ path: "requirements.txt", text: `x==${"1".repeat(4000000)}x\n` }]));
  assert.equal(read.sourced.length, 1);
});

test("Python lockfiles: a block whose name cannot be found is a source it could not read with no name, never left out", () => {
  const uv = readPackages([{ path: "uv.lock", text: uvLock('source = { registry = "https://evil.example/SECRET" }').replace('name = "a"', '"name" = "a"') }]);
  const poetry = readPackages([{ path: "poetry.lock", text: '[[package]]\nversion = "1.0.0"\n\n[package.source]\ntype = "legacy"\nurl = "https://evil.example/SECRET"\n' }]);
  for (const [file, read] of [["uv.lock", uv], ["poetry.lock", poetry]]) {
    assert.deepEqual(read, {
      ...EMPTY,
      couldNotRead: [{ file, reason: UNREADABLE_SOURCE }],
      sourced: [pypiSourced(null, null, file, file === "uv.lock" ? 4 : 1, "unreadable", null)],
    }, file);
    assert.ok(!JSON.stringify(read).includes("SECRET"), file);
  }
});

test("Python lockfiles: a block with no version and a source that is not the registry is reported with no version", () => {
  const read = readPackages([{ path: "poetry.lock", text: '[[package]]\nname = "a"\n\n[package.source]\ntype = "git"\nurl = "https://github.com/u/a.git"\n' }]);
  assert.deepEqual(read, { ...EMPTY, sourced: [pypiSourced("a", null, "poetry.lock", 2, "git", "https://github.com/u/a.git")] });
});

test("Python lockfiles: what Poetry and uv write outside a source reads as they write it (escapes, quoted keys, inline tables, nested arrays)", () => {
  const poetry = [
    "[[package]]", 'name = "a"', 'version = "1.0.0"', 'description = "A \\"quoted\\" word # not a comment"', "",
    "[package.dependencies]", 'colorama = {version = "*", markers = "platform_system == \\"Windows\\""}', '"zope.interface" = ">=5"', "",
    "[package.extras]", 'socks = ["PySocks (>=1.5.6,!=1.5.7)"]', "",
    "[metadata]", 'lock-version = "2.0"', "", "[metadata.files]", '"zope.interface" = [', '    {file = "z.whl", hash = "sha256:x"},', "]", "",
  ].join("\n");
  assert.deepEqual(readPackages([{ path: "poetry.lock", text: poetry }]), { ...EMPTY, packages: [pypi("a", "1.0.0", "poetry.lock", 2)] });
  const uv = [
    "version = 1", 'requires-python = ">=3.10"', "resolution-markers = [", '    "sys_platform == \'win32\'",', "]",
    "conflicts = [[", '    { package = "t", extra = "a" },', '    { package = "t", extra = "b" },', "]]", "",
    "[[package]]", 'name = "a"', 'version = "1.0.0"', 'source = { registry = "https://pypi.org/simple" }', "",
    "[package.metadata]", "requires-dist = [", '["nested"],', "]", "", "[package.metadata.requires-dev]", 'dev = [{ name = "b" }]', "",
    "[manifest]", 'members = ["t"]', "",
  ].join("\n");
  assert.deepEqual(readPackages([{ path: "uv.lock", text: uv }]), { ...EMPTY, packages: [pypi("a", "1.0.0", "uv.lock", 12)] });
});

test("Python lockfiles: TOML that Poetry or uv would not write where a source can be named is a file or a source it could not read, never the registry", () => {
  const EVIL_INDEX = "https://evil.example/simple";
  const uvSource = (text) => uvLock(text);
  const shapes = [
    ["uv.lock", "a [package.source] table", uvLock("", "[package.source]", `registry = "${EVIL_INDEX}"`), UNREADABLE_SOURCE],
    ["uv.lock", "a dotted source key", uvSource(`source.registry = "${EVIL_INDEX}"`), UNREADABLE_SOURCE],
    ["uv.lock", "a dotted sdist key", uvLock('source = { registry = "https://pypi.org/simple" }', 'sdist.url = "https://evil.example/a.tar.gz"'), UNREADABLE_SOURCE],
    ["uv.lock", "a quoted source key", uvSource(`"source" = { registry = "${EVIL_INDEX}" }`), UNREADABLE_SOURCE],
    ["uv.lock", "a literal source key", uvSource(`'source' = { registry = "${EVIL_INDEX}" }`), UNREADABLE_SOURCE],
    ["uv.lock", "a quoted key inside the source", uvSource(`source = { "registry" = "${EVIL_INDEX}" }`), UNREADABLE_SOURCE],
    ["uv.lock", "a dotted key inside the source", uvSource(`source = { registry.x = "${EVIL_INDEX}" }`), UNREADABLE_SOURCE],
    ["uv.lock", "an escape in the address", uvSource('source = { registry = "https:\\u002f\\u002fevil.example/simple" }'), UNREADABLE_SOURCE],
    ["uv.lock", "a literal string address", uvSource(`source = { registry = '${EVIL_INDEX}' }`), UNREADABLE_SOURCE],
    ["uv.lock", "a multi-line basic string", uvSource(`source = { registry = """${EVIL_INDEX}""" }`), UV_LAYOUT],
    ["uv.lock", "a multi-line literal string", uvSource(`source = { registry = '''${EVIL_INDEX}''' }`), UV_LAYOUT],
    ["uv.lock", "no spaces around =", uvSource(`source={ registry = "${EVIL_INDEX}" }`), UNREADABLE_SOURCE],
    ["uv.lock", "two spaces before =", uvSource(`source  = { registry = "${EVIL_INDEX}" }`), UNREADABLE_SOURCE],
    ["uv.lock", "an inline table without inner spaces", uvSource(`source = {registry = "${EVIL_INDEX}"}`), UNREADABLE_SOURCE],
    ["uv.lock", "a comment after the source", uvSource(`source = { registry = "${EVIL_INDEX}" } # mirror`), UNREADABLE_SOURCE],
    ["uv.lock", "a source given twice", uvLock('source = { registry = "https://pypi.org/simple" }', `source = { registry = "${EVIL_INDEX}" }`), UNREADABLE_SOURCE],
    ["uv.lock", "a key given twice in the source", uvSource(`source = { registry = "https://pypi.org/simple", registry = "${EVIL_INDEX}" }`), UNREADABLE_SOURCE],
    ["uv.lock", "two kinds of source", uvSource('source = { registry = "https://pypi.org/simple", url = "https://evil.example/a.tgz" }'), UNREADABLE_SOURCE],
    ["uv.lock", "a key it does not know in sdist", uvLock('source = { registry = "https://pypi.org/simple" }', 'sdist = { mirror = "https://evil.example/a.tar.gz" }'), UNREADABLE_SOURCE],
    ["uv.lock", "a comment inside wheels", uvLock('source = { registry = "https://pypi.org/simple" }', "wheels = [", "    # mirror", '    { url = "https://evil.example/a.whl" },', "]"), UNREADABLE_SOURCE],
    ["uv.lock", "a wheel without its trailing comma", uvLock('source = { registry = "https://pypi.org/simple" }', "wheels = [", '    { url = "https://evil.example/a.whl" }', "]"), UNREADABLE_SOURCE],
    ["uv.lock", "a [[package.wheels]] table", uvLock('source = { registry = "https://pypi.org/simple" }', "", "[[package.wheels]]", 'url = "https://evil.example/a.whl"'), UNREADABLE_SOURCE],
    ["uv.lock", "a [package.sdist] table", uvLock('source = { registry = "https://pypi.org/simple" }', "", "[package.sdist]", 'url = "https://evil.example/a.tar.gz"'), UNREADABLE_SOURCE],
    ["uv.lock", "an indented header", uvLock('source = { registry = "https://pypi.org/simple" }', "", "  [package.source]", `  registry = "${EVIL_INDEX}"`), UV_LAYOUT],
    ["uv.lock", "an indented key", uvLock('source = { registry = "https://pypi.org/simple" }', `  sdist = { url = "https://evil.example/a.tar.gz" }`), UV_LAYOUT],
    ["uv.lock", "a header with spaces", uvLock('source = { registry = "https://pypi.org/simple" }', "", "[ package.source ]", `registry = "${EVIL_INDEX}"`), UV_LAYOUT],
    ["uv.lock", "a header with a quoted key", uvLock('source = { registry = "https://pypi.org/simple" }', "", '[package."source"]', `registry = "${EVIL_INDEX}"`), UV_LAYOUT],
    ["uv.lock", "a package table after another table", uvLock('source = { registry = "https://pypi.org/simple" }', "", "[manifest]", "", "[package.metadata]", `x = "${EVIL_INDEX}"`), UV_LAYOUT],
    ["uv.lock", "a lone CR", uvLock(`version2 = 1\rsource = { registry = "${EVIL_INDEX}" }`), UV_LAYOUT],
    ["uv.lock", "a tab before =", uvSource(`source\t= { registry = "${EVIL_INDEX}" }`), UV_LAYOUT],
    ["uv.lock", "an inline table over two lines", uvSource(`source = { registry =\n"${EVIL_INDEX}" }`), UV_LAYOUT],
    ["uv.lock", "packages as a top-level array", `version = 1\npackage = [{ name = "a", version = "1.0.0", source = { registry = "${EVIL_INDEX}" } }]\n`, UV_LAYOUT],
    ["uv.lock", "a quoted top-level key", `version = 1\n"package" = [{ name = "a", version = "1.0.0", source = { registry = "${EVIL_INDEX}" } }]\n`, UV_LAYOUT],
    ["poetry.lock", "an inline source", poetryLock(`source = {type = "legacy", url = "${EVIL_INDEX}"}`), UNREADABLE_SOURCE],
    ["poetry.lock", "dotted source keys", poetryLock('source.type = "legacy"', `source.url = "${EVIL_INDEX}"`), UNREADABLE_SOURCE],
    ["poetry.lock", "a quoted key in the source", poetryLock("", "[package.source]", 'type = "legacy"', `"url" = "${EVIL_INDEX}"`), UNREADABLE_SOURCE],
    ["poetry.lock", "a literal string url", poetryLock("", "[package.source]", 'type = "legacy"', `url = '${EVIL_INDEX}'`), UNREADABLE_SOURCE],
    ["poetry.lock", "an escape in the url", poetryLock("", "[package.source]", 'type = "legacy"', 'url = "https://evil\\u002eexample/simple"'), UNREADABLE_SOURCE],
    ["poetry.lock", "a multi-line url", poetryLock("", "[package.source]", 'type = "legacy"', `url = """${EVIL_INDEX}"""`), POETRY_LAYOUT],
    ["poetry.lock", "no spaces around =", poetryLock("", "[package.source]", 'type = "legacy"', `url="${EVIL_INDEX}"`), UNREADABLE_SOURCE],
    ["poetry.lock", "a comment after the url", poetryLock("", "[package.source]", 'type = "legacy"', `url = "${EVIL_INDEX}" # mirror`), UNREADABLE_SOURCE],
    ["poetry.lock", "a url given twice", poetryLock("", "[package.source]", 'type = "legacy"', `url = "${EVIL_INDEX}"`, 'url = "https://pypi.org/simple"'), UNREADABLE_SOURCE],
    ["poetry.lock", "a key it does not know", poetryLock("", "[package.source]", 'type = "legacy"', 'url = "https://pypi.org/simple"', `index = "${EVIL_INDEX}"`), UNREADABLE_SOURCE],
    ["poetry.lock", "a type it does not know", poetryLock("", "[package.source]", 'type = "hg"', `url = "${EVIL_INDEX}"`), UNREADABLE_SOURCE],
    ["poetry.lock", "no url", poetryLock("", "[package.source]", 'type = "legacy"'), UNREADABLE_SOURCE],
    ["poetry.lock", "a source table given twice", poetryLock("", "[package.source]", 'type = "legacy"', `url = "${EVIL_INDEX}"`, "", "[package.source]", 'type = "legacy"', 'url = "https://pypi.org/simple"'), UNREADABLE_SOURCE],
    ["poetry.lock", "a table inside the source", poetryLock("", "[package.source]", 'type = "legacy"', 'url = "https://pypi.org/simple"', "", "[package.source.extra]", `url = "${EVIL_INDEX}"`), UNREADABLE_SOURCE],
    ["poetry.lock", "an sdist in a Poetry block", poetryLock('sdist = {url = "https://evil.example/a.tar.gz"}'), UNREADABLE_SOURCE],
    ["poetry.lock", "a source table after another table", `${poetryLock()}\n[package.source]\ntype = "legacy"\nurl = "${EVIL_INDEX}"\n`, POETRY_LAYOUT],
    ["poetry.lock", "a header with spaces around a dot", poetryLock("", "[package . source]", 'type = "legacy"', `url = "${EVIL_INDEX}"`), POETRY_LAYOUT],
  ];
  for (const [file, shape, text, reason] of shapes) {
    const read = readPackages([{ path: file, text }]);
    assert.deepEqual(read.couldNotRead, [{ file, reason }], shape);
    assert.ok(!read.packages.some((p) => p.name === "a"), shape);
    if (reason === UNREADABLE_SOURCE) assert.deepEqual(read.sourced.map((s) => s.kind), ["unreadable"], shape);
    assert.ok(!JSON.stringify(read).includes("evil"), shape);
  }
});

test("Python lockfiles: keys in another order read the same, since TOML gives order no meaning", () => {
  const text = ['version = 1', "", "[[package]]", `source = { registry = "https://mirror.example.com/simple" }`, 'version = "1.0.0"', 'name = "a"', ""].join("\n");
  assert.deepEqual(readPackages([{ path: "uv.lock", text }]).sourced, [pypiSourced("a", "1.0.0", "uv.lock", 6, "host", "https://mirror.example.com")]);
});

test("Python lockfiles built to make the reader backtrack or rescan are read quickly", () => {
  const long = uvLock(`source = { registry = "https://pypi.org/simple" }`, `sdist = { url = "https://files.pythonhosted.org/${"a".repeat(4000000)}.tar.gz" }`);
  assert.deepEqual(quickly(() => readPackages([{ path: "uv.lock", text: long }])).packages, [pypi("a", "1.0.0", "uv.lock", 5)]);
  quickly(() => readPackages([{ path: "uv.lock", text: `version = 1\nx = ${"[".repeat(200000)}\n` }]));
  quickly(() => readPackages([{ path: "poetry.lock", text: `[[package]]\nname = "${"\\\"".repeat(1000000)}"\n` }]));
  quickly(() => readPackages([{ path: "poetry.lock", text: "[[package]]\n".repeat(200000) }]));
});

test("poetry.lock: a block with no version and no source of its own is a source it could not read, kept with its name", () => {
  const text = '[[package]]\nname = "a"\nversion = "1.0.0"\n\n[[package]]\nname = "B_c"\n';
  assert.deepEqual(readPackages([{ path: "poetry.lock", text }]), {
    ...EMPTY,
    packages: [pypi("a", "1.0.0", "poetry.lock", 2)],
    couldNotRead: [{ file: "poetry.lock", reason: UNREADABLE_SOURCE }],
    sourced: [pypiSourced("b-c", null, "poetry.lock", 6, "unreadable", null)],
  });
});

test("uv.lock: a path or directory source is local only while it stays inside the project", () => {
  const inside = ['{ path = "dist/a-1.0.0.tar.gz" }', '{ directory = "packages/a" }', '{ directory = "packages/../a" }', '{ path = "." }'];
  for (const source of inside) assert.deepEqual(readPackages([{ path: "uv.lock", text: uvLock(`source = ${source}`) }]), EMPTY, source);
  const outside = ['{ path = "/home/someone/a-1.0.0.tar.gz" }', '{ directory = "../a" }', '{ directory = "packages/../../a" }', '{ path = "C:/a.whl" }', '{ directory = "~/a" }'];
  for (const source of outside) {
    assert.deepEqual(readPackages([{ path: "uv.lock", text: uvLock(`source = ${source}`) }]), {
      ...EMPTY,
      sourced: [pypiSourced("a", "1.0.0", "uv.lock", 5, "url", null, { text: "a path outside the project" })],
    }, source);
  }
});

test("uv.lock: a project block with group-requires-python and default-groups, as uv writes them, is the project", () => {
  const text = [
    "version = 1", 'requires-python = ">=3.10"', "",
    "[[package]]", 'name = "t"', 'version = "0.1.0"', 'source = { virtual = "." }', 'default-groups = ["dev"]', "",
    "[package.group-requires-python]", 'dev = ">=3.12"', 'docs = ">=3.11"', "",
    "[package.metadata]", "requires-dist = []", "",
  ].join("\n");
  assert.deepEqual(readPackages([{ path: "uv.lock", text }]), EMPTY);
});

test("uv.lock: every local path, a registry folder, an sdist or wheel path or a file: URL, is local only while it stays inside the project", () => {
  const outside = (...lines) => assert.deepEqual(readPackages([{ path: "uv.lock", text: uvLock(...lines) }]).sourced,
    [pypiSourced("a", "1.0.0", "uv.lock", 5, "url", null, { text: "a path outside the project" })], lines.join(" "));
  const registry = 'source = { registry = "https://pypi.org/simple" }';
  outside('source = { registry = "../wheels" }');
  outside('source = { registry = "/srv/wheels" }');
  outside(registry, 'sdist = { path = "../a-1.0.0.tar.gz" }');
  outside(registry, "wheels = [", '    { path = "/tmp/a-1.0.0-py3-none-any.whl" },', "]");
  outside(registry, 'sdist = { url = "file:///home/someone/a-1.0.0.tar.gz" }');
  outside(registry, "wheels = [", '    { url = "file:///tmp/a-1.0.0-py3-none-any.whl" },', "]");
  outside('source = { url = "file:///home/someone/a-1.0.0.tar.gz" }');
  outside('source = { registry = "wheels" }', 'sdist = { path = "../../a-1.0.0.tar.gz" }');
});

test("uv.lock: a package is judged by its first address that is not the registry; a path inside the project is no address, so the source decides", () => {
  const registry = 'source = { registry = "https://pypi.org/simple" }';
  const read = readPackages([{ path: "uv.lock", text: uvLock(registry, 'sdist = { path = "dist/a-1.0.0.tar.gz" }', "wheels = [", '    { path = "dist/a-1.0.0-py3-none-any.whl" },', "]") }]);
  assert.deepEqual(read, { ...EMPTY, packages: [pypi("a", "1.0.0", "uv.lock", 5)] });
  const mirror = readPackages([{ path: "uv.lock", text: uvLock('source = { registry = "https://mirror.example.com/simple" }', 'sdist = { path = "dist/a-1.0.0.tar.gz" }') }]);
  assert.deepEqual(mirror.sourced, [pypiSourced("a", "1.0.0", "uv.lock", 5, "host", "https://mirror.example.com")]);
});

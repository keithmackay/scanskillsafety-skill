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
      { file: "yarn.lock", reason: "no packages found in it" },
      { file: "a/pnpm-lock.yaml", reason: "no packages found in it" },
      { file: "b/package-lock.json", reason: "no packages found in it" },
      { file: "c/package-lock.json", reason: "no packages found in it" },
      { file: "poetry.lock", reason: "no packages found in it" },
      { file: "requirements.txt", reason: "no pinned versions in it" },
    ],
  });
});

test("a lockfile that truly lists no dependency is read as holding none", () => {
  const read = readPackages([
    { path: "package-lock.json", text: JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "t" }, "node_modules/w": { link: true, resolved: "w" } } }) },
    { path: "a/package-lock.json", text: JSON.stringify({ lockfileVersion: 1 }) },
    { path: "yarn.lock", text: "__metadata:\n  version: 8\n\n\"t@workspace:.\":\n  version: 0.0.0-use.local\n" },
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

test("yarn.lock: a second source line in one entry replaces the first entirely", () => {
  const berry = '__metadata:\n  version: 8\n\n"a@npm:^1":\n  version: 1.0.0\n  resolution: "a@https://files.example.com/a-1.0.0.tgz"\n  resolution: "a@npm:1.0.0"\n';
  assert.deepEqual(readPackages([{ path: "yarn.lock", text: berry }]), { ...EMPTY, packages: [npm("a", "1.0.0", "yarn.lock", 4)] });
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
    "    resolution: {commit: SECRETREF, repo: 'https://SECRET@github.com/u/r.git', type: git}",
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

test("pnpm-lock.yaml: resolution fields named like built-in object properties are plain names", () => {
  const read = pnpmRead("  a@1.0.0:", "    resolution: {__proto__: x, constructor: y, hasOwnProperty: z, integrity: sha512-x}");
  assert.deepEqual(read, { ...EMPTY, packages: [npm("a", "1.0.0", "pnpm-lock.yaml", 5)] });
});

test("a pnpm-lock.yaml with a resolution line millions of characters long is read quickly", () => {
  const long = `    resolution: {integrity: sha512-x, ${"'a, b: c, '".repeat(200000)}${", '".repeat(200000)}}`;
  const read = quickly(() => pnpmRead("  a@1.0.0:", long));
  assert.deepEqual(read.packages, [npm("a", "1.0.0", "pnpm-lock.yaml", 5)]);
});

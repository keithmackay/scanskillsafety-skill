"use strict";
// ABOUTME: Tests reading package.json and pyproject.toml for a target with no lockfile for that ecosystem: the names sent to OSV,
// ABOUTME: and every dependency from outside the registry with its line, in every shape the formats allow, failing closed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readPackages } = require("../../src/deep/lockfiles");

const EMPTY = { packages: [], namesOnly: [], couldNotRead: [], notChecked: [], sourced: [], notRecorded: [] };
const SHA1 = "3f2a9c1e5b7d4f6a8c0e2b4d6f8a0c2e4b6d8f0a";
const UNREADABLE_SOURCE = { reason: "a package source it could not read" };
const BUNDLED = { text: "a bundled package file the scan cannot read" };
const OUTSIDE = { text: "a path outside the project" };
const NAMED_INDEX = { text: "an index it cannot resolve" };
const EXEC = { text: "a script that produces the package" };
const readOne = (path, text) => readPackages([{ path, text }]);
const lines = (...rows) => rows.join("\n");
const named = (ecosystem, file) => (name) => ({ ecosystem, name, version: null, file, line: null });
const item = (ecosystem, file) => (name, line, kind, address, extra = {}) => ({ ecosystem, file, line, name, version: null, kind, address, ...extra });
const unreadable = (ecosystem, file) => (name, line) => ({ ecosystem, file, line, name, version: null, kind: "unreadable", address: null });
const config = (ecosystem, file) => (line, kind, address) => ({ ecosystem, file, line, from: "config", kind, address });
const quickly = (fn, ms = 5000) => {
  const start = Date.now();
  const value = fn();
  const took = Date.now() - start;
  assert.ok(took < ms, `took ${took} ms`);
  return value;
};
const hidden = (read, ...secrets) => {
  const json = JSON.stringify(read);
  for (const secret of secrets) assert.ok(!json.includes(secret), secret);
};

// package.json

test("package.json: each kind of dependency value, with the line of its value; the registry's names are sent to OSV", () => {
  const file = "app/package.json";
  const text = lines(
    "{",
    '  "name": "t",',
    '  "dependencies": {',
    '    "range": "^1.2.3",',
    '    "alias": "npm:real@^1",',
    `    "gitdep": "git+https://user:SECRET@github.com/u/r.git#${SHA1}",`,
    '    "short": "u/r#semver:^1",',
    '    "scp": "git@github.com:u/r.git",',
    '    "tarball": "https://files.example.com/TOKEN/p-1.0.0.tgz",',
    '    "plain": "http://files.example.com/p.tgz",',
    '    "deno": "jsr:@std/x",',
    '    "script": "exec:./make.js",',
    '    "cat": "catalog:",',
    '    "ws": "workspace:*",',
    '    "folder": "file:../lib",',
    '    "packed": "file:vendor/packed-1.0.0.tgz",',
    '    "far": "file:../../far-1.0.0.tgz",',
    '    "bare": "bare-1.0.0.tgz",',
    '    "nested": "libs/a/b"',
    "  }",
    "}",
  );
  const sourced = item("npm", file);
  const read = readOne(file, text);
  assert.deepEqual(read, {
    ...EMPTY,
    packages: [named("npm", file)("range"), named("npm", file)("real")],
    namesOnly: [file],
    sourced: [
      sourced("gitdep", 6, "git", "https://github.com/u/r.git", { commit: SHA1 }),
      sourced("short", 7, "git", "https://github.com/u/r"),
      sourced("scp", 8, "git", "git@github.com:u/r.git"),
      sourced("tarball", 9, "url", "https://files.example.com/p-1.0.0.tgz"),
      sourced("plain", 10, "http", "http://files.example.com"),
      sourced("deno", 11, "host", "https://npm.jsr.io"),
      sourced("script", 12, "url", null, EXEC),
      sourced("packed", 16, "bundled", "app/vendor/packed-1.0.0.tgz", BUNDLED),
      sourced("far", 17, "url", null, OUTSIDE),
      sourced("bare", 18, "bundled", "app/bare-1.0.0.tgz", BUNDLED),
    ],
  });
  hidden(read, "SECRET", "TOKEN", "user");
});

test("package.json: devDependencies, nested overrides, resolutions and pnpm.overrides are read for sources; a name overridden from elsewhere is not sent to OSV", () => {
  const text = lines(
    "{",
    '  "dependencies": {',
    '    "lodash": "^4.17.21",',
    '    "chalk": "^5.0.0",',
    '    "evil": "git+https://evil.example/evil.git"',
    "  },",
    '  "devDependencies": {',
    '    "tap": "^18.0.0",',
    '    "devgit": "github:u/devgit"',
    "  },",
    '  "overrides": {',
    '    "foo": {',
    '      ".": "https://mirror.example.com/foo-1.0.0.tgz",',
    '      "bar": "git+ssh://git@github.com/u/bar.git"',
    "    },",
    '    "lodash@4": "git+https://github.com/u/lodash.git",',
    '    "baz": "^1.0.0"',
    "  },",
    '  "resolutions": {',
    '    "**/@s/left-pad": "https://mirror.example.com/left-pad-1.3.0.tgz"',
    "  },",
    '  "pnpm": {',
    '    "overrides": {',
    '      "qux@<2>quux": "gitlab:g/quux"',
    "    }",
    "  }",
    "}",
  );
  const sourced = item("npm", "package.json");
  assert.deepEqual(readOne("package.json", text), {
    ...EMPTY,
    packages: [named("npm", "package.json")("chalk")],
    namesOnly: ["package.json"],
    sourced: [
      sourced("evil", 5, "git", "https://evil.example/evil.git"),
      sourced("devgit", 9, "git", "https://github.com/u/devgit"),
      sourced("foo", 13, "url", "https://mirror.example.com/foo-1.0.0.tgz"),
      sourced("bar", 14, "git", "ssh://github.com/u/bar.git"),
      sourced("lodash", 16, "git", "https://github.com/u/lodash.git"),
      sourced("@s/left-pad", 20, "url", "https://mirror.example.com/left-pad-1.3.0.tgz"),
      sourced("quux", 24, "git", "https://gitlab.com/g/quux"),
    ],
  });
});

test("package.json: a key given twice is read as JSON.parse reads it, the last one, with that one's line; prototype and integer keys are plain names", () => {
  const text = lines(
    "{",
    '  "dependencies": {',
    '    "a": "git+https://e.example/a.git",',
    '    "b": "^1",',
    '    "a": "^2",',
    '    "__proto__": "git+https://e.example/p.git",',
    '    "7": "git+https://e.example/seven.git",',
    '    "constructor": "^1"',
    "  },",
    '  "devDependencies": { "c": "^1" },',
    '  "devDependencies": { "c": "git+https://e.example/c.git" }',
    "}",
  );
  const sourced = item("npm", "package.json");
  const name = named("npm", "package.json");
  assert.deepEqual(readOne("package.json", text), {
    ...EMPTY,
    packages: [name("a"), name("b"), name("constructor")],
    namesOnly: ["package.json"],
    sourced: [
      sourced("7", 7, "git", "https://e.example/seven.git"),
      sourced("__proto__", 6, "git", "https://e.example/p.git"),
      sourced("c", 11, "git", "https://e.example/c.git"),
    ],
  });
});

test("package.json: a value or section in a shape npm does not take is a source it could not read, never the registry or left out", () => {
  const text = lines(
    "{",
    '  "dependencies": {',
    '    "a": 1,',
    '    "b": { "c": "git+https://e.example/c.git" },',
    '    "d": null,',
    '    "e": ["git+https://e.example/e.git"]',
    "  },",
    '  "peerDependencies": ["git+https://e.example/p.git"],',
    '  "optionalDependencies": "git+https://e.example/o.git",',
    '  "overrides": { "f": 2, "g": { "h": [] } },',
    '  "pnpm": { "overrides": "x" }',
    "}",
  );
  const bad = unreadable("npm", "package.json");
  assert.deepEqual(readOne("package.json", text), {
    ...EMPTY,
    couldNotRead: [{ file: "package.json", ...UNREADABLE_SOURCE }],
    sourced: [bad("a", 3), bad("b", 4), bad("d", 5), bad("e", 6), bad(null, 8), bad(null, 9), bad("f", 10), bad("h", 10), bad(null, 11)],
  });
});

test("package.json: always read for its sources, beside a lockfile or not; its names the lockfile does not hold go to OSV", () => {
  const evil = { path: "package.json", text: JSON.stringify({ dependencies: { evil: "git+https://evil.example/evil.git", chalk: "^5.0.0" } }) };
  const reported = [item("npm", "package.json")("evil", 1, "git", "https://evil.example/evil.git")];
  const yarnLock = '# yarn lockfile v1\n\nleft-pad@^1.3.0:\n  version "1.3.0"\n  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"\n';
  const beside = readPackages([evil, { path: "yarn.lock", text: yarnLock }]);
  assert.deepEqual(beside.sourced, reported);
  assert.deepEqual(beside.namesOnly, ["package.json"]);
  assert.deepEqual(beside.packages.map((p) => p.name), ["left-pad", "chalk"]);
  for (const lockPath of ["sub/yarn.lock", "docs/demo/package-lock.json"]) {
    const decoy = lockPath.endsWith(".lock") ? yarnLock : JSON.stringify({ lockfileVersion: 3, packages: { "": {} } });
    const read = readPackages([evil, { path: lockPath, text: decoy }]);
    assert.deepEqual(read.sourced, reported, lockPath);
    assert.deepEqual(read.namesOnly, ["package.json"], lockPath);
  }
  const unread = readPackages([evil, { path: "package-lock.json", text: "{" }]);
  assert.deepEqual([unread.sourced, unread.namesOnly], [reported, ["package.json"]]);
});

// A read lockfile's workspace folders: their manifests are covered by it, as one beside it is.
const EVIL_DEPENDENCY = JSON.stringify({ dependencies: { evil: "git+https://evil.example/evil.git" } });
const EVIL_PYPROJECT = '[tool.uv.sources]\nx = { git = "https://e.example/x" }\n';
const WORKSPACE_LOCKS = [
  ["package-lock.json", JSON.stringify({
    lockfileVersion: 3,
    packages: { "": { name: "root" }, "packages/a": { name: "a" }, "node_modules/a": { resolved: "packages/a", link: true }, "../outside": { name: "o" } },
  }, null, 2)],
  ["pnpm-lock.yaml", "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\n  packages/a: {}\n\n  ../outside: {}\n"],
  ["yarn.lock", '__metadata:\n  version: 8\n  cacheKey: 10\n\n"root@workspace:.":\n  version: 0.0.0-use.local\n  resolution: "root@workspace:."\n  languageName: unknown\n  linkType: soft\n\n"a@workspace:packages/a":\n  version: 0.0.0-use.local\n  resolution: "a@workspace:packages/a"\n  languageName: unknown\n  linkType: soft\n'],
];

test("package.json: a workspace folder below a read lockfile (npm package keys, pnpm importers, Yarn Berry workspace: resolutions): every manifest is still read for sources", () => {
  for (const [lockPath, lockText] of WORKSPACE_LOCKS) {
    const read = readPackages([
      { path: lockPath, text: lockText },
      { path: "packages/a/package.json", text: EVIL_DEPENDENCY },
      { path: "packages/b/package.json", text: EVIL_DEPENDENCY },
    ]);
    assert.deepEqual(read.sourced.filter((i) => i.file.endsWith("package.json")), [
      item("npm", "packages/a/package.json")("evil", 1, "git", "https://evil.example/evil.git"),
      item("npm", "packages/b/package.json")("evil", 1, "git", "https://evil.example/evil.git"),
    ], lockPath);
    assert.deepEqual(read.namesOnly, [], lockPath);
    const leftOut = [{ path: "packages/a/package.json", reason: "larger than 5 MB" }, { path: "packages/b/package.json", reason: "larger than 5 MB" }];
    assert.deepEqual(readPackages([{ path: lockPath, text: lockText }], leftOut).couldNotRead.map((c) => c.file), ["packages/a/package.json", "packages/b/package.json"], lockPath);
  }
});

test("package.json: a lockfile in a subfolder lists workspace folders from its own folder; every manifest is read for sources", () => {
  const [, lockText] = WORKSPACE_LOCKS[0];
  const read = readPackages([{ path: "app/package-lock.json", text: lockText }, { path: "app/packages/a/package.json", text: EVIL_DEPENDENCY }, { path: "packages/a/package.json", text: EVIL_DEPENDENCY }]);
  assert.deepEqual(read.sourced.filter((i) => i.file.endsWith("package.json")).map((i) => i.file), ["app/packages/a/package.json", "packages/a/package.json"]);
});

test("pyproject.toml: with a uv.lock listing editable or virtual members, every pyproject.toml is still read for sources", () => {
  const uvLock = 'version = 1\n\n[[package]]\nname = "root"\nversion = "0.1.0"\nsource = { virtual = "." }\n\n[[package]]\nname = "a"\nversion = "0.1.0"\nsource = { editable = "packages/a" }\n';
  const read = readPackages([
    { path: "uv.lock", text: uvLock },
    { path: "packages/a/pyproject.toml", text: EVIL_PYPROJECT },
    { path: "packages/b/pyproject.toml", text: EVIL_PYPROJECT },
  ]);
  assert.deepEqual(read.sourced, [
    item("PyPI", "packages/a/pyproject.toml")("x", 2, "git", "https://e.example/x"),
    item("PyPI", "packages/b/pyproject.toml")("x", 2, "git", "https://e.example/x"),
  ]);
  assert.deepEqual(read.namesOnly, []);
});

// A lockfile that names a folder at or above its own as a workspace (a decoy in a subfolder, or a key climbing back) hides no
// manifest: every one is read for its sources.
const ROOT_EVIL = JSON.stringify({ dependencies: { evil: "git+https://evil.example/x.git" } });
const npmLockListing = (keys) => {
  const packages = { "": {} };
  for (const key of keys) packages[key] = { name: "w", version: "1.0.0" };
  return JSON.stringify({ lockfileVersion: 3, packages }, null, 2);
};
const berryLockListing = (ws) => `__metadata:\n  version: 8\n  cacheKey: 10\n\n"w@workspace:${ws}":\n  version: 0.0.0-use.local\n  resolution: "w@workspace:${ws}"\n  languageName: unknown\n  linkType: soft\n`;

test("a workspace key climbing to or above its lockfile's folder hides no manifest: each is read for sources", () => {
  const cases = [
    ...[["docs/demo", "../.."], ["docs/demo", "../../"], ["docs/demo", "../../."], ["docs", ".."], ["docs", "../"], ["docs", "x/../.."], ["docs", "./.."], ["docs", ".//.."], ["docs", "../packages/a"]]
      .map(([dir, key]) => [`${dir}/package-lock.json`, npmLockListing([key])]),
    ...[".", "./", "packages/../"].map((key) => ["package-lock.json", npmLockListing([key])]),
    ...["../..", "'../..'", "..", "../../"].map((importer) => ["docs/demo/pnpm-lock.yaml", `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\n  ${importer}: {}\n`]),
    ...["../..", "../../", "."].map((ws) => ["docs/demo/yarn.lock", berryLockListing(ws)]),
  ];
  for (const [lockPath, lockText] of cases) {
    const read = readPackages([{ path: lockPath, text: lockText }, { path: "package.json", text: ROOT_EVIL }, { path: "packages/a/package.json", text: ROOT_EVIL }]);
    const label = `${lockPath} ${lockText.slice(-40)}`;
    assert.deepEqual(read.sourced.filter((i) => i.file.endsWith("package.json")).map((i) => `${i.file} ${i.name}`), ["package.json evil", "packages/a/package.json evil"], label);
    assert.deepEqual(read.namesOnly, [], label);
  }
});

test("a root lockfile listing a folder as a workspace hides nothing of that folder's manifest from the sources read", () => {
  const read = readPackages([{ path: "package-lock.json", text: npmLockListing(["evil"]) }, { path: "package.json", text: "{}" }, { path: "evil/package.json", text: ROOT_EVIL }]);
  assert.deepEqual(read.sourced.map((i) => `${i.file} ${i.name}`), ["evil/package.json evil"]);
  assert.deepEqual(read.namesOnly, []);
});

test("pyproject.toml: a uv.lock in a subfolder whose editable member climbs to or above its folder hides no pyproject.toml", () => {
  const pyproject = '[project]\nname = "t"\ndependencies = ["evil @ git+https://evil.example/x.git"]\n';
  for (const member of ["../..", "../../", "."]) {
    const uvLock = `version = 1\nrequires-python = ">=3.8"\n\n[[package]]\nname = "w"\nversion = "0.1.0"\nsource = { editable = "${member}" }\n`;
    const read = readPackages([{ path: "docs/demo/uv.lock", text: uvLock }, { path: "pyproject.toml", text: pyproject }]);
    assert.deepEqual(read.sourced.map((i) => `${i.file} ${i.name} ${i.kind}`), ["pyproject.toml evil git"], member);
    assert.deepEqual(read.namesOnly, [], member);
  }
});

// Which manifest names go to OSV: all of them, but for those a covering lockfile or a requirements file beside it already sent
// with a version.
const sentNames = (read) => read.packages.map((p) => `${p.file} ${p.name}@${p.version ?? "*"}`);
const FLATMAP = JSON.stringify({ name: "t", dependencies: { "flatmap-stream": "0.1.1", chalk: "^5.0.0" } });
const flatmapLock = (extra = {}) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...extra } }, null, 2);

test("package.json: a name is kept from OSV only when a covering lockfile holds it; an out-of-sync or claiming lockfile keeps nothing else", () => {
  const cases = [
    ["no lockfile", [["package.json", FLATMAP]], ["package.json flatmap-stream@0.1.1", "package.json chalk@*"], ["package.json"]],
    ["a lockfile beside it that omits them", [["package.json", FLATMAP], ["package-lock.json", flatmapLock()]], ["package.json flatmap-stream@0.1.1", "package.json chalk@*"], ["package.json"]],
    ["a lockfile beside it with one of them", [["package.json", FLATMAP], ["package-lock.json", flatmapLock({ "node_modules/flatmap-stream": { version: "0.1.1" } })]],
      ["package-lock.json flatmap-stream@0.1.1", "package.json chalk@*"], ["package.json"]],
    ["a lockfile beside it with both", [["package.json", FLATMAP], ["package-lock.json", flatmapLock({ "node_modules/flatmap-stream": { version: "0.1.1" }, "node_modules/chalk": { version: "5.0.0" } })]],
      ["package-lock.json flatmap-stream@0.1.1", "package-lock.json chalk@5.0.0"], []],
    ["a plugin with no lockfile", [["plugins/x/package.json", FLATMAP]], ["plugins/x/package.json flatmap-stream@0.1.1", "plugins/x/package.json chalk@*"], ["plugins/x/package.json"]],
    ["an npm lockfile claiming the plugin as a workspace", [["package.json", "{}"], ["package-lock.json", flatmapLock({ "plugins/x": { name: "x" } })], ["plugins/x/package.json", FLATMAP]],
      ["plugins/x/package.json flatmap-stream@0.1.1", "plugins/x/package.json chalk@*"], ["plugins/x/package.json"]],
    ["a pnpm lockfile claiming it", [["pnpm-lock.yaml", "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\n  plugins/x: {}\n"], ["plugins/x/package.json", FLATMAP]],
      ["plugins/x/package.json flatmap-stream@0.1.1", "plugins/x/package.json chalk@*"], ["plugins/x/package.json"]],
    ["a Berry lockfile claiming it", [["yarn.lock", berryLockListing("plugins/x")], ["plugins/x/package.json", FLATMAP]],
      ["plugins/x/package.json flatmap-stream@0.1.1", "plugins/x/package.json chalk@*"], ["plugins/x/package.json"]],
    ["a lockfile listing the workspace with one of its packages", [["package-lock.json", flatmapLock({ "plugins/x": { name: "x" }, "node_modules/chalk": { version: "5.0.0" } })], ["plugins/x/package.json", FLATMAP]],
      ["package-lock.json chalk@5.0.0", "plugins/x/package.json flatmap-stream@0.1.1"], ["plugins/x/package.json"]],
  ];
  for (const [label, files, sent, namesOnly] of cases) {
    const read = readPackages(files.map(([path, text]) => ({ path, text })));
    assert.deepEqual([sentNames(read), read.namesOnly], [sent, namesOnly], label);
  }
});

test("pyproject.toml: a name is kept from OSV only when a requirements file in its folder pins it, or a covering lockfile sent it; one elsewhere, unpinned or left out keeps nothing", () => {
  const py = '[project]\nname = "t"\ndependencies = ["requests==2.0.0", "idna"]\n';
  const uvMember = 'version = 1\nrequires-python = ">=3.8"\n\n[[package]]\nname = "w"\nversion = "0.1.0"\nsource = { editable = "plugins/x" }\n';
  const both = ["pyproject.toml requests@2.0.0", "pyproject.toml idna@*"];
  const cases = [
    ["pyproject.toml alone", [["pyproject.toml", py]], [], both, ["pyproject.toml"]],
    ["a pinned requirements file elsewhere", [["pyproject.toml", py], ["docs/requirements.txt", "six==1.0.0\n"]], [], ["docs/requirements.txt six@1.0.0", ...both], ["pyproject.toml"]],
    ["an unpinned requirements file elsewhere", [["pyproject.toml", py], ["docs/requirements.txt", "six\n"]], [], both, ["pyproject.toml"]],
    ["a left-out requirements file elsewhere", [["pyproject.toml", py]], [{ path: "docs/requirements.txt", reason: "binary" }], both, ["pyproject.toml"]],
    ["a requirements file beside it pinning one", [["pyproject.toml", py], ["requirements.txt", "requests==2.0.0\n"]], [], ["requirements.txt requests@2.0.0", "pyproject.toml idna@*"], ["pyproject.toml"]],
    ["a requirements file beside it pinning both", [["pyproject.toml", py], ["requirements.txt", "requests==2.0.0\nidna==3.10\n"]], [], ["requirements.txt requests@2.0.0", "requirements.txt idna@3.10"], []],
    ["a requirements file beside it with ranges only", [["pyproject.toml", py], ["requirements.txt", "requests>=2\n"]], [], both, ["pyproject.toml"]],
    ["a uv.lock claiming a plugin as an editable member", [["uv.lock", uvMember], ["plugins/x/pyproject.toml", py]], [], ["plugins/x/pyproject.toml requests@2.0.0", "plugins/x/pyproject.toml idna@*"], ["plugins/x/pyproject.toml"]],
  ];
  for (const [label, files, leftOut, sent, namesOnly] of cases) {
    const read = readPackages(files.map(([path, text]) => ({ path, text })), leftOut);
    assert.deepEqual([sentNames(read), read.namesOnly], [sent, namesOnly], label);
  }
});

test("an exact pin in a manifest is sent with its version unless a covering file sent that same version; a range is covered by name", () => {
  const exact = JSON.stringify({ name: "t", dependencies: { "flatmap-stream": "0.1.1" } });
  const ranged = JSON.stringify({ name: "t", dependencies: { "flatmap-stream": "^0.1.0" } });
  const npmLockWith = (version, host = "registry.npmjs.org", extra = {}) => flatmapLock({
    "node_modules/flatmap-stream": { version, resolved: `https://${host}/flatmap-stream/-/flatmap-stream-${version}.tgz` }, ...extra,
  });
  const pyproject = (requirement) => `[project]\nname = "t"\ndependencies = ["${requirement}"]\n`;
  const cases = [
    ["no lockfile: the exact pin with its version", [["package.json", exact]], ["package.json flatmap-stream@0.1.1"], ["package.json"]],
    ["a lockfile beside it with that version", [["package.json", exact], ["package-lock.json", npmLockWith("0.1.1")]], ["package-lock.json flatmap-stream@0.1.1"], []],
    ["a lockfile beside it with another version", [["package.json", exact], ["package-lock.json", npmLockWith("1.0.0")]],
      ["package-lock.json flatmap-stream@1.0.0", "package.json flatmap-stream@0.1.1"], ["package.json"]],
    ["a root lockfile claiming the folder, with another version", [["package-lock.json", npmLockWith("1.0.0", undefined, { "plugins/x": { name: "x" } })], ["plugins/x/package.json", exact]],
      ["package-lock.json flatmap-stream@1.0.0", "plugins/x/package.json flatmap-stream@0.1.1"], ["plugins/x/package.json"]],
    ["a range, the lockfile holding another version", [["package.json", ranged], ["package-lock.json", npmLockWith("1.0.0")]], ["package-lock.json flatmap-stream@1.0.0"], []],
    ["a range the lockfile resolves from a mirror", [["package.json", ranged], ["package-lock.json", npmLockWith("0.1.1", "registry.npmmirror.com")]], [], []],
    ["an exact pin the lockfile resolves from a mirror", [["package.json", exact], ["package-lock.json", npmLockWith("0.1.1", "registry.npmmirror.com")]], [], []],
    ["pyproject.toml ==, a requirements file -r'd into its folder pinning another version",
      [["requirements.txt", "-r docs/c.txt\n"], ["docs/c.txt", "flatmap-stream==1.0.0\n"], ["docs/pyproject.toml", pyproject("flatmap-stream==0.1.1")]],
      ["docs/c.txt flatmap-stream@1.0.0", "docs/pyproject.toml flatmap-stream@0.1.1"], ["docs/pyproject.toml"]],
    ["pyproject.toml ==, the requirements file beside it pinning the same version", [["pyproject.toml", pyproject("Flatmap_Stream==0.1.1")], ["requirements.txt", "flatmap-stream==0.1.1\n"]],
      ["requirements.txt flatmap-stream@0.1.1"], []],
    ["pyproject.toml == with a wildcard is a range", [["pyproject.toml", pyproject("flatmap-stream==0.*")], ["requirements.txt", "flatmap-stream==1.0.0\n"]],
      ["requirements.txt flatmap-stream@1.0.0"], []],
  ];
  for (const [label, files, sent, namesOnly] of cases) {
    const read = readPackages(files.map(([path, text]) => ({ path, text })));
    assert.deepEqual([sentNames(read), read.namesOnly], [sent, namesOnly], label);
  }
});

test("an exact pin written another way is still a pin: npm's leading = or v and spaces, a PyPI specifier set with one ==", () => {
  const npmLock = flatmapLock({ "node_modules/flatmap-stream": { version: "1.0.0" } });
  for (const value of ["=0.1.1", "v0.1.1", "=v0.1.1", " 0.1.1", "0.1.1 "]) {
    const read = readPackages([{ path: "package.json", text: JSON.stringify({ dependencies: { "flatmap-stream": value } }) }, { path: "package-lock.json", text: npmLock }]);
    assert.deepEqual(sentNames(read), ["package-lock.json flatmap-stream@1.0.0", "package.json flatmap-stream@0.1.1"], JSON.stringify(value));
  }
  for (const requirement of ["flatmap-stream==0.1.1,<2", "flatmap-stream<2,==0.1.1"]) {
    const read = readPackages([
      { path: "pyproject.toml", text: `[project]\ndependencies = ["${requirement}"]\n` },
      { path: "requirements.txt", text: "flatmap-stream==1.0.0\n" },
    ]);
    assert.deepEqual(sentNames(read), ["requirements.txt flatmap-stream@1.0.0", "pyproject.toml flatmap-stream@0.1.1"], requirement);
  }
});

test("an npm alias to an exact version pins the aliased package; a range of exact versions is still a range", () => {
  const npmLock = flatmapLock({ "node_modules/flatmap-stream": { version: "1.0.0" }, "node_modules/@s/x": { version: "1.2.3" } });
  const cases = [
    [{ y: "npm:flatmap-stream@0.1.1" }, ["package.json flatmap-stream@0.1.1"]],
    [{ y: "npm:flatmap-stream@=v0.1.1" }, ["package.json flatmap-stream@0.1.1"]],
    [{ y: "npm:flatmap-stream@1.0.0" }, []],
    [{ y: "npm:@s/x@=v1.2.3" }, []],
    [{ y: "npm:@s/x@1.2.4" }, ["package.json @s/x@1.2.4"]],
    [{ y: "npm:flatmap-stream@^0.1.0" }, []],
    [{ "flatmap-stream": "0.1.1 || 0.1.1" }, []],
  ];
  for (const [dependencies, alsoSent] of cases) {
    const read = readPackages([{ path: "package.json", text: JSON.stringify({ dependencies }) }, { path: "package-lock.json", text: npmLock }]);
    assert.deepEqual(sentNames(read).slice(2), alsoSent, JSON.stringify(dependencies));
  }
});

test("PyPI versions are compared and sent in PEP 440's normal form, trailing zero release numbers not counting", () => {
  const cases = [
    ["==0.1.1.0", "flatmap-stream==0.1.1", []],
    ["==0.1.1", "flatmap-stream==0.1.1.0", []],
    ["==v0.1.1", "flatmap-stream==1.0.0", ["pyproject.toml flatmap-stream@0.1.1"]],
    ["==1.0RC1", "flatmap-stream==1.0.0", ["pyproject.toml flatmap-stream@1.0rc1"]],
    ["==1.0-alpha.2", "flatmap-stream==1.0a2", []],
    ["==01.002.0post", "flatmap-stream==1.2.post0", []],
    ["==1.0-1", "flatmap-stream==1.0.post1", []],
    ["==1.0.DEV", "flatmap-stream==1.0.0", ["pyproject.toml flatmap-stream@1.0.dev0"]],
    ["==0!1.0+Ubuntu-1", "flatmap-stream==1.0.0", ["pyproject.toml flatmap-stream@1.0+ubuntu.1"]],
  ];
  for (const [pin, requirement, alsoSent] of cases) {
    const read = readPackages([
      { path: "pyproject.toml", text: `[project]\ndependencies = ["flatmap-stream${pin}"]\n` },
      { path: "requirements.txt", text: `${requirement}\n` },
    ]);
    assert.deepEqual(sentNames(read).slice(1), alsoSent, pin);
  }
  const sent = readPackages([{ path: "requirements.txt", text: "Flatmap_Stream==V1.0RC1\n" }]);
  assert.deepEqual(sentNames(sent), ["requirements.txt flatmap-stream@1.0rc1"]);
});

test("package.json: Windows line endings give the same lines", () => {
  const text = '{\r\n  "dependencies": {\r\n    "a": "^1",\r\n    "b": "github:u/b"\r\n  }\r\n}\r\n';
  assert.deepEqual(readOne("package.json", text).sourced, [item("npm", "package.json")("b", 4, "git", "https://github.com/u/b")]);
});

test("package.json: overrides nested 20,000 levels deep, and 100,000 dependencies, are read quickly without running out of stack", () => {
  const deep = `{"overrides":${'{"a":'.repeat(20000)}"git+https://e.example/x.git"${"}".repeat(20000)}}`;
  const read = quickly(() => readOne("package.json", deep));
  assert.deepEqual(read.sourced, [item("npm", "package.json")("a", 1, "git", "https://e.example/x.git")]);
  const wide = `{"dependencies":{\n${Array.from({ length: 100000 }, (_, i) => `"p${i}":"${i % 2 ? "^1" : "github:u/p"}"`).join(",\n")}}}`;
  const many = quickly(() => readOne("package.json", wide));
  assert.equal(many.packages.length, 50000);
  assert.equal(many.sourced.length, 50000);
  assert.deepEqual(many.sourced[1], item("npm", "package.json")("p2", 4, "git", "https://github.com/u/p"));
});

// pyproject.toml

test("pyproject.toml: PEP 508 requirements, uv sources resolved through [[tool.uv.index]], each with the line its value is on", () => {
  const text = lines(
    "[project]",
    'name = "t"',
    "dependencies = [",
    "    \"requests[socks] >= 2.31 ; python_version >= '3.8'\",",
    `    "left-pad @ git+https://user:SECRET@github.com/u/left-pad.git@${SHA1} ; sys_platform == 'linux'",`,
    '    "  Spaced_Name [extra1, extra2]  @  https://files.example.com/TOKEN/spaced-1.0-py3-none-any.whl  ",',
    '    "official @ https://files.pythonhosted.org/packages/ab/official-1.0.tar.gz",',
    '    "outside @ file:///opt/outside",',
    '    "bundled @ ./dist/bundled-1.0-py3-none-any.whl",',
    '    "uvgit",',
    '    "uvmirror>=1",',
    '    "uvlocal",',
    "]",
    "",
    "[project.optional-dependencies]",
    'docs = ["sphinx>=7", "theme @ https://files.example.com/theme-1.0.tar.gz"]',
    "",
    "[dependency-groups]",
    "dev = [",
    '    "pytest>=8",',
    '    { include-group = "docs-tools" },',
    '    "devtool @ git+https://github.com/u/devtool",',
    "]",
    'docs-tools = ["mkdocs"]',
    "",
    "[tool.uv.sources]",
    `uvgit = { git = "https://github.com/u/uvgit", rev = "${SHA1}" }`,
    'uvmirror = { index = "mirror" }',
    'uvlocal = { path = "libs/uvlocal", editable = true }',
    'official-idx = { index = "pypi" }',
    'unknown-idx = { index = "nowhere" }',
    'wheel = { path = "dist/wheel-1.0-py3-none-any.whl" }',
    'far = { path = "../../far" }',
    "member = { workspace = true }",
    'direct = { url = "https://files.example.com/direct-1.0.tar.gz" }',
    "split = [",
    "    { git = \"https://github.com/u/split\", marker = \"sys_platform == 'linux'\" },",
    "    { index = \"mirror\", marker = \"sys_platform == 'darwin'\" },",
    "]",
    "",
    "[[tool.uv.index]]",
    'name = "mirror"',
    'url = "https://mirror.example.com/TOKEN/simple"',
    "",
    "[[tool.uv.index]]",
    'name = "pypi"',
    'url = "https://pypi.org/simple"',
  );
  const file = "pyproject.toml";
  const sourced = item("PyPI", file);
  const read = readOne(file, text);
  assert.deepEqual(read, {
    ...EMPTY,
    packages: [named("PyPI", file)("requests"), named("PyPI", file)("official")],
    namesOnly: [file],
    sourced: [
      sourced("left-pad", 5, "git", "https://github.com/u/left-pad.git", { commit: SHA1 }),
      sourced("spaced-name", 6, "url", "https://files.example.com/spaced-1.0-py3-none-any.whl"),
      sourced("outside", 8, "url", null, OUTSIDE),
      sourced("bundled", 9, "bundled", "dist/bundled-1.0-py3-none-any.whl", BUNDLED),
      sourced("theme", 16, "url", "https://files.example.com/theme-1.0.tar.gz"),
      sourced("devtool", 22, "git", "https://github.com/u/devtool"),
      sourced("uvgit", 27, "git", "https://github.com/u/uvgit", { commit: SHA1 }),
      sourced("uvmirror", 28, "host", "https://mirror.example.com"),
      sourced("unknown-idx", 31, "host", null, NAMED_INDEX),
      sourced("wheel", 32, "bundled", "dist/wheel-1.0-py3-none-any.whl", BUNDLED),
      sourced("far", 33, "url", null, OUTSIDE),
      sourced("direct", 35, "url", "https://files.example.com/direct-1.0.tar.gz"),
      sourced("split", 37, "git", "https://github.com/u/split"),
      sourced("split", 38, "host", "https://mirror.example.com"),
      config("PyPI", file)(43, "host", "https://mirror.example.com"),
    ],
  });
  hidden(read, "SECRET", "TOKEN", "user");
});

test("pyproject.toml: Poetry dependency tables with git, url, path and source, in groups and in table form; python is no dependency", () => {
  const text = lines(
    "[tool.poetry.dependencies]",
    'python = "^3.10"',
    'httpx = "^0.27"',
    `pgit = { git = "git@github.com:u/pgit.git", rev = "${SHA1}" }`,
    'purl = { url = "https://files.example.com/purl-1.0.tar.gz" }',
    'ppath = { path = "../outside", develop = true }',
    'pmirror = { version = "^1", source = "mirror" }',
    'ppypi = { version = "^1", source = "pypi" }',
    "multi = [",
    '    { version = "^1", python = "<3.11" },',
    '    { git = "https://github.com/u/multi", python = ">=3.11" },',
    "]",
    'dotted.git = "https://github.com/u/dotted"',
    "",
    "[tool.poetry.dependencies.tabled]",
    'url = "https://files.example.com/tabled-1.0.zip"',
    "",
    "[tool.poetry.group.dev.dependencies]",
    'pytest = "^8"',
    'gdev = { git = "https://github.com/u/gdev", branch = "main" }',
    "",
    "[tool.poetry.dev-dependencies]",
    'olddev = { path = "dist/olddev-1.0.tar.gz" }',
    "",
    "[[tool.poetry.source]]",
    'name = "mirror"',
    'url = "https://mirror.example.com/simple/"',
    'priority = "supplemental"',
  );
  const file = "pyproject.toml";
  const sourced = item("PyPI", file);
  assert.deepEqual(readOne(file, text), {
    ...EMPTY,
    packages: [named("PyPI", file)("httpx"), named("PyPI", file)("ppypi")],
    namesOnly: [file],
    sourced: [
      sourced("pgit", 4, "git", "git@github.com:u/pgit.git", { commit: SHA1 }),
      sourced("purl", 5, "url", "https://files.example.com/purl-1.0.tar.gz"),
      sourced("ppath", 6, "url", null, OUTSIDE),
      sourced("pmirror", 7, "host", "https://mirror.example.com"),
      sourced("multi", 11, "git", "https://github.com/u/multi"),
      sourced("dotted", 13, "git", "https://github.com/u/dotted"),
      sourced("tabled", 16, "url", "https://files.example.com/tabled-1.0.zip"),
      sourced("gdev", 20, "git", "https://github.com/u/gdev"),
      sourced("olddev", 23, "bundled", "dist/olddev-1.0.tar.gz", BUNDLED),
      config("PyPI", file)(27, "host", "https://mirror.example.com"),
    ],
  });
});

test("pyproject.toml: an index named in [tool.uv.sources] whose [[tool.uv.index]] is official gives nothing; a flat index is a find-links page", () => {
  const text = lines(
    "[project]",
    'dependencies = ["torch", "local-wheels"]',
    "[tool.uv.sources]",
    'torch = { index = "official" }',
    'local-wheels = { index = "flat" }',
    "[[tool.uv.index]]",
    'name = "official"',
    'url = "https://pypi.org/simple/"',
    "[[tool.uv.index]]",
    'name = "flat"',
    'url = "https://pypi.org/simple/"',
    'format = "flat"',
  );
  const read = readOne("pyproject.toml", text);
  assert.deepEqual(read.packages, [named("PyPI", "pyproject.toml")("torch")]);
  assert.deepEqual(read.sourced, [
    item("PyPI", "pyproject.toml")("local-wheels", 5, "host", "https://pypi.org"),
    config("PyPI", "pyproject.toml")(11, "host", "https://pypi.org"),
  ]);
});

test("pyproject.toml: shapes the TOML spec allows read as TOML reads them, in the sections that name sources and outside them", () => {
  const cases = [
    // A quoted, escaped or dotted key; a header with spaces and quoted parts; a literal string; dotted and inline tables from the root.
    ['[tool.uv.sources]\n"re\\u0071" = { git = "https://e.example/req" }\n', [["req", 2, "git"]]],
    ['[ tool . "uv" . sources ]\nx = { "git" = \'https://e.example/x\' }\n', [["x", 2, "git"]]],
    ["project.dependencies = ['y @ https://e.example/y-1.0.tar.gz']\n", [["y", 1, "url"]]],
    ['tool = { uv = { sources = { z = { git = "https://e.example/z" } } } }\n', [["z", 1, "git"]]],
    // Indentation, tabs, comments, a trailing comma, a multi-line array laid out by hand.
    ['  [tool.poetry.dependencies]\n  w\t=\t{ url = "https://e.example/w-1.0.zip" }  # pinned\n', [["w", 2, "url"]]],
    ['[project]\ndependencies = [ # list\n\n  "v @ https://e.example/v-1.0.zip" , # v\n\t]\n', [["v", 4, "url"]]],
    // Multi-line strings, a date-time with a space and a quoted header elsewhere, none of which changes the table a line is in.
    ['[tool.x]\nnote = """\n[project]\ndependencies = ["n @ https://e.example/n.zip"]\n"""\nraw = \'\'\'\n[tool.uv.sources]\n\'\'\'\nwhen = 1979-05-27 07:32:00Z\n[tool."x.y"]\na = 1\n[project]\ndependencies = ["m @ https://e.example/m-1.0.zip"]\n', [["m", 13, "url"]]],
  ];
  for (const [text, expected] of cases) {
    const read = readOne("pyproject.toml", text);
    assert.deepEqual(read.couldNotRead, [], text);
    assert.deepEqual(read.sourced.map((s) => [s.name, s.line, s.kind]), expected, text);
  }
});

test("pyproject.toml: a shape it does not read where a source can be named is a source it could not read, never the registry or left out", () => {
  const cases = [
    ['[project]\ndependencies = "requests"\n', null],
    ["[project]\ndependencies = [1]\n", null],
    ['[project]\ndependencies = [{ name = "x" }]\n', null],
    ['[project]\ndependencies = ["""x @ https://e.example/x.whl"""]\n', null],
    ['[project.dependencies]\nx = "https://e.example/x.whl"\n', null],
    ['[project]\ndependencies = ["x >= 1 @ https://e.example/x.whl"]\n', "x"],
    ['[project]\ndependencies = ["https://e.example/x-1.0.tar.gz"]\n', null],
    ['[project]\ndependencies = ["x @ https://e.example/x.whl extra"]\n', "x"],
    ['[project]\noptional-dependencies = ["x"]\n', null],
    ['[[project.optional-dependencies]]\nx = ["y"]\n', null],
    ['[dependency-groups]\ndev = [{ include-group = "a", x = 1 }]\n', null],
    ['[dependency-groups]\ndev = [{ x = "https://e.example/x.whl" }]\n', null],
    ['[dependency-groups]\ndev = "x"\n', null],
    ['[tool.uv.sources]\nx = { git = "https://e.example/x", url = "https://e.example/x.whl" }\n', "x"],
    ['[tool.uv.sources]\nx = { rev = "main" }\n', "x"],
    ['[tool.uv.sources]\nx = { git = "https://e.example/x", evil = "y" }\n', "x"],
    ["[tool.uv.sources]\nx = { git = 1 }\n", "x"],
    ['[tool.uv.sources]\nx = { git = "https://e.example/x", rev = 5 }\n', "x"],
    ['[tool.uv.sources]\nx = { workspace = "yes" }\n', "x"],
    ['[tool.uv.sources]\nx = "https://e.example/x"\n', "x"],
    ['[tool.uv.sources]\nx.git.deeper = "https://e.example/x"\n', "x"],
    ['[tool.uv.sources]\nx = ["https://e.example/x"]\n', "x"],
    ['[tool.uv.sources]\nx = { git = "https://e.example/x" }\nx.rev = "main"\nx.git = "https://e.example/y"\n', "x"],
    ['[[tool.uv.sources]]\nx = { git = "https://e.example/x" }\n', null],
    ['[tool.uv]\nsources = "x"\n', null],
    ['[tool.poetry.dependencies]\nx = { version = "^1", evil = "y" }\n', "x"],
    ['[tool.poetry.dependencies]\nx = { git = "https://e.example/x", url = "https://e.example/x.whl" }\n', "x"],
    ['[tool.poetry.dependencies]\nx = { source = "mirror", git = "https://e.example/x" }\n', "x"],
    ["[tool.poetry.dependencies]\nx = { git = 1 }\n", "x"],
    ['[tool.poetry.dependencies]\nx.git.deeper = "y"\n', "x"],
    ['[tool.poetry.dependencies]\nx = ["^1"]\n', "x"],
    ["[tool.poetry.dependencies]\nx = 1\n", "x"],
    ['[tool.poetry.dependencies]\nx = """^1"""\n', "x"],
    ['[tool.poetry.group.dev]\ndependencies = "x"\n', null],
    ['[[tool.poetry.group]]\ndependencies = { x = { git = "https://e.example/x" } }\n', null],
  ];
  for (const [text, name] of cases) {
    const read = readOne("pyproject.toml", text);
    assert.deepEqual(read.sourced, [unreadable("PyPI", "pyproject.toml")(name, 2)], text);
    assert.deepEqual(read.couldNotRead, [{ file: "pyproject.toml", ...UNREADABLE_SOURCE }], text);
    assert.deepEqual(read.packages, [], text);
  }
  const brokenIndex = readOne("pyproject.toml", '[tool.uv.sources]\nx = { index = "broken" }\n[[tool.uv.index]]\nname = "broken"\nurl = 5\n');
  assert.deepEqual(brokenIndex.sourced, [unreadable("PyPI", "pyproject.toml")("x", 2), config("PyPI", "pyproject.toml")(5, "unreadable", null)]);
  assert.deepEqual(brokenIndex.couldNotRead, [{ file: "pyproject.toml", ...UNREADABLE_SOURCE }]);
  assert.deepEqual(brokenIndex.packages, []);
});

test("pyproject.toml: TOML it cannot read at all could not be read, and gives no names", () => {
  for (const text of ['[project]\ndependencies = ["x"\n', "[project\n", 'a = { b = 1,\n c = 2 }\n']) {
    assert.deepEqual(readOne("pyproject.toml", text), { ...EMPTY, couldNotRead: [{ file: "pyproject.toml", reason: "not TOML it can read" }] }, text);
  }
});

test("pyproject.toml: always read for its sources, beside a uv.lock or poetry.lock or not; its names the lockfile does not hold go to OSV", () => {
  const pyproject = { path: "pyproject.toml", text: '[project]\ndependencies = ["anyio>=4"]\n[tool.uv.sources]\nx = { git = "https://e.example/x" }\n' };
  const reported = [item("PyPI", "pyproject.toml")("x", 4, "git", "https://e.example/x")];
  for (const [lockfile, text] of [["uv.lock", 'version = 1\n\n[[package]]\nname = "t"\nversion = "0.1.0"\nsource = { editable = "." }\n'], ["poetry.lock", "package = []\n"]]) {
    for (const lockPath of [lockfile, `docs/demo/${lockfile}`]) {
      const read = readPackages([pyproject, { path: lockPath, text }]);
      assert.deepEqual([read.sourced, read.namesOnly, read.packages.map((p) => p.name)], [reported, ["pyproject.toml"], ["anyio"]], lockPath);
    }
  }
});

test("pyproject.toml: with a requirements file beside it, pyproject.toml is read for sources, and its names the file does not pin go to OSV", () => {
  const pyproject = '[project]\ndependencies = ["anyio>=4", "x"]\n[tool.uv.sources]\nx = { git = "https://e.example/x" }\n';
  for (const leftOut of [[], [{ path: "requirements-big.txt", reason: "larger than 5 MB" }]]) {
    const read = readPackages([{ path: "pyproject.toml", text: pyproject }, { path: "requirements.txt", text: "idna==3.10\n" }], leftOut);
    assert.deepEqual(read.packages, [
      { ecosystem: "PyPI", name: "idna", version: "3.10", file: "requirements.txt", line: 1 },
      { ecosystem: "PyPI", name: "anyio", version: null, file: "pyproject.toml", line: null },
    ]);
    assert.deepEqual(read.namesOnly, ["pyproject.toml"]);
    assert.deepEqual(read.sourced, [item("PyPI", "pyproject.toml")("x", 4, "git", "https://e.example/x")]);
  }
  const leftOutOnly = readPackages([{ path: "pyproject.toml", text: pyproject }], [{ path: "requirements.txt", reason: "larger than 5 MB" }]);
  assert.deepEqual(leftOutOnly.packages, [{ ecosystem: "PyPI", name: "anyio", version: null, file: "pyproject.toml", line: null }]);
  assert.deepEqual(leftOutOnly.sourced, [item("PyPI", "pyproject.toml")("x", 4, "git", "https://e.example/x")]);
});

test("pyproject.toml: Windows line endings give the same lines", () => {
  const text = '[project]\r\ndependencies = [\r\n  "a",\r\n  "b @ https://e.example/b-1.0.zip",\r\n]\r\n';
  assert.deepEqual(readOne("pyproject.toml", text).sourced, [item("PyPI", "pyproject.toml")("b", 4, "url", "https://e.example/b-1.0.zip")]);
});

test("pyproject.toml: long lines and many entries are read quickly", () => {
  quickly(() => readOne("pyproject.toml", `[project]\ndependencies = ["${"a".repeat(4 * 1024 * 1024)}"]\n`));
  quickly(() => readOne("pyproject.toml", `[project]\ndependencies = ["a @ ${"x".repeat(4 * 1024 * 1024)}"]\n`));
  const many = `[tool.uv.sources]\n${Array.from({ length: 50000 }, (_, i) => `p${i} = { git = "https://e.example/p${i}" }`).join("\n")}\n`;
  assert.equal(quickly(() => readOne("pyproject.toml", many)).sourced.length, 50000);
});

test("pyproject.toml: the same name in two Poetry groups, or in dependencies and dev-dependencies, is two dependencies", () => {
  const text = lines(
    "[tool.poetry.group.a.dependencies]",
    'x = { git = "https://e.example/a" }',
    "[tool.poetry.group.b.dependencies]",
    'x = { git = "https://e.example/b" }',
    "[tool.poetry.dependencies]",
    'y = { git = "https://e.example/c" }',
    "[tool.poetry.dev-dependencies]",
    'y = { git = "https://e.example/d" }',
  );
  const sourced = item("PyPI", "pyproject.toml");
  assert.deepEqual(readOne("pyproject.toml", text).sourced, [
    sourced("x", 2, "git", "https://e.example/a"),
    sourced("x", 4, "git", "https://e.example/b"),
    sourced("y", 6, "git", "https://e.example/c"),
    sourced("y", 8, "git", "https://e.example/d"),
  ]);
});

test("package.json: a file: folder or path outside the repository is a path outside the project; one inside stays local", () => {
  const file = "app/package.json";
  const text = lines(
    "{",
    '  "dependencies": {',
    '    "inside": "file:../lib",',
    '    "here": "./libs/here",',
    '    "far": "file:../../lib",',
    '    "abs": "/opt/lib",',
    '    "home": "~/lib",',
    '    "url": "file:///opt/lib",',
    '    "ws": "workspace:../../x",',
    '    "linked": "link:../../x"',
    "  }",
    "}",
  );
  const sourced = item("npm", file);
  assert.deepEqual(readOne(file, text).sourced, [
    sourced("far", 5, "url", null, OUTSIDE),
    sourced("abs", 6, "url", null, OUTSIDE),
    sourced("home", 7, "url", null, OUTSIDE),
    sourced("url", 8, "url", null, OUTSIDE),
    sourced("ws", 9, "url", null, OUTSIDE),
    sourced("linked", 10, "url", null, OUTSIDE),
  ]);
});

test("pyproject.toml: [build-system] requires and [tool.uv]'s dev, override and constraint dependencies are read for sources; their names are not sent to OSV", () => {
  const text = lines(
    "[build-system]",
    'requires = ["setuptools>=68", "builder @ https://e.example/builder-1.0.tar.gz"]',
    "[tool.uv]",
    'dev-dependencies = ["pytest", "devgit @ git+https://e.example/devgit"]',
    'override-dependencies = ["over @ https://e.example/over-1.0.zip", "numpy<2"]',
    'constraint-dependencies = ["con @ git+https://e.example/con", 5]',
  );
  const sourced = item("PyPI", "pyproject.toml");
  assert.deepEqual(readOne("pyproject.toml", text), {
    ...EMPTY,
    couldNotRead: [{ file: "pyproject.toml", ...UNREADABLE_SOURCE }],
    sourced: [
      sourced("builder", 2, "url", "https://e.example/builder-1.0.tar.gz"),
      sourced("devgit", 4, "git", "https://e.example/devgit"),
      sourced("over", 5, "url", "https://e.example/over-1.0.zip"),
      sourced("con", 6, "git", "https://e.example/con"),
      unreadable("PyPI", "pyproject.toml")(null, 6),
    ],
  });
});

test("package.json: an npm alias sends the package it names to OSV, in any case, scoped or with no version", () => {
  const text = JSON.stringify({ dependencies: { x: "npm:real@^1", y: "NPM:@s/scoped@~2", z: "npm:bare" } });
  assert.deepEqual(readOne("package.json", text).packages, ["real", "@s/scoped", "bare", "z"].map(named("npm", "package.json")));
});

test("package.json: an alias whose text after npm: is no package name is the key's package", () => {
  const text = JSON.stringify({ dependencies: { lodash: "npm:^4.17.21", react: "npm:18.2.0", vue: "npm:~3", x: "npm:real@^1" } });
  assert.deepEqual(readOne("package.json", text).packages, ["lodash", "react", "vue", "real"].map(named("npm", "package.json")));
});

test("package.json: a value starting with a dot or a drive letter is a path; outside the repository it is reported; its name is never sent to OSV", () => {
  const file = "app/package.json";
  const text = lines("{", '  "dependencies": {', '    "dot": ".",', '    "up": "..",', '    "hidden": ".hidden",', '    "drive": "C:/x",', '    "upup": "../.."', "  }", "}");
  const read = readOne(file, text);
  assert.deepEqual(read.packages, []);
  assert.deepEqual(read.sourced, [item("npm", file)("drive", 6, "url", null, OUTSIDE), item("npm", file)("upup", 7, "url", null, OUTSIDE)]);
});

test("package.json: a tarball on the official registry is checked by the name and version its file name gives, never by the key; any other address there is one it cannot read", () => {
  const text = lines(
    "{",
    '  "dependencies": {',
    '    "x": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",',
    '    "y": "https://registry.yarnpkg.com/@babel/core/-/core-7.0.0.tgz",',
    '    "z": "https://registry.npmjs.org/@s%2fname/-/name-1.0.0-beta.1.tgz",',
    '    "v": "https://registry.npmjs.org/left-pad/-/other-1.0.0.tgz",',
    '    "w": "https://registry.npmjs.org/weird/path.tgz",',
    '    "b": "https://registry.npmjs.org/b"',
    "  },",
    '  "devDependencies": { "d": "https://registry.npmjs.org/d/-/d.tgz" },',
    `  "overrides": { "o": "https://registry.npmjs.org/o/-/o-${"1".repeat(600)}.0.0.tgz" }`,
    "}",
  );
  const read = readOne("package.json", text);
  const pkg = (name, version) => ({ ecosystem: "npm", name, version, file: "package.json", line: null });
  assert.deepEqual(read.packages, [pkg("lodash", "4.17.21"), pkg("@babel/core", "7.0.0"), pkg("@s/name", "1.0.0-beta.1"), pkg("other", "1.0.0")]);
  const bad = unreadable("npm", "package.json");
  assert.deepEqual(read.sourced, [bad("w", 7), bad("b", 8), bad("d", 10), bad("o", 11)]);
  assert.deepEqual(read.couldNotRead, [{ file: "package.json", ...UNREADABLE_SOURCE }]);
});

test("package.json: an alias in overrides, resolutions or pnpm.overrides, and the package a patch patches, are sent to OSV", () => {
  const text = JSON.stringify({
    dependencies: { foo2: "patch:foo@npm%3Abar%40^1#./p.patch", lodash: "patch:lodash@npm%3A4.17.21#./p.patch" },
    devDependencies: { tap: "npm:not-sent@1" },
    overrides: { foo: "npm:evil@1", nested: { ".": "npm:evil-nested@1" }, plain: "^1", patched: "patch:q@npm%3Aqq%40^1#./p.patch" },
    resolutions: { bar: "npm:@s/evil2@^2" },
    pnpm: { overrides: { baz: "npm:evil3" } },
  });
  assert.deepEqual(readOne("package.json", text).packages, ["bar", "lodash", "evil", "evil-nested", "qq", "@s/evil2", "evil3", "baz"].map(named("npm", "package.json")));
});

test("package.json: a UTF-8 byte order mark before the JSON is read past, the lines unchanged", () => {
  const text = '\uFEFF{\n  "dependencies": {\n    "a": "^1",\n    "b": "github:u/b"\n  }\n}\n';
  const read = readOne("package.json", text);
  assert.deepEqual(read.packages, [named("npm", "package.json")("a")]);
  assert.deepEqual(read.sourced, [item("npm", "package.json")("b", 4, "git", "https://github.com/u/b")]);
});

test("pyproject.toml: PDM's ${PROJECT_ROOT} and Hatch's {root:uri} are the project's folder, so the path is local, bundled or outside as usual", () => {
  const text = lines(
    "[project]",
    "dependencies = [",
    '    "a @ file:///${PROJECT_ROOT}/libs/a",',
    '    "b @ file:///${PROJECT_ROOT}/dist/b-1.0-py3-none-any.whl",',
    '    "c @ {root:uri}/../../c",',
    '    "d @ {root:uri}/d-1.0.tar.gz",',
    '    "e @ {root:uri}",',
    "]",
  );
  const file = "py/pyproject.toml";
  const read = readOne(file, text);
  assert.deepEqual(read.packages, []);
  assert.deepEqual(read.sourced, [
    item("PyPI", file)("b", 4, "bundled", "py/dist/b-1.0-py3-none-any.whl", BUNDLED),
    item("PyPI", file)("c", 5, "url", null, OUTSIDE),
    item("PyPI", file)("d", 6, "bundled", "py/d-1.0.tar.gz", BUNDLED),
  ]);
});

test("pyproject.toml: uv's build-constraint and extra build dependencies, and PDM's dev-dependencies (with -e), are read for sources; their names are not sent to OSV", () => {
  const text = lines(
    "[tool.uv]",
    'build-constraint-dependencies = ["setuptools<70", "bc @ https://e.example/bc-1.0.zip"]',
    "[tool.uv.extra-build-dependencies]",
    "flash = [",
    '    "x @ https://e.example/x-1.0.tar.gz",',
    '    { requirement = "y @ git+https://e.example/y", match-runtime = true },',
    '    { requirement = "torch" },',
    "]",
    "[tool.pdm.dev-dependencies]",
    "dev = [",
    '    "pytest",',
    '    "z @ https://e.example/z-1.0.zip",',
    '    "-e file:///${PROJECT_ROOT}/libs/e#egg=e",',
    '    "-e git+https://e.example/f#egg=f",',
    "]",
  );
  const sourced = item("PyPI", "pyproject.toml");
  assert.deepEqual(readOne("pyproject.toml", text), {
    ...EMPTY,
    sourced: [
      sourced("bc", 2, "url", "https://e.example/bc-1.0.zip"),
      sourced("x", 5, "url", "https://e.example/x-1.0.tar.gz"),
      sourced("y", 6, "git", "https://e.example/y"),
      sourced("z", 12, "url", "https://e.example/z-1.0.zip"),
      sourced("f", 14, "git", "https://e.example/f"),
    ],
  });
  const bad = [
    '[tool.uv.extra-build-dependencies]\nflash = "x"\n',
    '[tool.uv.extra-build-dependencies]\nflash = [{ requirement = "x", evil = 1 }]\n',
    '[tool.uv.extra-build-dependencies]\nflash = [{ match-runtime = true }]\n',
    '[tool.uv]\nextra-build-dependencies = "x"\n',
    '[tool.pdm.dev-dependencies]\ndev = "x"\n',
    '[tool.pdm]\ndev-dependencies = ["x"]\n',
    '[tool.pdm.dev-dependencies]\ndev = ["-e"]\n',
    '[dependency-groups]\ndev = [{ requirement = "x" }]\n',
  ];
  for (const text of bad) assert.deepEqual(readOne("pyproject.toml", text).sourced, [unreadable("PyPI", "pyproject.toml")(null, 2)], text);
});

test("package.json: npm:<tag> sends both the tag read as a package name and the key's package, since npm and Yarn read it differently", () => {
  const text = JSON.stringify({ dependencies: { react: "npm:latest", vue: "npm:next" }, overrides: { foo: "npm:beta" } });
  assert.deepEqual(readOne("package.json", text).packages, ["latest", "react", "next", "vue", "beta", "foo"].map(named("npm", "package.json")));
});

test("pyproject.toml: an escape TOML does not define makes that string one it cannot read; elsewhere it changes nothing", () => {
  const read = readOne("pyproject.toml", '[project]\nname = "a\\qb"\ndependencies = ["x \\q@ https://e.example/x.zip", "y"]\n');
  assert.deepEqual(read.sourced, [unreadable("PyPI", "pyproject.toml")(null, 3)]);
  assert.deepEqual(read.packages, [named("PyPI", "pyproject.toml")("y")]);
  const key = readOne("pyproject.toml", '[tool.uv.sources]\n"a\\q" = { git = "https://e.example/a" }\n');
  assert.deepEqual(key.sourced, [unreadable("PyPI", "pyproject.toml")(null, 2)]);
});

test("pyproject.toml: a header or key of thousands of parts, with thousands of keys under it, is read quickly", () => {
  const parts = Array(40000).fill("a").join(".");
  const keys = Array.from({ length: 40000 }, (_, k) => `k${k} = 1`).join("\n");
  assert.deepEqual(quickly(() => readOne("pyproject.toml", `[${parts}]\n${keys}\n`)).couldNotRead, []);
  const deep = quickly(() => readOne("pyproject.toml", `[tool.uv.sources]\n${Array.from({ length: 2000 }, (_, k) => `x.${Array(200).fill("a").join(".")}.b${k} = "y"`).join("\n")}\n`));
  assert.deepEqual(deep.sourced, [unreadable("PyPI", "pyproject.toml")("x", 2)]);
  quickly(() => readOne("pyproject.toml", Array.from({ length: 2000 }, () => `[[${Array(500).fill("a").join(".")}]]`).join("\n")));
});

test("pyproject.toml: a UTF-8 byte order mark before the TOML is read past", () => {
  const read = readOne("pyproject.toml", '﻿[project]\ndependencies = ["a @ https://e.example/a-1.0.zip"]\n');
  assert.deepEqual(read.sourced, [item("PyPI", "pyproject.toml")("a", 2, "url", "https://e.example/a-1.0.zip")]);
});

test("pyproject.toml: a Poetry source is found by name in any case, as Poetry compares names; a uv index by its exact name", () => {
  const poetry = '[tool.poetry.dependencies]\na = { version = "^1", source = "Mirror" }\n[[tool.poetry.source]]\nname = "mirror"\nurl = "https://mirror.example.com/simple"\n';
  const mirrorConfig = config("PyPI", "pyproject.toml")(5, "host", "https://mirror.example.com");
  assert.deepEqual(readOne("pyproject.toml", poetry).sourced, [item("PyPI", "pyproject.toml")("a", 2, "host", "https://mirror.example.com"), mirrorConfig]);
  const uv = '[tool.uv.sources]\na = { index = "Mirror" }\n[[tool.uv.index]]\nname = "mirror"\nurl = "https://mirror.example.com/simple"\n';
  assert.deepEqual(readOne("pyproject.toml", uv).sourced, [item("PyPI", "pyproject.toml")("a", 2, "host", null, NAMED_INDEX), mirrorConfig]);
});

test("pyproject.toml: [[tool.uv.sources.a]] tables read as the list a = [{ … }] they equal", () => {
  const text = lines(
    "[[tool.uv.sources.a]]",
    'git = "https://e.example/a"',
    "marker = \"sys_platform == 'linux'\"",
    "[[tool.uv.sources.a]]",
    'url = "https://e.example/a-1.0.zip"',
    "[[tool.poetry.dependencies.b]]",
    'version = "^1"',
    "[[tool.poetry.dependencies.b]]",
    'path = "../outside"',
  );
  const sourced = item("PyPI", "pyproject.toml");
  assert.deepEqual(readOne("pyproject.toml", text).sourced, [
    sourced("a", 2, "git", "https://e.example/a"),
    sourced("a", 5, "url", "https://e.example/a-1.0.zip"),
    sourced("b", 9, "url", null, OUTSIDE),
  ]);
  const mixed = readOne("pyproject.toml", '[tool.uv.sources]\na = { git = "https://e.example/a" }\n[[tool.uv.sources.a]]\nurl = "https://e.example/a-1.0.zip"\n');
  assert.deepEqual(mixed.sourced, [unreadable("PyPI", "pyproject.toml")("a", 2)]);
});

test("package.json: a workspace folder pattern that can reach outside the repository is a path outside the project (a brace or bracket always can; wildcards stand for one name); inside it gives nothing", () => {
  const file = "app/package.json";
  for (const pattern of ["{packages/a,../ext}", "packages/*/../../../ext", "*/../../ext", "[.][.]/ext"]) {
    assert.deepEqual(readOne("package.json", JSON.stringify({ workspaces: [pattern] })).sourced, [item("npm", "package.json")(null, 1, "url", null, OUTSIDE)], pattern);
  }
  for (const pattern of ["..*", "*", "packages/?/x", "!../../ignored"]) {
    assert.deepEqual(readOne("package.json", JSON.stringify({ workspaces: [pattern] })).sourced, [], pattern);
  }
  const array = lines("{", '  "workspaces": ["packages/*", "../shared/*", "../../outside/*", "!../../ignored", "*"]', "}");
  assert.deepEqual(readOne(file, array).sourced, [item("npm", file)(null, 2, "url", null, OUTSIDE)]);
  const object = lines("{", '  "workspaces": {', '    "packages": ["../../far", "libs/**"]', "  }", "}");
  assert.deepEqual(readOne(file, object).sourced, [item("npm", file)(null, 3, "url", null, OUTSIDE)]);
  const bad = unreadable("npm", "package.json");
  assert.deepEqual(readOne("package.json", '{"workspaces": "x"}').sourced, [bad(null, 1)]);
  assert.deepEqual(readOne("package.json", '{"workspaces": [1]}').sourced, [bad(null, 1)]);
  assert.deepEqual(readOne("package.json", '{"workspaces": {"packages": "x"}}').sourced, [bad(null, 1)]);
});

test("pyproject.toml: a [tool.uv.workspace] member outside the repository is a path outside the project; inside it gives nothing", () => {
  const text = lines("[tool.uv.workspace]", 'members = ["packages/*", "../../outside/*", "../sibling"]', 'exclude = ["../../x"]');
  assert.deepEqual(readOne("py/pyproject.toml", text).sourced, [item("PyPI", "py/pyproject.toml")(null, 2, "url", null, OUTSIDE)]);
  for (const pattern of ["{a,../x}", "*/../../x", "[.][.]/x"]) {
    const read = readOne("pyproject.toml", `[tool.uv.workspace]\nmembers = ["${pattern}"]\n`);
    assert.deepEqual(read.sourced, [item("PyPI", "pyproject.toml")(null, 2, "url", null, OUTSIDE)], pattern);
  }
  assert.deepEqual(readOne("pyproject.toml", '[tool.uv.workspace]\nmembers = ["..*"]\n').sourced, []);
  assert.deepEqual(readOne("pyproject.toml", '[tool.uv.workspace]\nmembers = "x"\n').sourced, [unreadable("PyPI", "pyproject.toml")(null, 2)]);
  assert.deepEqual(readOne("pyproject.toml", '[tool.uv.workspace]\nmembers = [1]\n').sourced, [unreadable("PyPI", "pyproject.toml")(null, 2)]);
});

"use strict";
// ABOUTME: Tests that hostile package files stay bounded end to end: a one-line, deeply nested, prototype-keyed or CRLF file is read
// ABOUTME: through the deep scan in bounded time, and every reader's worst inputs for memory run within a 256 MB heap.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { runDeep } = require("../../src/deep/runDeep");
const { makeTree, fakeFetch, inSmallHeap } = require("../helpers");

const LOCKFILES_MODULE = require.resolve("../../src/deep/lockfiles");
const NO_GIT = { found: false, filter: false, endOfOptions: false };
const OFF = { ref: null, site: false, osv: false, claude: false, claudeOk: null, budget: null, model: "sonnet" };
const OSV_BATCH = "https://api.osv.dev/v1/querybatch";
const MB = 1024 * 1024;

// The deep scan of a folder, OSV off or answered by a stand-in that finds nothing, which must finish within 5 s; with the
// packages sent to OSV, as "ecosystem:name".
async function deepScan(files, { osv = false } = {}) {
  const fetchImpl = fakeFetch({ [OSV_BATCH]: (init) => ({ body: { results: JSON.parse(init.body).queries.map(() => ({})) } }) });
  const start = Date.now();
  const result = await runDeep(makeTree(files), { ...OFF, osv }, { git: NO_GIT, fetchImpl });
  const took = Date.now() - start;
  assert.ok(took < 5000, `took ${took} ms`);
  const sent = fetchImpl.calls.flatMap((url, k) =>
    url === OSV_BATCH ? JSON.parse(fetchImpl.options[k].body).queries.map((q) => `${q.package.ecosystem}:${q.package.name}`) : []);
  return { result, sent };
}

const couldNotRead = (result) => Object.fromEntries(result.deep.packages.couldNotRead.map(({ file, reason }) => [file, reason]));

test("a package-lock.json of one 4.9 MB line is read in bounded time", async () => {
  const packages = { "": {} };
  let size = 0;
  for (let i = 0; size < 4.9 * MB - 200; i++) {
    const entry = { version: "1.0.0", resolved: `https://m.example/p${i}/-/p${i}-1.0.0.tgz` };
    packages[`node_modules/p${i}`] = entry;
    size += JSON.stringify(entry).length + `"node_modules/p${i}":,`.length;
  }
  const text = JSON.stringify({ lockfileVersion: 3, packages });
  assert.ok(text.length < 5 * MB && !text.includes("\n"));
  const { result } = await deepScan({ "SKILL.md": "Formats tables.", "package-lock.json": text });
  const [entry] = result.deep.packages.offRegistry;
  assert.equal(entry.total, Object.keys(packages).length - 1);
  assert.equal(result.rating, "yellow");
});

test("JSON nested 100,000 levels deep is too deeply nested or a layout it cannot read, never a crash", async () => {
  const nested = (open, close) => `${open.repeat(100000)}1${close.repeat(100000)}`;
  const { result } = await deepScan({
    "SKILL.md": "Formats tables.",
    "a/package-lock.json": `{"lockfileVersion":3,"packages":${nested("[", "]")}}`,
    "b/package-lock.json": `{"lockfileVersion":1,"dependencies":${nested('{"a":', "}")}}`,
    "c/package-lock.json": `{"lockfileVersion":3,"packages":{"node_modules/a":${nested('{"a":', "}")}}}`,
    "d/package.json": `{"dependencies":${nested('{"a":', "}")}}`,
    "e/package.json": `{"overrides":${nested('{"a":', "}")}}`,
  });
  assert.deepEqual(couldNotRead(result), {
    "a/package-lock.json": "not laid out as npm writes it",
    "b/package-lock.json": "no packages found in it",
    "c/package-lock.json": "no packages found in it",
    "d/package.json": "a package source it could not read",
    "e/package.json": "a package source it could not read",
  });
  assert.equal(result.rating, "yellow");
});

test("__proto__, constructor and prototype as package names and as config keys are plain names, in every format", async () => {
  const names = ["__proto__", "constructor", "prototype"];
  const npmLock = { lockfileVersion: 3, packages: { "": {} } };
  for (const name of names) npmLock.packages[`node_modules/${name}`] = { version: "1.0.0", resolved: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz` };
  const pythonNames = ["constructor", "prototype"];
  const { result, sent } = await deepScan({
    "SKILL.md": "Formats tables.",
    "npm/package-lock.json": JSON.stringify(npmLock, null, 2),
    "npm/package.json": `{"dependencies":${JSON.stringify(Object.fromEntries(names.map((n) => [n, "^1"])))},"overrides":{"__proto__":"github:u/p","constructor":"github:u/c"}}`,
    "yarn/yarn.lock": `# yarn lockfile v1\n\n${names.map((n) => `${n}@^1:\n  version "1.0.0"\n  resolved "https://registry.yarnpkg.com/${n}/-/${n}-1.0.0.tgz"\n`).join("\n")}`,
    "pnpm/pnpm-lock.yaml": `lockfileVersion: '9.0'\n\npackages:\n\n${names.map((n) => `  ${n}@1.0.0:\n    resolution: {integrity: sha512-x}\n`).join("\n")}`,
    "pnpm/.npmrc": "__proto__=https://x.example\nconstructor:registry=https://x.example\n@prototype:registry=https://p.example/\n",
    "pnpm/pnpm-workspace.yaml": "catalog:\n  __proto__: 1.0.0\n  constructor: github:u/c\n",
    "berry/.yarnrc.yml": "__proto__:\n  npmRegistryServer: https://x.example\nnpmScopes:\n  constructor:\n    npmRegistryServer: https://c.example\n",
    "poetry/poetry.lock": pythonNames.map((n) => `[[package]]\nname = "${n}"\nversion = "1.0.0"\n`).join("\n"),
    "uv/uv.lock": `version = 1\n\n${pythonNames.map((n) => `[[package]]\nname = "${n}"\nversion = "1.0.0"\nsource = { registry = "https://pypi.org/simple" }\n`).join("\n")}`,
    "uv/uv.toml": '[__proto__]\nindex-url = "https://x.example/simple"\n\n[constructor]\nx = 1\n',
    "req/requirements.txt": pythonNames.map((n) => `${n}==1.0.0\n`).join(""),
    "pdm/pdm.toml": '[pypi.__proto__]\nurl = "https://p.example/simple"\n\n[pypi.constructor]\nurl = "https://c.example/simple"\n',
    "py/pyproject.toml": '[project]\ndependencies = ["constructor==1.0", "prototype>=1"]\n\n[tool.uv.sources]\nconstructor = { git = "https://g.example/c" }\n',
  }, { osv: true });
  assert.equal({}.polluted, undefined);
  assert.ok(!Object.prototype.hasOwnProperty.call(Object.prototype, "version"));
  for (const name of names) assert.ok(sent.includes(`npm:${name}`), name);
  for (const name of pythonNames) assert.ok(sent.includes(`PyPI:${name}`), name);
  const reported = result.deep.packages.offRegistry.map((e) => `${e.file} ${e.address}`);
  for (const expected of [
    "npm/package.json https://github.com/u/p",
    "npm/package.json https://github.com/u/c",
    "pnpm/.npmrc https://p.example",
    "pnpm/pnpm-workspace.yaml https://github.com/u/c",
    "berry/.yarnrc.yml https://c.example",
    "pdm/pdm.toml https://p.example",
    "pdm/pdm.toml https://c.example",
    "py/pyproject.toml https://g.example/c",
  ]) {
    assert.ok(reported.includes(expected), `${expected} in ${reported.join("\n")}`);
  }
});

// Every fixture format and a config file of each kind, as written and with Windows line endings.
function everyFormat(crlf) {
  const fixtures = path.join(__dirname, "fixtures", "lockfiles");
  const as = (name) => {
    if (name.startsWith("package-lock")) return "package-lock.json";
    if (name.startsWith("pnpm-lock")) return "pnpm-lock.yaml";
    if (name.startsWith("yarn")) return "yarn.lock";
    if (name.startsWith("requirements")) return "requirements.txt";
    return name.startsWith("poetry") ? "poetry.lock" : "uv.lock";
  };
  const files = {
    "SKILL.md": "Formats tables.",
    "configs/.npmrc": "registry=https://npm.example.com/\n@s:registry=https://s.example/\nstrict-ssl=false\n",
    "configs/.yarnrc": 'registry "https://yarn.example.com/"\n',
    "configs/.yarnrc.yml": 'npmRegistryServer: "https://berry.example.com"\nnpmScopes:\n  s:\n    npmRegistryServer: "https://s.example"\n',
    "configs/pnpm-workspace.yaml": "packages:\n  - libs/*\ncatalog:\n  a: github:u/a\n",
    "configs/uv.toml": 'index-url = "https://uv.example.com/simple"\n\n[[index]]\nname = "x"\nurl = "https://x.example/simple"\n',
    "configs/pdm.toml": '[pypi]\nurl = "https://pdm.example.com/simple"\n',
    "configs/package.json": JSON.stringify({ dependencies: { a: "^1", b: "github:u/b" } }, null, 2),
    "configs/pyproject.toml": '[project]\ndependencies = [\n  "a",\n  "b @ https://e.example/b-1.0.zip",\n]\n',
  };
  for (const name of fs.readdirSync(fixtures)) files[`${name}/${as(name)}`] = fs.readFileSync(path.join(fixtures, name), "utf-8");
  for (const [file, text] of Object.entries(files)) if (crlf) files[file] = text.replace(/\n/g, "\r\n");
  return files;
}

test("every fixture format and config file reads the same with Windows line endings", async () => {
  const lf = await deepScan(everyFormat(false), { osv: true });
  const crlf = await deepScan(everyFormat(true), { osv: true });
  assert.deepEqual(crlf.result.deep.packages, lf.result.deep.packages);
  assert.deepEqual(crlf.sent, lf.sent);
  assert.deepEqual([lf.sent.length, lf.result.deep.packages.offRegistry.length], [30, 50]);
});

// Memory: what a reader stores must not grow faster than the file. Each case builds its files inside a child process with a 256
// MB heap, where running out of memory aborts the process; it must read them, or list a file it could not read.

// Runs each case (a self-contained function returning the files) through readPackages in one small-heap child, and returns for
// each how many packages, sources and notes it read and the reasons it could not read a file.
function readEachInSmallHeap(cases) {
  const script = [
    `const { readPackages } = require(${JSON.stringify(LOCKFILES_MODULE)});`,
    `const cases = [${Object.entries(cases).map(([name, build]) => `[${JSON.stringify(name)}, ${build.toString()}]`).join(",\n")}];`,
    "const out = {};",
    "for (const [name, build] of cases) {",
    "  const read = readPackages(build());",
    "  out[name] = { read: read.packages.length + read.sourced.length + read.notRecorded.length, couldNotRead: read.couldNotRead.map((c) => c.reason) };",
    "}",
    "process.stdout.write(JSON.stringify(out));",
  ].join("\n");
  const out = inSmallHeap(script);
  for (const [name, { read, couldNotRead }] of Object.entries(out)) assert.ok(read > 0 || couldNotRead.length > 0, name);
  return out;
}

const readInSmallHeap = (body) => inSmallHeap(`const { readPackages } = require(${JSON.stringify(LOCKFILES_MODULE)}); ${body}`);

test("npm lockfiles: long keys per entry, deep node_modules chains, a deep version 1 tree and entries sharing one long path stay within a small heap", () => {
  readEachInSmallHeap({
    "long keys": () => {
      const packages = { "": {} };
      for (let i = 0; i < 2000; i++) packages[`node_modules/${"k".repeat(2400)}${i}`] = { version: "1.0.0", resolved: `https://m.example/${"r".repeat(100)}.tgz` };
      return [{ path: "package-lock.json", text: JSON.stringify({ lockfileVersion: 3, packages }) }];
    },
    "deep node_modules chains": () => {
      const packages = { "": {} };
      for (let depth = 1; depth <= 800; depth++) packages[Array(depth).fill("node_modules/a").join("/")] = { version: "1.0.0", resolved: "https://m.example/a.tgz" };
      return [{ path: "package-lock.json", text: JSON.stringify({ lockfileVersion: 3, packages }) }];
    },
    "deep version 1 tree": () => {
      let text = '{"lockfileVersion":1,"dependencies":';
      for (let i = 0; i < 60000; i++) text += `{"p${i}":{"version":"1.0.0","dependencies":`;
      return [{ path: "package-lock.json", text: `${text}{}${"}}".repeat(60000)}}` }];
    },
    "entries sharing one long path": () => {
      const folder = Array(20000).fill("dd").join("/");
      const packages = { "": {} };
      for (let i = 0; i < 60000; i++) packages[`node_modules/p${i}`] = { version: "1.0.0", resolved: "https://m.example/p.tgz" };
      return [{ path: `${folder}/package-lock.json`, text: JSON.stringify({ lockfileVersion: 3, packages }) }];
    },
  });
});

test("yarn.lock and pnpm-lock.yaml: keys of many specs, wide inline maps, long keys and 200,000 lines stay within a small heap", () => {
  readEachInSmallHeap({
    "classic keys of many specs": () => {
      const specs = Array.from({ length: 2000 }, (_, k) => `a@^${k}`).join(", ");
      const blocks = Array.from({ length: 200 }, () => `${specs}:\n  version "1.0.0"\n  resolved "https://m.example/a.tgz"\n`);
      return [{ path: "yarn.lock", text: `# yarn lockfile v1\n\n${blocks.join("\n")}` }];
    },
    "berry keys of many specs": () => {
      const specs = Array.from({ length: 2000 }, (_, k) => `a@npm:^${k}`).join(", ");
      const blocks = Array.from({ length: 150 }, () => `"${specs}":\n  version: 1.0.0\n  resolution: "a@npm:1.0.0"\n`);
      return [{ path: "yarn.lock", text: `__metadata:\n  version: 8\n\n${blocks.join("\n")}` }];
    },
    "pnpm wide inline maps": () => {
      const wide = Array.from({ length: 200000 }, (_, k) => `k${k}: v`).join(", ");
      return [{ path: "pnpm-lock.yaml", text: `lockfileVersion: '9.0'\n\npackages:\n\n  a@1.0.0:\n    resolution: {integrity: sha512-x, ${wide}}\n` }];
    },
    "pnpm long keys": () => {
      const blocks = Array.from({ length: 1500 }, (_, k) => `  ${"k".repeat(3000)}${k}@1.0.0:\n    resolution: {tarball: https://m.example/a.tgz}\n`);
      return [{ path: "pnpm-lock.yaml", text: `lockfileVersion: '9.0'\n\npackages:\n\n${blocks.join("\n")}` }];
    },
    "pnpm 200,000 lines": () => {
      const blocks = Array.from({ length: 50000 }, (_, k) => `  p${k}@1.0.0:\n    resolution: {integrity: sha512-x}\n`);
      return [{ path: "pnpm-lock.yaml", text: `lockfileVersion: '9.0'\n\npackages:\n\n${blocks.join("\n")}` }];
    },
  });
});

test("Python lockfiles and requirements: many tables with long dotted keys, wide inline tables, many wheels and many -r files stay within a small heap", () => {
  readEachInSmallHeap({
    "poetry long dotted keys": () => {
      const key = Array(400).fill("k").join(".");
      const blocks = Array.from({ length: 2000 }, (_, k) => `[[package]]\nname = "p${k}"\nversion = "1.0.0"\n\n[package.extras]\n${key} = ["x"]\n`);
      return [{ path: "poetry.lock", text: blocks.join("\n") }];
    },
    "uv wide inline tables": () => {
      const wide = Array.from({ length: 150000 }, (_, k) => `k${k} = "v"`).join(", ");
      return [{ path: "uv.lock", text: `version = 1\n\n[[package]]\nname = "a"\nversion = "1.0.0"\nsource = { registry = "https://pypi.org/simple", ${wide} }\n` }];
    },
    "uv many wheels from one mirror": () => {
      const wheels = Array.from({ length: 30000 }, (_, k) => `  { url = "https://m.example/${"w".repeat(60)}/a-${k}.whl", hash = "sha256:x" },`).join("\n");
      return [{ path: "uv.lock", text: `version = 1\n\n[[package]]\nname = "a"\nversion = "1.0.0"\nsource = { registry = "https://m.example/simple" }\nwheels = [\n${wheels}\n]\n` }];
    },
    "many -r files, each naming every other": () => {
      const files = [];
      for (let i = 0; i < 500; i++) {
        const lines = Array.from({ length: 500 }, (_, k) => `-r requirements-${k}.txt`);
        files.push({ path: `requirements-${i}.txt`, text: `${lines.join("\n")}\nidna==3.10\n` });
      }
      return files;
    },
    "a long chain of -r files deep in folders": () => {
      const folder = Array(2000).fill("dd").join("/");
      return Array.from({ length: 5000 }, (_, i) => ({ path: `${folder}/requirements-${i}.txt`, text: `-r requirements-${i + 1}.txt\n-i https://m.example/simple\nidna==3.10\n` }));
    },
  });
});

test("manifests: package.json with long keys and wide overrides, pyproject.toml with headers of thousands of parts per table, stay within a small heap", () => {
  readEachInSmallHeap({
    "package.json long keys": () => {
      const dependencies = {};
      for (let i = 0; i < 2000; i++) dependencies[`${"k".repeat(2400)}${i}`] = "github:u/r";
      return [{ path: "package.json", text: JSON.stringify({ dependencies }) }];
    },
    "package.json wide nested overrides": () => {
      const overrides = {};
      for (let i = 0; i < 2000; i++) overrides[`p${i}`] = Object.fromEntries(Array.from({ length: 50 }, (_, k) => [`q${k}`, "npm:evil@1"]));
      return [{ path: "package.json", text: JSON.stringify({ overrides }) }];
    },
    "pyproject headers of 20,000 parts": () => {
      const header = Array(20000).fill("a").join(".");
      const tables = Array.from({ length: 100 }, (_, k) => `[${header}.t${k}]\nk = "v"\n`).join("\n");
      return [{ path: "pyproject.toml", text: `[project]\ndependencies = ["a @ https://e.example/a.zip"]\n\n${tables}` }];
    },
    "pyproject dotted keys of 2,000 parts": () => {
      const key = Array(2000).fill("a").join(".");
      return [{ path: "pyproject.toml", text: `[tool.uv.sources]\n${Array.from({ length: 1000 }, (_, k) => `${key}.b${k} = "y"`).join("\n")}\n` }];
    },
    "pyproject many array tables": () => {
      const header = Array(500).fill("a").join(".");
      return [{ path: "pyproject.toml", text: `[project]\ndependencies = ["a @ https://e.example/a.zip"]\n${Array.from({ length: 4000 }, () => `[[${header}]]`).join("\n")}\n` }];
    },
  });
});

test("config files: many scopes, 200,000-line YAML, huge catalogs, many [[index]] tables and many pdm sources stay within a small heap", () => {
  readEachInSmallHeap({
    ".npmrc many scopes": () => [{ path: ".npmrc", text: Array.from({ length: 150000 }, (_, k) => `@s${k}:registry=https://m.example/`).join("\n") }],
    ".yarnrc many lines": () => [{ path: ".yarnrc", text: Array.from({ length: 150000 }, (_, k) => `"@s${k}:registry" "https://m.example/"`).join("\n") }],
    ".yarnrc.yml 200,000 lines": () => {
      const scopes = Array.from({ length: 100000 }, (_, k) => `  s${k}:\n    npmRegistryServer: https://m.example`).join("\n");
      return [{ path: ".yarnrc.yml", text: `npmScopes:\n${scopes}\n` }];
    },
    "pnpm-workspace.yaml huge catalogs beside many manifests": () => {
      const catalogs = Array.from({ length: 2000 }, (_, c) => `  c${c}:\n${Array.from({ length: 20 }, (_, k) => `    p${k}: ^1`).join("\n")}`).join("\n");
      const files = [{ path: "pnpm-workspace.yaml", text: `packages:\n  - "p/*"\ncatalogs:\n${catalogs}\n` }];
      const dependencies = Object.fromEntries(Array.from({ length: 20 }, (_, k) => [`p${k}`, "catalog:c1"]));
      for (let i = 0; i < 2000; i++) files.push({ path: `p/m${i}/package.json`, text: JSON.stringify({ dependencies }) });
      return files;
    },
    "uv.toml many [[index]] tables": () => [{ path: "uv.toml", text: Array.from({ length: 60000 }, (_, k) => `[[index]]\nname = "i${k}"\nurl = "https://m${k}.example/simple"\n`).join("\n") }],
    "pdm.toml many sources": () => [{ path: "pdm.toml", text: Array.from({ length: 60000 }, (_, k) => `[pypi.s${k}]\nurl = "https://m${k}.example/simple"\n`).join("\n") }],
  });
});

test("many .npmrc files loading one file of many scoped registries, or a long chain of them, stay within a small heap", () => {
  const star = readInSmallHeap(`
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/x": { version: "1.0.0" } } });
    const files = [{ path: "hub", text: "@a:registry=https://e.example/\\n".repeat(20000) }];
    for (let i = 0; i < 3000; i++) {
      files.push({ path: "p" + i + "/.npmrc", text: "userconfig=../hub\\n" }, { path: "p" + i + "/package-lock.json", text: lock }, { path: "p" + i + "/package.json", text: "{}" });
    }
    const result = readPackages(files);
    console.log(JSON.stringify({ notes: result.notRecorded.length, sourced: result.sourced.length }));
  `);
  assert.deepEqual(star, { notes: 3000, sourced: 20000 });
  const chain = readInSmallHeap(`
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/@a/x": { version: "1.0.0" } } });
    const files = [];
    for (let i = 0; i < 3000; i++) {
      files.push({ path: "d" + i + "/.npmrc", text: "userconfig=../d" + (i + 1) + "/.npmrc\\n@b:registry=https://e.example/\\n" }, { path: "d" + i + "/package-lock.json", text: lock }, { path: "d" + i + "/package.json", text: "{}" });
    }
    files.push({ path: "d3000/.npmrc", text: "@a:registry=https://e.example/\\n" });
    const result = readPackages(files);
    console.log(JSON.stringify({ notes: result.notRecorded.length }));
  `);
  assert.deepEqual(chain, { notes: 0 });
});

test("a big lockfile of scoped packages beside many projects that load one file naming every scope's registry stays within a small heap", () => {
  const scoped = readInSmallHeap(`
    const small = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/x": { version: "1.0.0" } } });
    const packages = { "": {} };
    for (let i = 0; i < 20000; i++) packages["node_modules/@s" + i + "/x"] = { version: "1.0.0" };
    const files = [{ path: "package-lock.json", text: JSON.stringify({ lockfileVersion: 3, packages }) }, { path: "package.json", text: "{}" }];
    files.push({ path: "hub", text: Array.from({ length: 20000 }, (_, i) => "@s" + i + ":registry=https://e.example/").join("\\n") });
    for (let i = 0; i < 600; i++) {
      files.push({ path: "p" + i + "/.npmrc", text: "userconfig=../hub\\n" }, { path: "p" + i + "/package-lock.json", text: small }, { path: "p" + i + "/package.json", text: "{}" });
    }
    const result = readPackages(files);
    console.log(JSON.stringify({ notes: result.notRecorded.length, sourced: result.sourced.length }));
  `);
  assert.deepEqual(scoped, { notes: 601, sourced: 20000 });
});

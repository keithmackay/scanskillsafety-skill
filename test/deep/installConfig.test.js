"use strict";
// ABOUTME: Tests reading the config files that redirect installs (.npmrc, .yarnrc, .yarnrc.yml, uv.toml, pyproject.toml, and
// ABOUTME: pnpm-workspace.yaml folders), failing closed, and the note for a lockfile that records no registry.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readPackages } = require("../../src/deep/lockfiles");

const EMPTY = { packages: [], namesOnly: [], couldNotRead: [], notChecked: [], sourced: [], notRecorded: [] };
const UNREADABLE_SOURCE = "a package source it could not read";
const lines = (...rows) => rows.join("\n");
const read = (files, leftOut) => readPackages(files.map(([path, text]) => ({ path, text })), leftOut);
const config = (ecosystem, file, line, kind, address, extra = {}) => ({ ecosystem, file, line, from: "config", kind, address, ...extra });
const npmConfig = (file) => (line, kind, address, extra) => config("npm", file, line, kind, address, extra);
const pypiConfig = (file) => (line, kind, address, extra) => config("PyPI", file, line, kind, address, extra);
const hidden = (result, ...secrets) => {
  const json = JSON.stringify(result);
  for (const secret of secrets) assert.ok(!json.includes(secret), secret);
};
// A config file holding one line it cannot read, at `line`: reported as such, and once in couldNotRead.
const assertUnreadableAt = (ecosystem, file, text, line, label = text) => {
  const result = read([[file, text]]);
  assert.deepEqual(result.sourced, [config(ecosystem, file, line, "unreadable", null)], label);
  assert.deepEqual(result.couldNotRead, [{ file, reason: UNREADABLE_SOURCE }], label);
};

// .npmrc

test(".npmrc: each key that names where packages come from, with its line; auth lines are never read", () => {
  const text = lines(
    "; a comment",
    "# another",
    "registry=https://npm.example.com/SECRET/",
    "@myco:registry = https://npm.myco.example/",
    "replace-registry-host=npm.mirror.example",
    "omit-lockfile-registry-resolved=true",
    "//npm.example.com/:_authToken=SECRET",
    "_auth=SECRET",
    "  _password = SECRET",
    "email=someone@example.com",
    "save-exact=true",
  );
  const at = npmConfig("app/.npmrc");
  const result = read([["app/.npmrc", text]]);
  assert.deepEqual(result, {
    ...EMPTY,
    sourced: [
      at(3, "host", "https://npm.example.com"),
      at(4, "host", "https://npm.myco.example", { scope: "@myco" }),
      at(5, "host", "https://npm.mirror.example"),
      at(6, "host", null, { text: "hides the registry from package-lock.json" }),
    ],
  });
  hidden(result, "SECRET");
});

test(".npmrc: Windows line endings, spaces around =, and quoted values read the same", () => {
  const at = npmConfig(".npmrc");
  for (const text of [
    "registry=https://npm.example.com\r\n@s:registry=https://s.example\r\n",
    '  registry = "https://npm.example.com"  \n@s:registry=\'https://s.example\'\n',
  ]) {
    assert.deepEqual(read([[".npmrc", text]]).sourced, [at(1, "host", "https://npm.example.com"), at(2, "host", "https://s.example", { scope: "@s" })], text);
  }
});

test(".npmrc: the official registry, and settings that redirect nothing, give no entry", () => {
  const text = lines(
    "registry=https://registry.npmjs.org/",
    '@s:registry="https://registry.npmjs.org"',
    "registry = 'https://registry.yarnpkg.com'",
    "replace-registry-host=never",
    "replace-registry-host=npmjs",
    "replace-registry-host=always",
    "replace-registry-host=registry.npmjs.org",
    "omit-lockfile-registry-resolved=false",
  );
  assert.deepEqual(read([[".npmrc", text]]), EMPTY);
});

test(".npmrc: plain http is reported as http", () => {
  assert.deepEqual(read([[".npmrc", "registry=http://npm.example.com/\n"]]).sourced, [npmConfig(".npmrc")(1, "http", "http://npm.example.com")]);
});

test(".npmrc: a line that sets a registry setting in a form it does not model is one it cannot read", () => {
  const cases = [
    ["registry=${NPM_REGISTRY}", 1],
    ["@s:registry=https://${HOST}/", 1],
    ['registry="https://x.example', 1],
    ["registry=https://x\\.example", 1],
    ["registry[]=https://x.example", 1],
    ["REGISTRY=https://x.example", 1],
    ["replace_registry_host=x.example", 1],
    ["registry", 1],
    ["registry=", 1],
    ["[section]\nregistry=https://x.example", 2],
    ["${KEY}=https://x.example", 1],
    ["myco:registry=https://x.example", 1],
    ["@my co:registry=https://x.example", 1],
    ["replace-registry-host=https://x.example", 1],
    ["replace-registry-host=", 1],
    ["omit-lockfile-registry-resolved=yes", 1],
    ["registry=git+https://x.example/r.git", 1],
    ["registry=file:./mirror", 1],
    ["registry=not a url", 1],
    ["save=true\rregistry=${X}", 2],
  ];
  for (const [text, line] of cases) assertUnreadableAt("npm", ".npmrc", text, line);
});

// .yarnrc

test(".yarnrc: the registry and a scope's registry, with their lines; auth lines are never read", () => {
  const text = lines(
    "# THIS IS AN AUTOGENERATED FILE.",
    'registry "https://yarn.example.com/SECRET/"',
    '"@myco:registry" "https://myco.example/" # mirror',
    '"//yarn.example.com/:_authToken" "SECRET"',
    "_authToken SECRET",
    "network-timeout 600000",
    'yarn-path ".yarn/releases/yarn-1.22.19.cjs"',
  );
  const at = npmConfig(".yarnrc");
  const result = read([[".yarnrc", text]]);
  assert.deepEqual(result, { ...EMPTY, sourced: [at(2, "host", "https://yarn.example.com"), at(3, "host", "https://myco.example", { scope: "@myco" })] });
  hidden(result, "SECRET");
});

test(".yarnrc: the official registry gives no entry", () => {
  assert.deepEqual(read([[".yarnrc", 'registry "https://registry.yarnpkg.com"\n"@s:registry" "https://registry.npmjs.org/"\n']]), EMPTY);
});

test(".yarnrc: a registry setting in a form it does not model is one it cannot read", () => {
  const cases = [
    ["registry https://x.example", 1],
    ['registry "${REGISTRY}"', 1],
    ['--registry "https://x.example"', 1],
    ['--install.registry "https://x.example"', 1],
    ['"registry" "https://x\\u002eexample"', 1],
    ['@myco:registry "https://x.example"', 1],
    ['registry: "https://x.example"', 1],
    ['Registry "https://x.example"', 1],
    ["registry", 1],
    ['save-exact true\nregistry:\n  url "https://x.example"', 2],
  ];
  for (const [text, line] of cases) assertUnreadableAt("npm", ".yarnrc", text, line);
});

// .yarnrc.yml

test(".yarnrc.yml: npmRegistryServer, a scope's server, npmRegistries keys and unsafeHttpWhitelist hosts; auth lines never read", () => {
  const text = lines(
    "yarnPath: .yarn/releases/yarn-4.1.0.cjs",
    'npmRegistryServer: "https://berry.example.com/SECRET"',
    "npmScopes:",
    "  myco:",
    "    npmRegistryServer: https://myco.example",
    "    npmAuthToken: SECRET",
    "npmRegistries:",
    '  "https://reg.example.com":',
    '    npmAuthToken: "SECRET"',
    "    npmAlwaysAuth: true",
    "  //other.example.com:",
    "    npmAuthIdent: SECRET",
    "unsafeHttpWhitelist:",
    '  - "*.example.org"',
    "  - localhost # for tests",
    "packageExtensions:",
    '  "react-dom@*":',
    "    peerDependencies:",
    '      react: "*"',
    "nodeLinker: node-modules",
  );
  const at = npmConfig(".yarnrc.yml");
  const result = read([[".yarnrc.yml", text]]);
  assert.deepEqual(result, {
    ...EMPTY,
    sourced: [
      at(2, "host", "https://berry.example.com"),
      at(5, "host", "https://myco.example", { scope: "@myco" }),
      at(8, "host", "https://reg.example.com"),
      at(11, "host", "https://other.example.com"),
      at(14, "http", "http://*.example.org"),
      at(15, "http", "http://localhost"),
    ],
  });
  hidden(result, "SECRET");
});

test(".yarnrc.yml: other ways YAML writes the same keys read the same", () => {
  const at = npmConfig(".yarnrc.yml");
  const cases = [
    ["npmRegistryServer: 'https://x.example'", [at(1, "host", "https://x.example")]],
    ['"npmRegistryServer": "https://x.example" # mirror', [at(1, "host", "https://x.example")]],
    ["npmRegistryServer : https://x.example", [at(1, "host", "https://x.example")]],
    ["---\nnpmRegistryServer: https://x.example\r\n", [at(2, "host", "https://x.example")]],
    ["unsafeHttpWhitelist:\n- localhost\nnodeLinker: pnp", [at(2, "http", "http://localhost")]],
    ["npmScopes: {}\nunsafeHttpWhitelist: []\nnpmRegistries: {}", []],
    ["npmScopes:\n    myco:\n        npmRegistryServer: https://x.example\n    other:\n        npmPublishRegistry: https://p.example", [at(3, "host", "https://x.example", { scope: "@myco" })]],
  ];
  for (const [text, sourced] of cases) assert.deepEqual(read([[".yarnrc.yml", text]]), { ...EMPTY, sourced }, text);
});

test(".yarnrc.yml: the official registry gives no entry", () => {
  const text = 'npmRegistryServer: "https://registry.yarnpkg.com"\nnpmScopes:\n  s:\n    npmRegistryServer: https://registry.npmjs.org\n';
  assert.deepEqual(read([[".yarnrc.yml", text]]), EMPTY);
});

test(".yarnrc.yml: YAML it does not model where a registry can be named is one it cannot read", () => {
  const cases = [
    ["npmRegistryServer: &a https://x.example", 1],
    ["npmRegistryServer: *a", 1],
    ["npmRegistryServer: !!str https://x.example", 1],
    ["npmRegistryServer: |\n  https://x.example", 1],
    ["npmRegistryServer: >-\n  https://x.example", 1],
    ["npmRegistryServer:\n  https://x.example", 1],
    ["npmRegistryServer: https://x.example\n  .evil.example", 2],
    ['npmRegistryServer: "https://x\\u002eexample"', 1],
    ['"npmRegistry\\u0053erver": https://x.example', 1],
    ['npmRegistryServer: "${NPM_REGISTRY:-https://x.example}"', 1],
    ["npmRegistryServer: {url: x}", 1],
    ["npmRegistryServer: 'https://x.example", 1],
    ['npmScopes: {myco: {npmRegistryServer: "https://x.example"}}', 1],
    ['npmScopes:\n  myco: {npmRegistryServer: "https://x.example"}', 2],
    ["npmScopes:\n  myco:\n    npmRegistryServer:\n      https://x.example", 3],
    ["npmScopes:\n  myco:\n     npmRegistryServer: https://x.example\n    npmAlwaysAuth: true", 4],
    ["npmScopes:\n  myco:\n    npmRegistryServer: https://x.example\n      more: x", 4],
    ["npmScopes:\n  &s myco:\n    npmRegistryServer: https://x.example", 2],
    ["npmRegistries:\n  ? https://x.example\n  : {}", 2],
    ["unsafeHttpWhitelist: [x.example]", 1],
    ["unsafeHttpWhitelist:\n  - *.example.org", 2],
    ["unsafeHttpWhitelist:\n  - a: b", 2],
    ["unsafeHttpWhitelist:\n  - ${HOST}", 2],
    ["unsafeHttpWhitelist:\n  - x.example/path", 2],
    ["\tnpmRegistryServer: https://x.example", 1],
    ["nodeLinker: pnp\rnpmRegistryServer: https://x.example", 1],
    ["<<: *defaults", 1],
    ["? npmRegistryServer\n: https://x.example", 1],
    ["%YAML 1.2\n---\nnodeLinker: pnp", 1],
    ["- npmRegistryServer", 1],
    ["nodeLinker: pnp\n---\nnpmRegistryServer: https://x.example", 2],
    ["npmRegistryServer:x", 1],
  ];
  for (const [text, line] of cases) assertUnreadableAt("npm", ".yarnrc.yml", text, line);
});

// uv.toml and pyproject.toml

test("uv.toml: index-url, extra-index-url, find-links and [[index]] urls; PyPI's index gives nothing; a folder of archives is bundled", () => {
  const text = lines(
    'index-url = "https://uv.example.com/simple"',
    'extra-index-url = ["https://pypi.org/simple", "https://user:SECRET@extra.example.com/simple"]',
    "find-links = [",
    '  "./wheels",',
    '  "https://pypi.org/simple/x/",',
    "]",
    "",
    "[[index]]",
    'name = "torch"',
    'url = "https://download.pytorch.org/whl/cpu"',
    "",
    "[[index]]",
    'name = "flat"',
    'url = "https://flat.example.com/links"',
    'format = "flat"',
    "",
    "[[index]]",
    'url = "https://pypi.org/simple"',
    "cache-control = { api = \"max-age=600\" }",
  );
  const at = pypiConfig("svc/uv.toml");
  const result = read([["svc/uv.toml", text]]);
  assert.deepEqual(result, {
    ...EMPTY,
    sourced: [
      at(1, "host", "https://uv.example.com"),
      at(2, "host", "https://extra.example.com"),
      at(4, "bundled", "svc/wheels", { text: "a bundled package file the scan cannot read" }),
      at(5, "host", "https://pypi.org"),
      at(10, "host", "https://download.pytorch.org"),
      at(14, "host", "https://flat.example.com"),
    ],
  });
  hidden(result, "SECRET");
});

test("uv.toml: an index set from an environment variable is reported as one", () => {
  assert.deepEqual(read([["uv.toml", 'index-url = "${UV_MIRROR}/simple"\n']]).sourced, [
    pypiConfig("uv.toml")(1, "host", null, { text: "an index set from an environment variable" }),
  ]);
});

test("uv.toml: an index setting in a shape uv does not take is one it cannot read", () => {
  const cases = [
    ["index-url = 1", 1],
    ['index-url = """https://x.example/simple"""', 1],
    ['index-url = ["https://x.example/simple"]', 1],
    ['extra-index-url = "https://x.example/simple"', 1],
    ["extra-index-url = [1]", 1],
    ['find-links = ["https://x.example", { url = "y" }]', 1],
    ['index-url.x = "https://x.example/simple"', 1],
    ['[index]\nurl = "https://x.example/simple"', 2],
    ['[[index]]\nname = "x"', 2],
    ['[[index]]\nurl = { a = "https://x.example" }', 2],
    ['index = ["https://x.example/simple"]', 1],
    ['index = [{ name = "x" }]', 1],
    ['index-url = "https://x.example/\\q"', 1],
  ];
  for (const [text, line] of cases) assertUnreadableAt("PyPI", "uv.toml", text, line);
});

test("uv.toml that is not TOML it can read could not be read", () => {
  assert.deepEqual(read([["uv.toml", 'index-url = "https://x.example\n']]), { ...EMPTY, couldNotRead: [{ file: "uv.toml", reason: "not TOML it can read" }] });
});

test("pyproject.toml: [tool.uv], [[tool.uv.index]], [[tool.poetry.source]] and [[tool.pdm.source]] are read even with a lockfile", () => {
  const text = lines(
    "[project]",
    'name = "t"',
    'dependencies = ["httpx"]',
    "",
    "[tool.uv]",
    'index-url = "https://uv.example.com/simple"',
    'find-links = ["wheels"]',
    "",
    "[[tool.uv.index]]",
    'name = "torch"',
    'url = "https://download.pytorch.org/whl/cpu"',
    "",
    "[[tool.poetry.source]]",
    'name = "PyPI"',
    'priority = "primary"',
    "",
    "[[tool.poetry.source]]",
    'name = "corp"',
    'url = "https://poetry.example.com/simple/"',
    'priority = "supplemental"',
    "",
    "[[tool.pdm.source]]",
    'name = "local"',
    'url = "file:///${PROJECT_ROOT}/dist"',
    'type = "find_links"',
    "",
    "[[tool.pdm.source]]",
    'name = "pypi"',
    'url = "https://pdm.example.com/simple"',
  );
  const uvLock = 'version = 1\n\n[[package]]\nname = "httpx"\nversion = "0.27.0"\nsource = { registry = "https://pypi.org/simple" }\n';
  const at = pypiConfig("pyproject.toml");
  const result = read([["pyproject.toml", text], ["uv.lock", uvLock]]);
  assert.deepEqual(result, {
    ...EMPTY,
    packages: [{ ecosystem: "PyPI", name: "httpx", version: "0.27.0", file: "uv.lock", line: 4 }],
    sourced: [
      at(6, "host", "https://uv.example.com"),
      at(7, "bundled", "wheels", { text: "a bundled package file the scan cannot read" }),
      at(11, "host", "https://download.pytorch.org"),
      at(19, "host", "https://poetry.example.com"),
      at(24, "bundled", "dist", { text: "a bundled package file the scan cannot read" }),
      at(29, "host", "https://pdm.example.com"),
    ],
  });
});

test("pyproject.toml with no lockfile: a named index is reported for the dependency and for the config", () => {
  const text = lines(
    "[project]",
    'dependencies = ["torch"]',
    "[tool.uv.sources]",
    'torch = { index = "torch" }',
    "[[tool.uv.index]]",
    'name = "torch"',
    'url = "https://download.pytorch.org/whl/cpu"',
  );
  assert.deepEqual(read([["pyproject.toml", text]]).sourced, [
    { ecosystem: "PyPI", file: "pyproject.toml", line: 4, name: "torch", version: null, kind: "host", address: "https://download.pytorch.org" },
    pypiConfig("pyproject.toml")(7, "host", "https://download.pytorch.org"),
  ]);
});

test("pyproject.toml: a source table in a shape the tools do not take is one it cannot read", () => {
  const cases = [
    ['[tool.poetry.source]\nname = "x"\nurl = "https://x.example/simple"', 2],
    ['[[tool.poetry.source]]\nname = "corp"', 2],
    ['[[tool.pdm.source]]\nname = "x"\nurl = "https://x.example/simple"\ntype = "other"', 3],
    ['[[tool.pdm.source]]\nname = "x"', 2],
    ['[tool.uv]\nextra-index-url = "https://x.example/simple"', 2],
    ['[tool.uv.index]\nurl = "https://x.example/simple"', 2],
  ];
  for (const [text, line] of cases) assertUnreadableAt("PyPI", "pyproject.toml", text, line);
});

test("pip.conf is not read", () => {
  assert.deepEqual(read([["pip.conf", "[global]\nindex-url = https://pip.example.com/simple\n"]]), EMPTY);
});

// pnpm-workspace.yaml

test("pnpm-workspace.yaml: packages folders outside the repository are reported when there is no pnpm lockfile", () => {
  const text = lines(
    "packages:",
    "  - 'packages/*'",
    '  - "../outside/*"',
    "  - apps/**",
    "  - '!**/test/**'",
    "catalog:",
    "  react: ^18.2.0",
  );
  const outside = { ecosystem: "npm", file: "pnpm-workspace.yaml", line: 3, name: null, version: null, kind: "url", address: null, text: "a path outside the project" };
  const catalogName = { ecosystem: "npm", name: "react", version: null, file: "pnpm-workspace.yaml", line: null };
  assert.deepEqual(read([["pnpm-workspace.yaml", text]]), { ...EMPTY, packages: [catalogName], namesOnly: ["pnpm-workspace.yaml"], sourced: [outside] });
  const lock = "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n";
  assert.deepEqual(read([["pnpm-workspace.yaml", text], ["pnpm-lock.yaml", lock]]), EMPTY);
  assert.deepEqual(read([["pnpm-workspace.yaml", text]], [{ path: "pnpm-lock.yaml", reason: "larger than 5 MB" }]).sourced, []);
});

test("pnpm-workspace.yaml: packages in a shape it does not model is one it cannot read", () => {
  const unread = (line) => ({ ecosystem: "npm", file: "pnpm-workspace.yaml", line, name: null, version: null, kind: "unreadable", address: null });
  const cases = [
    ["packages: ['a', '../b']", 1],
    ["packages:\n  - *outside", 2],
    ["packages:\n  - a: b", 2],
    ["packages: ../b", 1],
    ["packages:\n  - |\n    ../b", 2],
  ];
  for (const [text, line] of cases) {
    const result = read([["pnpm-workspace.yaml", text]]);
    assert.deepEqual(result.sourced, [unread(line)], text);
    assert.deepEqual(result.couldNotRead, [{ file: "pnpm-workspace.yaml", reason: UNREADABLE_SOURCE }], text);
  }
});

// Files left out

test("a config file or manifest left out of the file list is reported as not checked", () => {
  const leftOut = [
    { path: ".npmrc", reason: "larger than 5 MB" },
    { path: "package.json", reason: "larger than 5 MB" },
    { path: "a/pyproject.toml", reason: "symbolic link, not followed" },
    { path: ".yarnrc", reason: "larger than 5 MB" },
    { path: ".yarnrc.yml", reason: "larger than 5 MB" },
    { path: "uv.toml", reason: "larger than 5 MB" },
    { path: "pnpm-workspace.yaml", reason: "larger than 5 MB" },
    { path: "node_modules/x/.npmrc", reason: "larger than 5 MB" },
  ];
  assert.deepEqual(read([], leftOut).couldNotRead, [
    { file: ".npmrc", reason: "larger than 5 MB, not checked" },
    { file: "package.json", reason: "larger than 5 MB, not checked" },
    { file: "a/pyproject.toml", reason: "symbolic link, not followed, not checked" },
    { file: ".yarnrc", reason: "larger than 5 MB, not checked" },
    { file: ".yarnrc.yml", reason: "larger than 5 MB, not checked" },
    { file: "uv.toml", reason: "larger than 5 MB, not checked" },
    { file: "pnpm-workspace.yaml", reason: "larger than 5 MB, not checked" },
  ]);
});

test("config files in vendored folders are not read", () => {
  assert.deepEqual(read([["node_modules/x/.npmrc", "registry=https://x.example\n"], ["vendor/.yarnrc.yml", "npmRegistryServer: https://x.example\n"]]), EMPTY);
});

// Registry not recorded

const npmLock = (packages) => JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "t" }, ...packages } }, null, 2);
const NO_RESOLVED = npmLock({ "node_modules/a": { version: "1.0.0" }, "node_modules/@myco/b": { version: "2.0.0" } });
const BERRY = lines(
  "__metadata:",
  "  version: 8",
  "",
  '"a@npm:^1.0.0":',
  "  version: 1.0.0",
  '  resolution: "a@npm:1.0.0"',
);
const PNPM = "lockfileVersion: '9.0'\n\npackages:\n\n  a@1.0.0:\n    resolution: {integrity: sha512-x}\n";
const NOTE = (file) => ({ file, ecosystem: "npm" });

test("registry not recorded: with no config, a lockfile that records no host gets a note; its packages still go to OSV", () => {
  const result = read([["app/package-lock.json", NO_RESOLVED], ["yarn.lock", BERRY], ["p/pnpm-lock.yaml", PNPM]]);
  assert.deepEqual(result.notRecorded, [NOTE("app/package-lock.json"), NOTE("yarn.lock"), NOTE("p/pnpm-lock.yaml")]);
  assert.deepEqual(result.packages.map((p) => p.name), ["a", "@myco/b"]);
  assert.deepEqual(result.sourced, []);
});

test("registry not recorded: a config in the lockfile's folder or above naming a mirror covers it, with the config entry", () => {
  const files = [
    ["app/package-lock.json", NO_RESOLVED],
    ["p/pnpm-lock.yaml", PNPM],
    [".npmrc", "registry=https://mirror.example.com/\n"],
    ["yarn.lock", BERRY],
    [".yarnrc.yml", "npmRegistryServer: https://berry.example.com\n"],
  ];
  const result = read(files);
  assert.deepEqual(result.notRecorded, []);
  assert.deepEqual(result.packages.map((p) => p.name), ["a", "@myco/b"]);
  assert.deepEqual(result.sourced, [npmConfig(".npmrc")(1, "host", "https://mirror.example.com"), npmConfig(".yarnrc.yml")(1, "host", "https://berry.example.com")]);
});

test("registry not recorded: a config naming the official registry gives neither a note nor an entry", () => {
  const files = [
    ["package-lock.json", NO_RESOLVED],
    [".npmrc", "registry=https://registry.npmjs.org/\n"],
    ["yarn.lock", BERRY],
    [".yarnrc.yml", 'npmRegistryServer: "https://registry.yarnpkg.com"\n'],
  ];
  const result = read(files);
  assert.deepEqual([result.notRecorded, result.sourced], [[], []]);
});

test("registry not recorded: a config elsewhere, a config of the other tool, or a scope's registry alone does not cover it", () => {
  assert.deepEqual(read([["app/package-lock.json", NO_RESOLVED], ["other/.npmrc", "registry=https://m.example\n"]]).notRecorded, [NOTE("app/package-lock.json")]);
  assert.deepEqual(read([["yarn.lock", BERRY], [".npmrc", "registry=https://m.example\n"]]).notRecorded, [NOTE("yarn.lock")]);
  assert.deepEqual(read([["package-lock.json", NO_RESOLVED], [".npmrc", "@myco:registry=https://m.example\n"]]).notRecorded, [NOTE("package-lock.json")]);
  const yml = "npmScopes:\n  myco:\n    npmRegistryServer: https://m.example\n";
  assert.deepEqual(read([["yarn.lock", BERRY], [".yarnrc.yml", yml]]).notRecorded, [NOTE("yarn.lock")]);
});

test("registry not recorded: a scope's registry covers a lockfile whose unrecorded packages are all in that scope", () => {
  const scoped = npmLock({ "node_modules/@myco/b": { version: "2.0.0" }, "node_modules/c": { version: "1.0.0", resolved: "https://registry.npmjs.org/c/-/c-1.0.0.tgz" } });
  assert.deepEqual(read([["package-lock.json", scoped], [".npmrc", "@myco:registry=https://m.example\n"]]).notRecorded, []);
});

test("registry not recorded: a registry line it cannot read covers the lockfile, since it is reported itself", () => {
  const result = read([["package-lock.json", NO_RESOLVED], [".npmrc", "registry=${NPM_REGISTRY}\n"]]);
  assert.deepEqual(result.notRecorded, []);
  assert.deepEqual(result.sourced, [npmConfig(".npmrc")(1, "unreadable", null)]);
});

test("registry not recorded: npm entries that are bundled or linked, and lockfiles that record every host, get no note", () => {
  const bundledOnly = npmLock({
    "node_modules/a": { version: "1.0.0", resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" },
    "node_modules/a/node_modules/b": { version: "1.0.0", inBundle: true },
    "node_modules/w": { link: true, resolved: "packages/w" },
  });
  const result = read([["package-lock.json", bundledOnly]]);
  assert.deepEqual([result.notRecorded, result.packages.map((p) => p.name)], [[], ["a", "b"]]);
  const classic = '# yarn lockfile v1\n\na@^1.0.0:\n  version "1.0.0"\n  resolved "https://registry.yarnpkg.com/a/-/a-1.0.0.tgz#abc"\n';
  assert.deepEqual(read([["yarn.lock", classic]]).notRecorded, []);
});

test("registry not recorded: omit-lockfile-registry-resolved is reported and does not cover the lockfile", () => {
  const result = read([["package-lock.json", NO_RESOLVED], [".npmrc", "omit-lockfile-registry-resolved=true\n"]]);
  assert.deepEqual(result.notRecorded, [NOTE("package-lock.json")]);
  assert.deepEqual(result.sourced, [npmConfig(".npmrc")(1, "host", null, { text: "hides the registry from package-lock.json" })]);
});

// Hostile input

const quickly = (fn, ms = 5000) => {
  const start = Date.now();
  const value = fn();
  const took = Date.now() - start;
  assert.ok(took < ms, `took ${took} ms`);
  return value;
};

test("config files with lines millions of characters long, or nested 2,000 levels deep, are read quickly", () => {
  const long = "x".repeat(4 * 1024 * 1024);
  quickly(() => read([[".npmrc", `registry=https://${long}`], [".yarnrc", `registry "${long}`], [".yarnrc.yml", `npmRegistryServer: "${long}`]]));
  quickly(() => read([[".npmrc", `[${" ".repeat(4 * 1024 * 1024)}x`], [".yarnrc.yml", `unsafeHttpWhitelist:\n  - ${long} #${long}`]]));
  const deep = ["npmScopes:", ...Array.from({ length: 2000 }, (_, i) => `${" ".repeat(2 * (i + 1))}s${i}:`)].join("\n");
  assert.deepEqual(quickly(() => read([[".yarnrc.yml", deep]])).sourced, [config("npm", ".yarnrc.yml", 3, "unreadable", null)]);
  const many = ["packages:", ...Array.from({ length: 50000 }, (_, i) => `  - "../p${i}"`)].join("\n");
  assert.equal(quickly(() => read([["pnpm-workspace.yaml", many]])).sourced.length, 50000);
});

test("keys named like built-in object properties are plain names", () => {
  const npmrc = "__proto__=https://x.example\nconstructor=https://x.example\n@s:registry=https://s.example\n";
  assert.deepEqual(read([[".npmrc", npmrc]]).sourced, [npmConfig(".npmrc")(3, "host", "https://s.example", { scope: "@s" })]);
  const yml = "__proto__:\n  npmRegistryServer: https://x.example\nnpmScopes:\n  __proto__:\n    npmRegistryServer: https://p.example\n";
  assert.deepEqual(read([[".yarnrc.yml", yml]]).sourced, [npmConfig(".yarnrc.yml")(5, "host", "https://p.example", { scope: "@__proto__" })]);
});

// Review fixes

const OUTSIDE = { text: "a path outside the project" };
const BUNDLED = { text: "a bundled package file the scan cannot read" };
const pkg = (file) => (name, line, kind, address, extra = {}) => ({ ecosystem: "npm", file, line, name, version: null, kind, address, ...extra });

test("auth settings are known by the setting after the last colon, so a scope named like one is still read", () => {
  const npmrc = lines(
    "@x_auth:registry=https://evil.example/",
    "@y_password:registry=https://evil2.example/",
    "//npm.example.com/:_authToken=SECRET",
    "//npm.example.com/:_auth=SECRET",
    "//npm.example.com/:_password=SECRET",
    "//npm.example.com/:username=SECRET",
    "//npm.example.com/:email=SECRET",
    "//npm.example.com/:certfile=SECRET",
    "//npm.example.com/:keyfile=SECRET",
    "_auth=SECRET",
    "_authToken=SECRET",
    "username=SECRET",
  );
  const result = read([[".npmrc", npmrc]]);
  assert.deepEqual(result.sourced, [
    npmConfig(".npmrc")(1, "host", "https://evil.example", { scope: "@x_auth" }),
    npmConfig(".npmrc")(2, "host", "https://evil2.example", { scope: "@y_password" }),
  ]);
  hidden(result, "SECRET");
  const yarnrc = '"@x_auth:registry" "https://evil.example/"\n"//npm.example.com/:_authToken" "SECRET"\n';
  const yarn = read([[".yarnrc", yarnrc]]);
  assert.deepEqual(yarn.sourced, [npmConfig(".yarnrc")(1, "host", "https://evil.example", { scope: "@x_auth" })]);
  hidden(yarn, "SECRET");
  assertUnreadableAt("npm", ".npmrc", "//npm.example.com/:registry=https://x.example/", 1);
});

const WORKSPACE_REGISTRIES = lines(
  "packages:",
  '  - "apps/*"',
  "registry: https://pnpm.example.com/",
  "registries:",
  "  https://artifactory.example.com/artifactory/api/npm/npm-virtual/:",
  "    serverType: artifactory",
  "    scopes: ['@acme', \"@acme-internal\"]",
  "    prefix: work",
  "  https://scoped.example.com/:",
  "    scopes:",
  '      - "@other"',
  "    networkConcurrency: 4",
  "    supportsTimeField: true",
  "  '@legacy': https://legacy.example.com/",
  "  https://registry.npmjs.org/:",
  "    scopes: ['@']",
  "    ecosystem: npm",
  "namedRegistries:",
  "  corp: https://named.example.com/",
);

test("pnpm-workspace.yaml: registry, registries (keyed by URL, or the older scope map) and namedRegistries, with or without a lockfile", () => {
  const at = npmConfig("pnpm-workspace.yaml");
  const expected = [
    at(3, "host", "https://pnpm.example.com"),
    at(5, "host", "https://artifactory.example.com"),
    at(9, "host", "https://scoped.example.com"),
    at(14, "host", "https://legacy.example.com", { scope: "@legacy" }),
    at(19, "host", "https://named.example.com"),
  ];
  assert.deepEqual(read([["pnpm-workspace.yaml", WORKSPACE_REGISTRIES]]), { ...EMPTY, sourced: expected });
  const lock = "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n";
  assert.deepEqual(read([["pnpm-workspace.yaml", WORKSPACE_REGISTRIES], ["pnpm-lock.yaml", lock]]).sourced, expected);
});

test("pnpm-workspace.yaml: a registry setting in a shape it does not model is one it cannot read", () => {
  const cases = [
    ["registry: ${PNPM_REGISTRY}", 1],
    ["registry: *r", 1],
    ["registries: {a: b}", 1],
    ["registries:\n  https://x.example/:\n    token: abc", 3],
    ["registries:\n  https://x.example/:\n    scopes: [{a: b}]", 3],
    ["registries:\n  https://x.example/:\n    scopes: [acme]", 3],
    ["registries:\n  https://x.example/:\n    scopes: ['@a'] # c", 3],
    ["registries:\n  https://x.example/:\n    ecosystem: cargo", 3],
    ["registries:\n  notaurl:\n    scopes: ['@a']", 2],
    ["registries:\n  '@legacy':\n    scopes: ['@a']", 2],
    ["namedRegistries:\n  corp: *x", 2],
    ["namedRegistries: {corp: https://x.example}", 1],
    ["packages:\n\t- ../b", 2],
  ];
  for (const [text, line] of cases) assertUnreadableAt("npm", "pnpm-workspace.yaml", text, line);
});

test("pnpm-workspace.yaml: catalogs and overrides from outside the registry are reported, named by the package", () => {
  const text = lines(
    "catalog:",
    "  react: ^18.2.0",
    "  left-pad: github:u/left-pad",
    '  "@s/x": npm:@s/real@^1',
    "catalogs:",
    "  legacy:",
    "    tiny: https://files.example.com/tiny-1.0.0.tgz",
    "    local: link:../outside",
    "overrides:",
    '  "foo>bar": git+https://github.com/u/bar.git',
    '  baz: "-"',
    "  qux: ./vendor/qux-1.0.0.tgz",
  );
  const at = pkg("pnpm-workspace.yaml");
  const expected = [
    at("left-pad", 3, "git", "https://github.com/u/left-pad"),
    at("tiny", 7, "url", "https://files.example.com/tiny-1.0.0.tgz"),
    at("local", 8, "url", null, OUTSIDE),
    at("bar", 10, "git", "https://github.com/u/bar.git"),
    at("qux", 12, "bundled", "vendor/qux-1.0.0.tgz", BUNDLED),
  ];
  const names = ["react", "@s/real"].map((name) => ({ ecosystem: "npm", name, version: null, file: "pnpm-workspace.yaml", line: null }));
  assert.deepEqual(read([["pnpm-workspace.yaml", text]]), { ...EMPTY, packages: names, namesOnly: ["pnpm-workspace.yaml"], sourced: expected });
  const lock = "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n";
  assert.deepEqual(read([["pnpm-workspace.yaml", text], ["pnpm-lock.yaml", lock]]).sourced, expected);
  const unread = (line) => pkg("pnpm-workspace.yaml")(null, line, "unreadable", null);
  for (const [bad, line] of [["catalog:\n  x: *a", 2], ["catalogs:\n  legacy: {x: y}", 2], ["overrides: {a: b}", 1], ["catalog:\n  x: >=1.0.0", 2]]) {
    const result = read([["pnpm-workspace.yaml", bad]]);
    assert.deepEqual(result.sourced, [unread(line)], bad);
    assert.deepEqual(result.couldNotRead, [{ file: "pnpm-workspace.yaml", reason: UNREADABLE_SOURCE }], bad);
  }
});

test("registry not recorded: pnpm-workspace.yaml's registry, or a registries entry routing the default scope, covers a pnpm lockfile", () => {
  const lock = (file) => [file, PNPM];
  assert.deepEqual(read([lock("pnpm-lock.yaml"), ["pnpm-workspace.yaml", "registry: https://m.example/\n"]]).notRecorded, []);
  const routed = "registries:\n  https://m.example/:\n    scopes: ['@']\n";
  assert.deepEqual(read([lock("pnpm-lock.yaml"), ["pnpm-workspace.yaml", routed]]).notRecorded, []);
  const scoped = "registries:\n  https://m.example/:\n    scopes: ['@acme']\n";
  assert.deepEqual(read([lock("pnpm-lock.yaml"), ["pnpm-workspace.yaml", scoped]]).notRecorded, [NOTE("pnpm-lock.yaml")]);
  const named = "namedRegistries:\n  corp: https://m.example/\n";
  assert.deepEqual(read([lock("pnpm-lock.yaml"), ["pnpm-workspace.yaml", named]]).notRecorded, [NOTE("pnpm-lock.yaml")]);
  assert.deepEqual(read([lock("pnpm-lock.yaml"), ["pnpm-workspace.yaml", "registry: ${R}\n"]]).notRecorded, []);
});

test("uv's [pip] settings in uv.toml and [tool.uv.pip] in pyproject.toml are read", () => {
  const uv = '[pip]\nindex-url = "https://pip.example.com/simple"\nextra-index-url = ["https://e.example.com/simple"]\nfind-links = ["./w"]\n';
  const at = pypiConfig("uv.toml");
  assert.deepEqual(read([["uv.toml", uv]]).sourced, [
    at(2, "host", "https://pip.example.com"),
    at(3, "host", "https://e.example.com"),
    at(4, "bundled", "w", BUNDLED),
  ]);
  const pyproject = '[tool.uv.pip]\nindex-url = "https://pip.example.com/simple"\n';
  assert.deepEqual(read([["pyproject.toml", pyproject]]).sourced, [pypiConfig("pyproject.toml")(2, "host", "https://pip.example.com")]);
  assertUnreadableAt("PyPI", "uv.toml", "[pip]\nindex-url = 1", 2);
});

test("pdm.toml's [pypi] and [pypi.<name>] urls, and pyproject.toml's [[tool.rye.sources]], are read as indexes", () => {
  const pdm = lines(
    "[pypi]",
    'url = "https://pdm.example.com/simple"',
    "verify_ssl = true",
    "",
    "[pypi.extra]",
    'url = "https://extra.example.com/simple"',
    'username = "SECRET"',
    'password = "SECRET"',
  );
  const result = read([["pdm.toml", pdm]]);
  assert.deepEqual(result.sourced, [pypiConfig("pdm.toml")(2, "host", "https://pdm.example.com"), pypiConfig("pdm.toml")(6, "host", "https://extra.example.com")]);
  hidden(result, "SECRET");
  assert.deepEqual(read([["pdm.toml", '[pypi]\nurl = "https://pypi.org/simple"\n']]), EMPTY);
  for (const [text, line] of [["[pypi]\nurl = 1", 2], ['pypi.url.x = "https://x.example"', 1], ['[[pypi]]\nurl = "https://x.example"', 2], ['pypi = "https://x.example"', 1]]) {
    assertUnreadableAt("PyPI", "pdm.toml", text, line);
  }
  const rye = lines(
    "[[tool.rye.sources]]",
    'name = "corp"',
    'url = "https://rye.example.com/simple"',
    "[[tool.rye.sources]]",
    'name = "links"',
    'url = "https://links.example.com/"',
    'type = "find-links"',
  );
  assert.deepEqual(read([["pyproject.toml", rye]]).sourced, [
    pypiConfig("pyproject.toml")(3, "host", "https://rye.example.com"),
    pypiConfig("pyproject.toml")(6, "host", "https://links.example.com"),
  ]);
  assertUnreadableAt("PyPI", "pyproject.toml", '[[tool.rye.sources]]\nname = "x"', 2);
  assertUnreadableAt("PyPI", "pyproject.toml", '[[tool.rye.sources]]\nurl = "https://x.example"\ntype = "other"', 2);
});

test("uv: an [index.cache-control] table after [[index]] belongs to that index", () => {
  const uv = '[[index]]\nname = "x"\nurl = "https://i.example.com/simple"\n[index.cache-control]\napi = "max-age=600"\n';
  assert.deepEqual(read([["uv.toml", uv]]), { ...EMPTY, sourced: [pypiConfig("uv.toml")(3, "host", "https://i.example.com")] });
  const pyproject = '[[tool.uv.index]]\nname = "x"\nurl = "https://i.example.com/simple"\n[tool.uv.index.cache-control]\napi = "max-age=600"\n';
  assert.deepEqual(read([["pyproject.toml", pyproject]]).sourced, [pypiConfig("pyproject.toml")(3, "host", "https://i.example.com")]);
  assertUnreadableAt("PyPI", "uv.toml", '[index.cache-control]\napi = "max-age=600"', 2);
});

test("registry not recorded: npm takes the .npmrc of the nearest folder with a package.json, else the root; pnpm and Berry any folder above", () => {
  const mirror = "registry=https://m.example/\n";
  const pj = '{ "name": "t" }';
  assert.deepEqual(read([["package.json", pj], ["app/package.json", pj], ["app/package-lock.json", NO_RESOLVED], [".npmrc", mirror]]).notRecorded, [NOTE("app/package-lock.json")]);
  assert.deepEqual(read([["app/package.json", pj], ["app/package-lock.json", NO_RESOLVED], ["app/.npmrc", mirror]]).notRecorded, []);
  assert.deepEqual(read([["package.json", pj], ["app/sub/package-lock.json", NO_RESOLVED], [".npmrc", mirror]]).notRecorded, []);
  assert.deepEqual(read([["app/package.json", pj], ["app/sub/package-lock.json", NO_RESOLVED], ["app/sub/.npmrc", mirror]]).notRecorded, [NOTE("app/sub/package-lock.json")]);
  assert.deepEqual(read([["app/package.json", pj], ["app/pnpm-lock.yaml", PNPM], [".npmrc", mirror]]).notRecorded, []);
});

test("registry not recorded: any registry line it cannot read covers the lockfile, whatever made it unreadable", () => {
  for (const npmrc of ["[section]\nregistry=https://m.example/", "REGISTRY=https://m.example/", "${KEY}=https://m.example/", "@s:registry=${X}", "myco:registry=https://m.example/"]) {
    const result = read([["package-lock.json", NO_RESOLVED], [".npmrc", npmrc]]);
    assert.deepEqual(result.notRecorded, [], npmrc);
    assert.equal(result.sourced.length, 1, npmrc);
  }
  assert.deepEqual(read([["package-lock.json", NO_RESOLVED], [".npmrc", "replace-registry-host=https://x/\n"]]).notRecorded, [NOTE("package-lock.json")]);
  for (const yml of ["npmRegistryServer: *a", "npmScopes:\n  s:\n    npmRegistryServer: |\n      x", '"npmRegistry\\u0053erver": https://m.example']) {
    assert.deepEqual(read([["yarn.lock", BERRY], [".yarnrc.yml", yml]]).notRecorded, [], yml);
  }
});

// packageExtensions, catalog names, pdm.toml find-links

test("packageExtensions in pnpm-workspace.yaml, .yarnrc.yml and package.json's pnpm field report dependencies from outside the registry", () => {
  const yaml = lines(
    "packageExtensions:",
    '  "react-dom@*":',
    "    dependencies:",
    '      react-is: "*"',
    "      evil: git+https://github.com/u/evil.git",
    "    optionalDependencies:",
    "      tiny: https://files.example.com/tiny-1.0.0.tgz",
    "    peerDependencies:",
    "      far: link:../far",
    "    peerDependenciesMeta:",
    "      far:",
    "        optional: true",
  );
  for (const file of ["pnpm-workspace.yaml", ".yarnrc.yml"]) {
    const at = pkg(file);
    assert.deepEqual(read([[file, yaml]]), {
      ...EMPTY,
      sourced: [at("evil", 5, "git", "https://github.com/u/evil.git"), at("tiny", 7, "url", "https://files.example.com/tiny-1.0.0.tgz"), at("far", 9, "url", null, OUTSIDE)],
    }, file);
  }
  const json = JSON.stringify({ pnpm: { packageExtensions: { "react-dom@*": { dependencies: { "react-is": "*", evil: "git+https://github.com/u/evil.git" }, peerDependenciesMeta: { x: { optional: true } } } } } }, null, 2);
  assert.deepEqual(read([["package.json", json]]).sourced, [pkg("package.json")("evil", 7, "git", "https://github.com/u/evil.git")]);
});

test("packageExtensions in a shape it does not model is one it cannot read", () => {
  const unread = (file, line, name = null) => pkg(file)(name, line, "unreadable", null);
  for (const file of ["pnpm-workspace.yaml", ".yarnrc.yml"]) {
    for (const [text, line] of [
      ["packageExtensions: {a: b}", 1],
      ['packageExtensions:\n  "a@*":\n    devDependencies:\n      x: "1"', 3],
      ['packageExtensions:\n  "a@*":\n    dependencies: {x: "1"}', 3],
      ['packageExtensions:\n  "a@*":\n    dependencies:\n      x: *v', 4],
    ]) {
      const result = read([[file, text]]);
      assert.deepEqual(result.sourced, [unread(file, line)], `${file} ${text}`);
      assert.deepEqual(result.couldNotRead, [{ file, reason: UNREADABLE_SOURCE }], `${file} ${text}`);
    }
  }
  const json = (extensions) => JSON.stringify({ pnpm: { packageExtensions: extensions } }, null, 2);
  assert.deepEqual(read([["package.json", json("x")]]).sourced, [unread("package.json", 3)]);
  assert.deepEqual(read([["package.json", json({ "a@*": { devDependencies: { x: "1" } } })]]).sourced, [unread("package.json", 5)]);
  assert.deepEqual(read([["package.json", json({ "a@*": { dependencies: { x: 1 } } })]]).sourced, [unread("package.json", 6, "x")]);
});

test("catalog entries from the registry go to OSV by name in a pnpm project with no lockfile, and not with one", () => {
  const workspace = lines(
    "catalog:",
    "  react: ^18.2.0",
    "  left-pad: github:u/left-pad",
    "catalogs:",
    "  legacy:",
    '    "@s/x": npm:@s/real@^1',
  );
  const names = (...list) => list.map((name) => ({ ecosystem: "npm", name, version: null, file: "pnpm-workspace.yaml", line: null }));
  const alone = read([["pnpm-workspace.yaml", workspace], ["package.json", '{ "dependencies": { "react": "catalog:" } }']]);
  assert.deepEqual(alone.packages, names("react", "@s/real"));
  assert.deepEqual(alone.namesOnly, ["package.json", "pnpm-workspace.yaml"]);
  assert.deepEqual(alone.sourced, [pkg("pnpm-workspace.yaml")("left-pad", 3, "git", "https://github.com/u/left-pad")]);
  const lock = "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n";
  const locked = read([["pnpm-workspace.yaml", workspace], ["pnpm-lock.yaml", lock]]);
  assert.deepEqual([locked.packages, locked.namesOnly], [[], []]);
  assert.deepEqual(locked.sourced, [pkg("pnpm-workspace.yaml")("left-pad", 3, "git", "https://github.com/u/left-pad")]);
  const npmLocked = read([["pnpm-workspace.yaml", workspace], ["package-lock.json", JSON.stringify({ lockfileVersion: 3, packages: { "": {} } })]]);
  assert.deepEqual([npmLocked.packages, npmLocked.namesOnly], [[], []]);
});

test("pdm.toml: a named index of type find_links is a find-links page", () => {
  const pdm = '[pypi.links]\nurl = "https://pypi.org/simple/x/"\ntype = "find_links"\n[pypi.idx]\nurl = "https://pypi.org/simple"\ntype = "index"\n';
  assert.deepEqual(read([["pdm.toml", pdm]]).sourced, [pypiConfig("pdm.toml")(2, "host", "https://pypi.org")]);
  assertUnreadableAt("PyPI", "pdm.toml", '[pypi.x]\nurl = "https://x.example/simple"\ntype = "other"', 2);
});

// Keys and values as npm's ini reader cuts and decodes them

test(".npmrc: a key and an unquoted value end at an ini comment, as npm's ini reader cuts them, before auth lines are told apart", () => {
  const at = npmConfig(".npmrc");
  for (const text of ["registry=https://x.example ;comment", "registry=https://x.example #comment", "registry#note=https://x.example", "registry ;note=https://x.example"]) {
    assert.deepEqual(read([[".npmrc", text]]).sourced, [at(1, "host", "https://x.example")], text);
  }
  assert.deepEqual(read([[".npmrc", "@myco:registry ;:_authToken=https://evil.example/"]]).sourced, [at(1, "host", "https://evil.example", { scope: "@myco" })]);
  assert.deepEqual(read([[".npmrc", "registry #:_auth=https://evil.example/"]]).sourced, [at(1, "host", "https://evil.example")]);
});

test(".npmrc and .yarnrc: a key holding a quote or backslash, which npm or Yarn decodes, is one it cannot read and covers a lockfile", () => {
  const cases = [
    [".npmrc", '"\\u0072egistry"=https://evil.example/'],
    [".npmrc", '"registry"=https://evil.example/'],
    [".npmrc", "'registry'=https://evil.example/"],
    [".npmrc", "regis\\try=https://evil.example/"],
    [".npmrc", "registry\\;x=https://evil.example/"],
    [".npmrc", '"//npm.example.com/:_authToken"=SECRET'],
    [".yarnrc", '"\\u0072egistry" "https://evil.example/"'],
    [".yarnrc", '"@x:registry\\u0020" "https://evil.example/"'],
  ];
  for (const [file, text] of cases) {
    assertUnreadableAt("npm", file, text, 1);
    const result = read([[file, text], ["package-lock.json", NO_RESOLVED]]);
    if (file === ".npmrc") assert.deepEqual(result.notRecorded, [], text);
    hidden(result, "SECRET", "evil");
  }
  assert.deepEqual(read([[".yarnrc", '"registry" "https://evil.example/"']]).sourced, [npmConfig(".yarnrc")(1, "host", "https://evil.example")]);
});

// .npmrc files that load another config file

test(".npmrc: userconfig, globalconfig and prefix name a file that is read as an .npmrc and covers like one", () => {
  const pj = ["package.json", '{ "name": "t" }'];
  const lock = ["package-lock.json", NO_RESOLVED];
  const cases = [
    ["userconfig=config/npmrc", "config/npmrc"],
    ["globalconfig = ./etc/global", "etc/global"],
    ["prefix=tools", "tools/etc/npmrc"],
    ["prefix=./tools/", "tools/etc/npmrc"],
  ];
  for (const [npmrc, target] of cases) {
    const result = read([pj, lock, [".npmrc", npmrc], [target, "registry=https://m.example/\n"]]);
    assert.deepEqual(result.sourced, [npmConfig(target)(1, "host", "https://m.example")], npmrc);
    assert.deepEqual([result.notRecorded, result.couldNotRead], [[], []], npmrc);
  }
  const chain = read([pj, lock, [".npmrc", "userconfig=a/one"], ["a/one", "globalconfig=two"], ["a/two", "registry=https://m.example/"]]);
  assert.deepEqual(chain.sourced, [npmConfig("a/two")(1, "host", "https://m.example")]);
  assert.deepEqual(chain.notRecorded, []);
  const loop = read([pj, lock, [".npmrc", "userconfig=a/one"], ["a/one", "userconfig=../.npmrc\nregistry=https://m.example/"]]);
  assert.deepEqual(loop.sourced, [npmConfig("a/one")(2, "host", "https://m.example")]);
  assert.deepEqual(loop.notRecorded, []);
  const scoped = read([pj, lock, [".npmrc", "userconfig=a/one"], ["a/one", "@other:registry=https://m.example/"]]);
  assert.deepEqual(scoped.notRecorded, [NOTE("package-lock.json")]);
});

test(".npmrc: a config file it cannot follow is one it cannot read, covering a lockfile", () => {
  const lock = ["package-lock.json", NO_RESOLVED];
  for (const npmrc of [
    "userconfig=/etc/npmrc",
    "userconfig=~/.npmrc",
    "globalconfig=../outside/npmrc",
    "userconfig=missing/npmrc",
    "userconfig=${HOME}/.npmrc",
    "prefix=${PREFIX}",
    "userconfig=",
    "userconfig",
    "USERCONFIG=config/npmrc",
    "[x]\nuserconfig=config/npmrc",
  ]) {
    const line = npmrc.startsWith("[") ? 2 : 1;
    const result = read([lock, [".npmrc", npmrc]]);
    assert.deepEqual(result.sourced, [npmConfig(".npmrc")(line, "unreadable", null)], npmrc);
    assert.deepEqual(result.couldNotRead, [{ file: ".npmrc", reason: UNREADABLE_SOURCE }], npmrc);
    assert.deepEqual(result.notRecorded, [], npmrc);
  }
  const leftOut = read([lock, [".npmrc", "userconfig=big/npmrc"]], [{ path: "big/npmrc", reason: "larger than 5 MB" }]);
  assert.deepEqual(leftOut.sourced, [npmConfig(".npmrc")(1, "unreadable", null)]);
  assert.deepEqual(leftOut.notRecorded, []);
});

// uv's override, constraint and dependency-metadata lists

test("uv: override-dependencies, constraint-dependencies and dependency-metadata requires-dist are read for sources, in uv.toml and in pyproject.toml with a lockfile", () => {
  const uvText = lines(
    'override-dependencies = ["over @ https://e.example/over-1.0.zip", "numpy<2"]',
    'constraint-dependencies = ["con @ git+https://e.example/con"]',
    "[[dependency-metadata]]",
    'name = "x"',
    'version = "1.0"',
    'requires-dist = ["dep @ https://e.example/dep-1.0.zip", "idna"]',
  );
  const item = (file) => (name, line, kind, address) => ({ ecosystem: "PyPI", file, line, name, version: null, kind, address });
  const uv = read([["uv.toml", uvText]]);
  assert.deepEqual(uv.sourced, [
    item("uv.toml")("over", 1, "url", "https://e.example/over-1.0.zip"),
    item("uv.toml")("con", 2, "git", "https://e.example/con"),
    item("uv.toml")("dep", 6, "url", "https://e.example/dep-1.0.zip"),
  ]);
  assert.deepEqual(uv.packages, []);
  const uvLock = 'version = 1\n\n[[package]]\nname = "t"\nversion = "0.1.0"\nsource = { editable = "." }\n';
  const pyprojectText = lines(
    "[tool.uv]",
    'override-dependencies = ["over @ https://e.example/over-1.0.zip", "numpy<2"]',
    'constraint-dependencies = ["con @ git+https://e.example/con"]',
    "[[tool.uv.dependency-metadata]]",
    'name = "x"',
    'version = "1.0"',
    'requires-dist = ["dep @ https://e.example/dep-1.0.zip", "idna"]',
  );
  const pyproject = read([["pyproject.toml", pyprojectText], ["uv.lock", uvLock]]);
  assert.deepEqual(pyproject.sourced.map((s) => [s.name, s.line, s.kind]), [["over", 2, "url"], ["con", 3, "git"], ["dep", 7, "url"]]);
  assert.deepEqual(pyproject.packages, []);
});

test("uv: those lists in a shape uv does not take are ones it cannot read", () => {
  const unread = (file, line) => ({ ecosystem: "PyPI", file, line, name: null, version: null, kind: "unreadable", address: null });
  for (const [text, line] of [['override-dependencies = "x"', 1], ['override-dependencies.x = ["y"]', 1], ['[[dependency-metadata]]\nrequires-dist = "x"', 2], ['dependency-metadata = ["x"]', 1]]) {
    const result = read([["uv.toml", text]]);
    assert.deepEqual(result.sourced, [unread("uv.toml", line)], text);
    assert.deepEqual(result.couldNotRead, [{ file: "uv.toml", reason: UNREADABLE_SOURCE }], text);
  }
});

// Settings that turn off certificate checks

const certificateOff = (ecosystem, file, line, setting) => config(ecosystem, file, line, "http", null, { text: `${setting} turns off certificate checks` });

test("settings that turn off certificate checks are reported as allowing plain http; a proxy alone is not", () => {
  assert.deepEqual(read([[".npmrc", "strict-ssl=false\nproxy=http://p.example\nhttps-proxy=http://p.example\nstrict-ssl=true\n"]]).sourced, [
    certificateOff("npm", ".npmrc", 1, "strict-ssl=false"),
  ]);
  const yml = lines(
    "enableStrictSsl: false",
    "httpProxy: http://p.example",
    "npmRegistries:",
    '  "https://r.example":',
    "    enableStrictSsl: false",
    '  "https://s.example":',
    "    enableStrictSsl: true",
  );
  assert.deepEqual(read([[".yarnrc.yml", yml]]).sourced, [
    certificateOff("npm", ".yarnrc.yml", 1, "enableStrictSsl: false"),
    npmConfig(".yarnrc.yml")(4, "host", "https://r.example"),
    certificateOff("npm", ".yarnrc.yml", 5, "enableStrictSsl: false"),
    npmConfig(".yarnrc.yml")(6, "host", "https://s.example"),
  ]);
  assert.deepEqual(read([["uv.toml", 'allow-insecure-host = ["x.example"]\n[pip]\nallow-insecure-host = ["y.example:8080"]\n']]).sourced, [
    certificateOff("PyPI", "uv.toml", 1, "allow-insecure-host"),
    certificateOff("PyPI", "uv.toml", 3, "allow-insecure-host"),
  ]);
  const pyproject = lines(
    "[tool.uv]",
    'allow-insecure-host = ["x.example"]',
    "[[tool.poetry.source]]",
    'name = "corp"',
    'url = "https://pypi.org/simple"',
    "verify_ssl = false",
    "[[tool.pdm.source]]",
    'name = "pdm"',
    'url = "https://pypi.org/simple"',
    "verify_ssl = false",
    "[[tool.pdm.source]]",
    'name = "ok"',
    'url = "https://pypi.org/simple"',
    "verify_ssl = true",
  );
  assert.deepEqual(read([["pyproject.toml", pyproject]]).sourced, [
    certificateOff("PyPI", "pyproject.toml", 2, "allow-insecure-host"),
    certificateOff("PyPI", "pyproject.toml", 6, "verify_ssl = false"),
    certificateOff("PyPI", "pyproject.toml", 10, "verify_ssl = false"),
  ]);
  assert.deepEqual(read([["pdm.toml", "[pypi]\nverify_ssl = false\n[pypi.x]\nurl = \"https://pypi.org/simple\"\nverify_ssl = false\n"]]).sourced, [
    certificateOff("PyPI", "pdm.toml", 2, "verify_ssl = false"),
    certificateOff("PyPI", "pdm.toml", 5, "verify_ssl = false"),
  ]);
});

test("a certificate setting it cannot read is one it cannot read, and does not cover a lockfile", () => {
  for (const [file, text, line] of [
    [".npmrc", "strict-ssl=maybe", 1],
    [".npmrc", "strict_ssl=false", 1],
    [".yarnrc.yml", "enableStrictSsl: maybe", 1],
    [".yarnrc.yml", "enableStrictSsl: *x", 1],
    [".yarnrc.yml", 'npmRegistries:\n  "https://pypi.example":\n    enableStrictSsl: maybe', 3],
  ]) {
    assertUnreadableAt("npm", file, text, line);
    const notes = read([[file, text], ["package-lock.json", NO_RESOLVED]]).notRecorded;
    if (file === ".npmrc") assert.deepEqual(notes, [NOTE("package-lock.json")], text);
  }
  for (const [file, text, line] of [
    ["pdm.toml", '[pypi]\nverify_ssl = "no"', 2],
    ["pyproject.toml", '[[tool.pdm.source]]\nname = "x"\nurl = "https://pypi.org/simple"\nverify_ssl = 0', 4],
  ]) {
    assertUnreadableAt("PyPI", file, text, line);
  }
  for (const [text, expected] of [["enableStrictSsl: no", 1], ["enableStrictSsl: 'FALSE'", 1], ["enableStrictSsl: yes", 0]]) {
    assert.equal(read([[".yarnrc.yml", text]]).sourced.length, expected, text);
  }
});

test("a registry key or value in .yarnrc.yml or pnpm-workspace.yaml that is no address is one it cannot read, covering a lockfile", () => {
  for (const [file, text, line] of [
    [".yarnrc.yml", "npmRegistries:\n  not-an-address:\n    npmAlwaysAuth: true", 2],
    ["pnpm-workspace.yaml", "namedRegistries:\n  corp: not an address", 2],
    ["pnpm-workspace.yaml", "registries:\n  https://:\n    scopes: ['@']", 2],
  ]) {
    assertUnreadableAt("npm", file, text, line);
  }
  assert.deepEqual(read([["yarn.lock", BERRY], [".yarnrc.yml", "npmRegistries:\n  not-an-address:\n    npmAlwaysAuth: true"]]).notRecorded, []);
});

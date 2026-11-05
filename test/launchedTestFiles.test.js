"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { findLaunchedTestFiles } = require("../src/launchedTestFiles");

const tree = (...paths) => paths.map((p) => ({ path: p, size: 10 }));
const launched = (t, files) => findLaunchedTestFiles(t, files).launched;

test("a script in a test or eval folder that a non-test file runs is launched, named with what runs it", () => {
  const t = tree("SKILL.md", "tests/run.sh", "evals/grade.py", "__tests__/a.test.js", "test/b.js");
  const files = [
    { path: "SKILL.md", text: "First run `bash tests/run.sh`, then `python evals/grade.py`." },
    { path: "hooks/hooks.json", text: '{"command": "node ${CLAUDE_PLUGIN_ROOT}/__tests__/a.test.js"}', script: true },
  ];
  assert.deepEqual(launched(t, files), [
    { path: "__tests__/a.test.js", by: "hooks/hooks.json" },
    { path: "evals/grade.py", by: "SKILL.md" },
    { path: "tests/run.sh", by: "SKILL.md" },
  ]);
});

test("a test file that nothing outside the test folders runs stays skipped", () => {
  const t = tree("SKILL.md", "tests/run.sh", "tests/helper.sh", "README.md");
  const files = [
    { path: "SKILL.md", text: "Run the tests with `npm test`; see the tests folder." },
    { path: "README.md", text: "Developers: bash tests/run.sh" },
    { path: "tests/run.sh", text: "bash tests/helper.sh", script: true },
  ];
  assert.deepEqual(launched(t, files), []);
});

test("references match whole path segments, in imports, requires and python -m form", () => {
  const t = tree("tests/util.js", "tests/lib/mod.py", "mytests/x.sh", "tests/x.sh");
  const files = [
    { path: "run.js", text: 'const u = require("./tests/util");\nspawn("python", ["-m", "tests.lib.mod"]);\nexec("bash mytests/x.sh")', script: true },
  ];
  assert.deepEqual(launched(t, files).map((l) => l.path), ["tests/lib/mod.py", "tests/util.js"]);
});

test("package.json scripts count, except the test and eval ones", () => {
  const t = tree("package.json", "tests/install.js", "tests/unit.js", "evals/run.js");
  const files = [
    { path: "package.json", text: JSON.stringify({ scripts: { postinstall: "node tests/install.js", test: "node tests/unit.js", "eval:all": "node evals/run.js" } }) },
  ];
  assert.deepEqual(launched(t, files).map((l) => l.path), ["tests/install.js"]);
});

test("a launched test file can launch another one in turn", () => {
  const t = tree("SKILL.md", "tests/a.sh", "tests/b.sh");
  const first = findLaunchedTestFiles(t, [{ path: "SKILL.md", text: "bash tests/a.sh" }]);
  assert.deepEqual(first.launched, [{ path: "tests/a.sh", by: "SKILL.md" }]);
  // Once read, tests/a.sh runs in a non-test context, so what it runs does too.
  const files = [{ path: "SKILL.md", text: "bash tests/a.sh" }, { path: "tests/a.sh", text: "bash tests/b.sh", script: true, launchedBy: "SKILL.md" }];
  assert.deepEqual(launched(t, files), [{ path: "tests/b.sh", by: "tests/a.sh" }]);
});

test("data files and dependencies in test folders are never launched", () => {
  const t = tree("tests/fixture.json", "tests/notes.md", "node_modules/x/tests/run.sh", "tests/payload");
  const files = [{ path: "SKILL.md", text: "load tests/fixture.json and tests/notes.md; bash node_modules/x/tests/run.sh; sh tests/payload" }];
  assert.deepEqual(launched(t, files).map((l) => l.path), ["tests/payload"]);
});

test("launched files fit in what is left of the script limits, and say so when they don't", () => {
  const t = [{ path: "tests/a.sh", size: 10 }, { path: "tests/b.sh", size: 10 }];
  const scripts = Array.from({ length: 199 }, (_, i) => ({ path: `s${i}.sh`, text: "x", script: true }));
  const result = findLaunchedTestFiles(t, [{ path: "SKILL.md", text: "bash tests/a.sh; bash tests/b.sh" }, ...scripts]);
  assert.deepEqual(result.launched.map((l) => l.path), ["tests/a.sh"]);
  assert.equal(result.truncated, true);
});

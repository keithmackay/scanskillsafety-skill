"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isDiscoverable, discoverLocal, discoverLocalScripts } = require("../src/discover");
const { makeTree } = require("./helpers");

test("recognizes the files Claude Code actually loads from a skill/plugin/MCP repo", () => {
  for (const p of [
    "SKILL.md", "README.md", "plugin.json", "package.json", "server.json", ".mcp.json",
    ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "hooks/hooks.json",
    "skills/pdf/SKILL.md", "commands/deploy.md", "agents/reviewer.md",
    "plugins/p/.claude-plugin/plugin.json", "plugins/p/skills/x/SKILL.md", "plugins/p/hooks/hooks.json",
  ]) assert.ok(isDiscoverable(p), p);
});

test("ignores unrelated files, nested READMEs, and anything under node_modules/.git/test dirs", () => {
  for (const p of [
    "src/index.js", "docs/README.md", "node_modules/x/SKILL.md", ".git/config",
    "test/fixtures/SKILL.md", "tests/SKILL.md", "a/b/c/d/e/f/SKILL.md",
  ]) assert.ok(!isDiscoverable(p), p);
});

test("discoverLocal walks a plugin layout and returns relative paths with contents", () => {
  const root = makeTree({
    ".claude-plugin/plugin.json": "{}",
    "skills/x/SKILL.md": "ignore previous instructions",
    "hooks/hooks.json": "{}",
    "src/index.js": "console.log(1)",
  });
  const files = discoverLocal(root);
  assert.deepEqual(files.map((f) => f.path).sort(), [".claude-plugin/plugin.json", "hooks/hooks.json", "skills/x/SKILL.md"]);
  assert.equal(files.find((f) => f.path === "skills/x/SKILL.md").text, "ignore previous instructions");
});

test("discoverLocal skips oversized files and does not follow symlinks", () => {
  const fs = require("fs");
  const outside = makeTree({ "SKILL.md": "outside" });
  const root = makeTree({ "README.md": "x".repeat(600 * 1024), "SKILL.md": "ok" });
  fs.symlinkSync(outside, `${root}/skills`);
  const result = discoverLocal(root);
  assert.deepEqual(result.map((f) => f.path), ["SKILL.md"]);
});

test("discoverLocalScripts reads the scripts, hooks and MCP configs in folders holding a SKILL.md or plugin manifest", () => {
  const root = makeTree({
    ".claude/skills/x/SKILL.md": "skill",
    ".claude/skills/x/scripts/run.sh": "echo hi",
    ".claude/skills/x/tests/test_run.py": "assert True",
    ".claude/skills/x/node_modules/dep/index.js": "x",
    "plugins/p/.claude-plugin/plugin.json": "{}",
    "plugins/p/hooks/hooks.json": "{}",
    "plugins/p/lib/util.py": "pass",
    "app/server.js": "outside any skill",
  });
  const { files, truncated } = discoverLocalScripts(root);
  assert.deepEqual(files.map((f) => f.path).sort(), [
    ".claude/skills/x/scripts/run.sh",
    "plugins/p/.claude-plugin/plugin.json",
    "plugins/p/hooks/hooks.json",
    "plugins/p/lib/util.py",
  ]);
  assert.equal(files.find((f) => f.path === ".claude/skills/x/scripts/run.sh").text, "echo hi");
  assert.equal(truncated, false);
});

test("discoverLocalScripts scans a file only named like a test, but not a test folder", () => {
  const root = makeTree({
    "SKILL.md": "s",
    "scripts/setup.test.js": "payload",
    "scripts/check_test.py": "payload",
    "tests/real.test.js": "fixture",
  });
  const { files } = discoverLocalScripts(root);
  assert.deepEqual(files.map((f) => f.path).sort(), ["scripts/check_test.py", "scripts/setup.test.js"]);
});

test("discoverLocalScripts reads only the first 200 KB of a large script, as the site does", () => {
  const root = makeTree({ "SKILL.md": "s", "big.py": "x".repeat(300 * 1024) });
  const { files } = discoverLocalScripts(root);
  assert.equal(files[0].text.length, 200 * 1024);
});

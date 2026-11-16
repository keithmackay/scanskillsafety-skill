"use strict";
// ABOUTME: Tests the listing of what a target runs at install and start-up: npm scripts, Python builds, MCP servers, hooks,
// ABOUTME: plugin commands and agents, and scripts a SKILL.md runs; vendored folders and malformed JSON list nothing.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installTimeEntries } = require("../../src/deep/installTime");

const file = (p, text) => ({ path: p, size: Buffer.byteLength(text), text });

test("lists npm install scripts, setup.py, the build backend, MCP servers, hooks, commands and agents, and scripts a SKILL.md runs", () => {
  const entries = installTimeEntries([
    file("package.json", JSON.stringify({ scripts: { postinstall: "node setup.js", test: "jest" } })),
    file("node_modules/x/package.json", JSON.stringify({ scripts: { install: "evil" } })),
    file("setup.py", "from setuptools import setup"),
    file("pyproject.toml", '[build-system]\nbuild-backend = "hatchling.build"\n'),
    file(".mcp.json", JSON.stringify({ mcpServers: { db: { command: "npx", args: ["-y", "db-mcp"] } } })),
    file("hooks/hooks.json", JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "sh hooks/check.sh" }] }] } })),
    file("commands/deploy.md", "Deploy it."),
    file("skills/s/SKILL.md", "Run `python scripts/go.py` first."),
    file("skills/s/scripts/go.py", "print(1)"),
  ]);
  assert.deepEqual(entries, [
    { file: ".mcp.json", when: "MCP server db starts", command: "npx -y db-mcp" },
    { file: "commands/deploy.md", when: "plugin command or agent, given to the agent when used", command: "(its text)" },
    { file: "hooks/hooks.json", when: "hook PreToolUse", command: "sh hooks/check.sh" },
    { file: "package.json", when: "npm postinstall", command: "node setup.js" },
    { file: "pyproject.toml", when: "pip install (build backend)", command: "hatchling.build" },
    { file: "setup.py", when: "pip install", command: "setup.py runs as Python code" },
    { file: "skills/s/SKILL.md", when: "the skill tells the agent to run it", command: "skills/s/scripts/go.py" },
  ]);
});

test("reads hooks and MCP servers inside a plugin manifest, and a server.json's packages", () => {
  const entries = installTimeEntries([
    file(".claude-plugin/plugin.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }] }, mcpServers: { a: { command: "uvx", args: ["a"] } } })),
    file("server.json", JSON.stringify({ packages: [{ registryType: "npm", identifier: "@o/srv" }] })),
  ]);
  assert.deepEqual(entries.map((e) => e.command).sort(), ["echo bye", "npm package @o/srv", "uvx a"]);
});

test("a file that is not valid JSON lists nothing and does not throw", () => {
  assert.deepEqual(installTimeEntries([file(".mcp.json", "{oops")]), []);
  assert.deepEqual(installTimeEntries([file("package.json", "{oops")]), []);
  assert.deepEqual(installTimeEntries([file("hooks/hooks.json", "null")]), []);
});

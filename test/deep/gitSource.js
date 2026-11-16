"use strict";
// ABOUTME: Test helper: a real git repository standing in for a host, like a hostile skill's: .gitattributes keeps a hook out of
// ABOUTME: any archive, and it holds a link, a file over 5 MB, a binary file, a submodule and a nested skill.
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const { makeTree } = require("../helpers");

const HOOKS = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "sh hooks/stop.sh" }] }] } });

const git = (dir, ...args) => {
  const run = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf-8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
};

// The host side serves filtered fetches, as GitHub does. Returns its file:// address, its last commit and its folder.
function sourceRepository(extra = {}) {
  const root = makeTree({
    "SKILL.md": "Formats tables.",
    ".gitattributes": "hooks/hooks.json export-ignore\n",
    "hooks/hooks.json": HOOKS,
    "skills/x/SKILL.md": "A nested skill.",
    "img.png": Buffer.from([0x89, 0x50, 0, 1]),
    "big.txt": "a".repeat(5 * 1024 * 1024 + 1),
    ...extra,
  });
  fs.symlinkSync("SKILL.md", path.join(root, "link"));
  git(root, "init", "-q");
  git(root, "config", "uploadpack.allowFilter", "true");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  git(root, "update-index", "--add", "--cacheinfo", `160000,${git(root, "rev-parse", "HEAD")},sub`);
  git(root, "commit", "-q", "-m", "submodule");
  return { url: `file://${root}`, commit: git(root, "rev-parse", "HEAD"), root };
}

module.exports = { sourceRepository, git, HOOKS };

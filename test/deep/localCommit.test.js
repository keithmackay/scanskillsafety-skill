"use strict";
// ABOUTME: Tests naming a local folder's git commit and whether it has uncommitted changes, without ever running a command the
// ABOUTME: folder's own git configuration names.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { localCommit } = require("../../src/deep/localCommit");
const { makeTree } = require("../helpers");

const git = (dir, ...args) => {
  const run = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf-8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
};

function checkout(files) {
  const root = makeTree(files);
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  return root;
}

const hasGit = spawnSync("git", ["--version"]).status === 0;

test("names a checkout's commit, and says when it has uncommitted changes", { skip: hasGit ? false : "no git here" }, () => {
  const root = checkout({ "SKILL.md": "hi" });
  const head = git(root, "rev-parse", "HEAD");
  assert.deepEqual(localCommit(root), { commit: head, changed: false, changesChecked: true, note: null });
  fs.writeFileSync(path.join(root, "SKILL.md"), "changed");
  assert.deepEqual(localCommit(root), { commit: head, changed: true, changesChecked: true, note: null });
});

test("a folder that is not a checkout has no commit", () => {
  assert.deepEqual(localCommit(makeTree({ "SKILL.md": "hi" })), { commit: null, changed: false, changesChecked: false, note: "not a git checkout, so no commit can be named" });
});

test("a checkout with no commit yet has no commit", { skip: hasGit ? false : "no git here" }, () => {
  const root = makeTree({ "SKILL.md": "hi" });
  git(root, "init", "-q");
  assert.deepEqual(localCommit(root), { commit: null, changed: false, changesChecked: false, note: "a git checkout with no commit yet" });
});

test("never runs a command the checkout's git configuration names, and says changes were not checked", { skip: hasGit ? false : "no git here" }, () => {
  const root = checkout({ "SKILL.md": "hi" });
  const marker = path.join(makeTree({}), "ran");
  const script = path.join(makeTree({}), "monitor.sh");
  fs.writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  git(root, "config", "core.fsmonitor", script);
  fs.writeFileSync(path.join(root, "SKILL.md"), "changed");
  const head = git(root, "rev-parse", "HEAD");
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(localCommit(root), {
    commit: head,
    changed: false,
    changesChecked: false,
    note: "could not check for uncommitted changes safely (the repository's git configuration names commands)",
  });
  assert.equal(fs.existsSync(marker), false);
});

test("a filter driver, diff text conversion or hooks path in the configuration also stops the change check", { skip: hasGit ? false : "no git here" }, () => {
  for (const [key, value] of [["filter.x.clean", "cat"], ["diff.x.textconv", "cat"], ["core.hooksPath", "hooks"]]) {
    const root = checkout({ "SKILL.md": "hi" });
    git(root, "config", key, value);
    assert.equal(localCommit(root).changesChecked, false, key);
  }
});

test("a setting from a file the configuration includes also stops the change check", { skip: hasGit ? false : "no git here" }, () => {
  const root = checkout({ "SKILL.md": "hi" });
  const marker = path.join(makeTree({}), "ran");
  const included = path.join(makeTree({}), "extra.config");
  fs.writeFileSync(included, `[core]\n\tfsmonitor = touch '${marker}'\n`);
  git(root, "config", "include.path", included);
  fs.writeFileSync(path.join(root, "SKILL.md"), "changed");
  assert.equal(localCommit(root).changesChecked, false);
  assert.equal(fs.existsSync(marker), false);
});

test("a per-worktree configuration also stops the change check", { skip: hasGit ? false : "no git here" }, () => {
  const root = checkout({ "SKILL.md": "hi" });
  git(root, "config", "extensions.worktreeConfig", "true");
  assert.equal(localCommit(root).changesChecked, false);
});

test("never runs a command a submodule's own configuration names", { skip: hasGit ? false : "no git here" }, () => {
  const marker = path.join(makeTree({}), "ran");
  const inner = checkout({ "a.txt": "one", ".gitattributes": "* filter=x\n" });
  const root = checkout({ "SKILL.md": "hi" });
  git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", inner, "sub");
  git(root, "commit", "-q", "-m", "sub");
  git(path.join(root, "sub"), "config", "filter.x.clean", `sh -c 'touch "${marker}"; cat'`);
  fs.writeFileSync(path.join(root, "sub", "a.txt"), "two");
  const got = localCommit(root);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(got.changesChecked, true);
});

test("a git that stops answering is a clear error", { skip: process.platform === "win32" ? "needs a shell script for git" : false }, (t) => {
  const bin = makeTree({});
  fs.writeFileSync(path.join(bin, "git"), "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
  const savedPath = process.env.PATH;
  t.after(() => (process.env.PATH = savedPath));
  process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
  assert.throws(() => localCommit(makeTree({ "SKILL.md": "hi" }), { timeoutMs: 100 }), /^Error: git did not finish within 100 ms$/);
});

test("a configuration git cannot read, or a status that fails, says changes could not be checked", { skip: process.platform === "win32" ? "needs a shell script for git" : false }, (t) => {
  const savedPath = process.env.PATH;
  t.after(() => (process.env.PATH = savedPath));
  for (const failing of ["config", "status"]) {
    const bin = makeTree({});
    // Answers as a checkout at commit c…c, and fails the one subcommand named.
    fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\nfor a; do case "$a" in ${failing}) exit 2;; config) exit 1;; HEAD) echo ${"c".repeat(40)}; exit 0;; esac; done\nexit 0\n`, { mode: 0o755 });
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
    assert.deepEqual(localCommit(makeTree({})), { commit: "c".repeat(40), changed: false, changesChecked: false, note: "could not check for uncommitted changes" }, failing);
  }
});

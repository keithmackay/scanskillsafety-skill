// ABOUTME: Names a local folder's git commit and whether it has uncommitted changes, for the deep scan. Never runs a command the
// ABOUTME: folder's own git configuration names (fsmonitor, filter drivers, diff text conversion, hooks).
"use strict";

const { spawnSync } = require("child_process");

// Settings that make `git status` run a program the repository chooses, or that move settings where the plain local config does
// not show them (a per-worktree config file). Included files are read too.
const RUNS_COMMANDS = String.raw`^(core\.fsmonitor|core\.hookspath|filter\.|diff\..*\.textconv|extensions\.worktreeconfig)`;
const NOT_A_CHECKOUT = { commit: null, changed: false, changesChecked: false };

const git = (folder, args) => spawnSync("git", ["-C", folder, ...args], { encoding: "utf-8" });

function localCommit(folder) {
  if (git(folder, ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"]).status !== 0) return NOT_A_CHECKOUT;
  const head = git(folder, ["-c", "core.fsmonitor=false", "rev-parse", "--verify", "-q", "HEAD"]);
  if (head.status !== 0) return NOT_A_CHECKOUT;
  const commit = head.stdout.trim();
  // Reading the configuration runs nothing; it answers 1 when no such setting exists.
  const config = git(folder, ["config", "--local", "--includes", "--get-regexp", RUNS_COMMANDS]);
  if (config.status !== 1) return { commit, changed: false, changesChecked: false };
  // Submodules are left out: each has its own configuration, which `git status` would follow.
  const status = git(folder, ["-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain", "--ignore-submodules=all", "--", "."]);
  if (status.status !== 0) return { commit, changed: false, changesChecked: false };
  return { commit, changed: status.stdout.trim() !== "", changesChecked: true };
}

module.exports = { localCommit };

// ABOUTME: Names a local folder's git commit and whether it has uncommitted changes, for the deep scan. Never runs a command the
// ABOUTME: folder's own git configuration names (fsmonitor, filter drivers, diff text conversion, hooks).
"use strict";

const { runTool } = require("./runTool");

// Settings that make `git status` run a program the repository chooses, or that move settings where the plain local config does
// not show them (a per-worktree config file). Included files are read too.
const RUNS_COMMANDS = String.raw`^(core\.fsmonitor|core\.hookspath|filter\.|diff\..*\.textconv|extensions\.worktreeconfig)`;
const GIT_TIMEOUT_MS = 60_000;

const NOT_A_CHECKOUT = "not a git checkout, so no commit can be named";
const NO_COMMIT_YET = "a git checkout with no commit yet";
const CONFIG_NAMES_COMMANDS = "could not check for uncommitted changes safely (the repository's git configuration names commands)";
const CHANGES_UNCHECKED = "could not check for uncommitted changes";

function localCommit(folder, { timeoutMs = GIT_TIMEOUT_MS } = {}) {
  const git = (args) => runTool("git", ["-C", folder, ...args], timeoutMs);
  const unchecked = (commit, note) => ({ commit, changed: false, changesChecked: false, note });
  if (git(["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"]).status !== 0) return unchecked(null, NOT_A_CHECKOUT);
  const head = git(["-c", "core.fsmonitor=false", "rev-parse", "--verify", "-q", "HEAD"]);
  if (head.status !== 0) return unchecked(null, NO_COMMIT_YET);
  const commit = head.stdout.trim();
  // Reading the configuration runs nothing; it answers 0 when such a setting exists and 1 when none does.
  const config = git(["config", "--local", "--includes", "--get-regexp", RUNS_COMMANDS]);
  if (config.status === 0) return unchecked(commit, CONFIG_NAMES_COMMANDS);
  if (config.status !== 1) return unchecked(commit, CHANGES_UNCHECKED);
  // Submodules are left out: each has its own configuration, which `git status` would follow. A status that runs past its time
  // limit (a very large checkout) leaves changes unchecked rather than stopping the scan.
  let status;
  try {
    status = git(["-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain", "--ignore-submodules=all", "--", "."]);
  } catch {
    return unchecked(commit, CHANGES_UNCHECKED);
  }
  if (status.status !== 0) return unchecked(commit, CHANGES_UNCHECKED);
  return { commit, changed: status.stdout.trim() !== "", changesChecked: true, note: null };
}

module.exports = { localCommit };

// ABOUTME: Starts one claude -p call for Claude's reading: in an empty temporary folder (never the target's, so nothing in it can
// ABOUTME: load), with no shell, the prompt on stdin, stopped at its time limit; the folder is removed after.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const CLAUDE_TIMEOUT_MS = 10 * 60_000;

function isExecutableFile(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The claude program (CLAUDE_BIN, or claude on PATH), found without running it; null when there is none.
function findClaude(env = process.env) {
  const name = env.CLAUDE_BIN || "claude";
  if (name.includes("/") || name.includes(path.sep)) return isExecutableFile(name) ? path.resolve(name) : null;
  const endings = process.platform === "win32" ? ["", ".cmd", ".exe"] : [""];
  for (const folder of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ending of endings) {
      const file = path.join(folder, name + ending);
      if (isExecutableFile(file)) return file;
    }
  }
  return null;
}

// Resolves { stdout, exitCode, timedOut }, or { missing: true } when the program is not there.
function runClaude({ args, prompt, timeoutMs = CLAUDE_TIMEOUT_MS, command = process.env.CLAUDE_BIN || "claude", env = process.env }) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "scanskillsafety-claude-"));
  const removeFolder = () => fs.rmSync(folder, { recursive: true, force: true });
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: folder, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let timedOut = false;
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeFolder();
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.resume();
    // A child that ends before reading all of its stdin closes the pipe; that is not an error of the call.
    child.stdin.on("error", () => {});
    child.on("error", (err) => finish(err.code === "ENOENT" ? { missing: true } : { stdout, exitCode: null, timedOut, error: err.message }));
    child.on("close", (exitCode) => finish({ stdout, exitCode, timedOut }));
    child.stdin.end(prompt);
  });
}

module.exports = { runClaude, findClaude, CLAUDE_TIMEOUT_MS };

// ABOUTME: Finds and starts one claude -p call for Claude's reading: in an empty temporary folder (never the target's, so nothing in
// ABOUTME: it can load), with no shell, the prompt on stdin, stopped at its time limit; the folder is removed after.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { temporaryFolder } = require("./util");

const CLAUDE_TIMEOUT_MS = 10 * 60_000;
const KILL_AFTER_MS = 5000;
const MAX_REPLY_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const NOT_INSTALLED = "the claude CLI is not installed";
const ONLY_CMD = "the claude CLI is installed as claude.cmd, which this tool cannot start safely without a shell (Windows)";
// Variables that mark a process as running inside a Claude Code session; the reading is its own session.
const SESSION_VARIABLES = ["CLAUDECODE", "CLAUDE_CODE_SSE_PORT"];

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

function isExecutableFile(file, platform) {
  if (!isFile(file)) return false;
  if (platform === "win32") return true;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The claude program (CLAUDE_BIN, or claude on PATH), found without running it: { path }, or { reason } when there is none it can
// start. Node cannot start a .cmd or .bat without a shell, so on Windows only claude and claude.exe are used.
function findClaude(env = process.env, platform = process.platform) {
  const name = env.CLAUDE_BIN || "claude";
  if (platform === "win32" && /\.(cmd|bat)$/i.test(name)) return { reason: ONLY_CMD };
  if (name.includes("/") || name.includes(path.sep)) return isExecutableFile(name, platform) ? { path: path.resolve(name) } : { reason: NOT_INSTALLED };
  const folders = (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : path.delimiter).filter(Boolean);
  const endings = platform === "win32" ? ["", ".exe"] : [""];
  for (const folder of folders) {
    for (const ending of endings) {
      const file = path.join(folder, name + ending);
      if (isExecutableFile(file, platform)) return { path: path.resolve(file) };
    }
  }
  if (platform === "win32" && folders.some((folder) => isFile(path.join(folder, `${name}.cmd`)) || isFile(path.join(folder, `${name}.bat`)))) {
    return { reason: ONLY_CMD };
  }
  return { reason: NOT_INSTALLED };
}

// Resolves { stdout, stderr, exitCode, timedOut }, with error when the call failed for another reason, or { missing: true } when the
// program is not there. A call past its time limit is sent SIGTERM, then SIGKILL if it is still running killAfterMs later; it
// settles at once, and anything the child does after is ignored.
function runClaude({
  args, prompt, timeoutMs = CLAUDE_TIMEOUT_MS, killAfterMs = KILL_AFTER_MS, command = process.env.CLAUDE_BIN || "claude",
  env = process.env, tmpDir = os.tmpdir(),
}) {
  const { dir: folder, cleanup } = temporaryFolder("scanskillsafety-claude-", tmpDir);
  const childEnv = { ...env };
  for (const name of SESSION_VARIABLES) delete childEnv[name];
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(outcome);
    };
    let child;
    try {
      child = spawn(command, args, { cwd: folder, env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      return finish({ stdout: "", stderr: "", exitCode: null, timedOut: false, error: err.message });
    }
    const chunks = [];
    let bytes = 0;
    let stderr = Buffer.alloc(0);
    const outcome = (fields) => ({ stdout: Buffer.concat(chunks).toString("utf-8"), stderr: stderr.toString("utf-8"), exitCode: null, timedOut: false, ...fields });
    const stop = () => {
      child.stdout.destroy();
      child.stderr.destroy();
      child.kill("SIGTERM");
      const killer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, killAfterMs);
      child.once("exit", () => clearTimeout(killer));
    };
    timer = setTimeout(() => {
      stop();
      finish(outcome({ timedOut: true }));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (settled) return;
      bytes += d.length;
      if (bytes > MAX_REPLY_BYTES) {
        stop();
        return finish(outcome({ stdout: "", error: "the reply was too large" }));
      }
      chunks.push(d);
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr = Buffer.concat([stderr, d]).subarray(0, MAX_STDERR_BYTES);
    });
    // A child that ends before reading all of its stdin closes the pipe; that is not an error of the call.
    child.stdin.on("error", () => {});
    child.on("error", (err) => finish(err.code === "ENOENT" ? { missing: true } : outcome({ stdout: "", error: err.message })));
    child.on("close", (exitCode) => finish(outcome({ exitCode })));
    child.stdin.end(prompt);
  });
}

module.exports = { runClaude, findClaude, CLAUDE_TIMEOUT_MS };

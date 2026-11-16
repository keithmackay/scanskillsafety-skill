// ABOUTME: Runs a system program the deep scan needs (git, tar) with a time limit, so a stuck program cannot hang the scan; a
// ABOUTME: run past the limit is an error naming the program, any other run is returned as it ended.
"use strict";

const { spawnSync } = require("child_process");

const MAX_BUFFER = 256 * 1024 ** 2;

function describeDuration(ms) {
  if (ms % 60_000 === 0 && ms >= 120_000) return `${ms / 60_000} minutes`;
  if (ms % 1000 === 0) return `${ms / 1000} seconds`;
  return `${ms} ms`;
}

// options: env (the whole environment the program gets), input (written to its stdin), binary (stdout and stderr as bytes).
function runTool(program, args, timeoutMs, { env, input, binary = false } = {}) {
  const run = spawnSync(program, args, { encoding: binary ? "buffer" : "utf-8", maxBuffer: MAX_BUFFER, timeout: timeoutMs, env, input });
  if (run.error && run.error.code === "ETIMEDOUT") throw new Error(`${program} did not finish within ${describeDuration(timeoutMs)}`);
  return run;
}

module.exports = { runTool, describeDuration };

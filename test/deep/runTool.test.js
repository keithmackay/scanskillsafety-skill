"use strict";
// ABOUTME: Tests running a system program (git, tar) for the deep scan with a time limit: a run past it is a clear error, any
// ABOUTME: other run is returned as it ended.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runTool } = require("../../src/deep/runTool");

test("returns a run that ends, whatever its status", () => {
  assert.equal(runTool("sh", ["-c", "echo hi"], 5000).stdout, "hi\n");
  assert.equal(runTool("sh", ["-c", "exit 3"], 5000).status, 3);
  assert.equal(runTool("no-such-program-here", [], 5000).error.code, "ENOENT");
});

test("a run past its time limit is a clear error", () => {
  assert.throws(() => runTool("sleep", ["5"], 100), /^Error: sleep did not finish within 100 ms$/);
});

test("names the time limit in seconds or minutes when it is a whole number of them", () => {
  const { describeDuration } = require("../../src/deep/runTool");
  assert.equal(describeDuration(60_000), "60 seconds");
  assert.equal(describeDuration(5 * 60_000), "5 minutes");
  assert.equal(describeDuration(1500), "1500 ms");
});

test("passes the environment and input it is given, and gives bytes when asked", () => {
  assert.equal(runTool("sh", ["-c", "printf %s \"$ONLY_THIS\""], 5000, { env: { PATH: process.env.PATH, ONLY_THIS: "set" } }).stdout, "set");
  assert.equal(runTool("sh", ["-c", "printf %s \"${HOME:-none}\""], 5000, { env: { PATH: process.env.PATH } }).stdout, "none");
  assert.equal(runTool("cat", [], 5000, { input: "piped" }).stdout, "piped");
  const bytes = runTool("printf", ["a\\000b"], 5000, { binary: true }).stdout;
  assert.ok(Buffer.isBuffer(bytes));
  assert.deepEqual([...bytes], [0x61, 0, 0x62]);
  assert.deepEqual([...runTool("cat", [], 5000, { input: "é", binary: true }).stdout], [0xc3, 0xa9]);
});

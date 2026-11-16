"use strict";
// ABOUTME: Tests the command-line reading: a plain scan's target and --json, and --deep with its ref, services, plan id,
// ABOUTME: budget and model; unknown, misplaced or malformed options are errors.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseCliArgs } = require("../../src/deep/args");

test("a plain scan takes one target and --json", () => {
  assert.deepEqual(parseCliArgs(["--json", "x"]), { ok: true, target: "x", json: true, deep: null });
});

test("--deep takes its options", () => {
  const parsed = parseCliArgs(["--deep", "--ref", "main", "--no-osv", "--budget", "500000", "--model", "opus", "https://github.com/o/r"]);
  assert.deepEqual(parsed.deep, { ref: "main", site: true, osv: false, claude: true, claudeOk: null, budget: 500000, model: "opus" });
});

test("--deep with no options uses the defaults", () => {
  assert.deepEqual(parseCliArgs(["--deep", "x"]), {
    ok: true,
    target: "x",
    json: false,
    deep: { ref: null, site: true, osv: true, claude: true, claudeOk: null, budget: null, model: "sonnet" },
  });
});

test("--claude-ok takes the plan id", () => {
  assert.equal(parseCliArgs(["--deep", "--claude-ok", "abc", "x"]).deep.claudeOk, "abc");
});

test("--claude-ok with --no-claude is an error", () => {
  assert.deepEqual(parseCliArgs(["--deep", "--no-claude", "--claude-ok", "abc", "x"]), { ok: false, error: "--claude-ok agrees to Claude's reading, which --no-claude turns off" });
});

test("deep options without --deep, a bad budget, or two targets are errors", () => {
  assert.equal(parseCliArgs(["--ref", "main", "x"]).ok, false);
  assert.equal(parseCliArgs(["--deep", "--budget", "lots", "x"]).ok, false);
  assert.equal(parseCliArgs(["x", "y"]).ok, false);
  assert.equal(parseCliArgs(["--bogus", "x"]).ok, false);
  assert.equal(parseCliArgs([]).ok, false);
});

test("--budget takes a positive whole number no larger than JavaScript counts exactly", () => {
  assert.equal(parseCliArgs(["--deep", "--budget", "0", "x"]).ok, false);
  assert.equal(parseCliArgs(["--deep", "--budget", "-5", "x"]).ok, false);
  assert.equal(parseCliArgs(["--deep", "--budget", String(Number.MAX_SAFE_INTEGER) + "0", "x"]).ok, false);
  assert.equal(parseCliArgs(["--deep", "--budget", String(Number.MAX_SAFE_INTEGER), "x"]).deep.budget, Number.MAX_SAFE_INTEGER);
  assert.equal(parseCliArgs(["--deep", "--budget", "1", "x"]).deep.budget, 1);
});

test("an unknown option is named plainly", () => {
  assert.deepEqual(parseCliArgs(["--jsn", "x"]), { ok: false, error: "unknown option --jsn" });
  assert.deepEqual(parseCliArgs(["-q", "x"]), { ok: false, error: "unknown option -q" });
});

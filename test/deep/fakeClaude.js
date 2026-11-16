// ABOUTME: Test helper: writes an executable stand-in for the claude CLI to a temporary folder. It reads its prompt from stdin,
// ABOUTME: logs its arguments, prompt and working folder to FAKE_CLAUDE_LOG, and prints a canned reply chosen by its environment.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// FAKE_CLAUDE_REPLY: a JSON file holding the structured output to give. FAKE_CLAUDE_MODE: refuse, limit, garbage, sleep,
// stubborn (keeps running through SIGTERM) or huge (a reply over 16 MB); with neither, it gives every part it was sent the verdict FAKE_CLAUDE_VERDICT (benign by default). FAKE_CLAUDE_TOKENS: the input
// tokens it reports for each call (100 by default).
const SCRIPT = String.raw`
const fs = require("fs");
const env = process.env;
let stdin = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (d) => { stdin += d; });
process.stdin.on("end", () => {
  if (env.FAKE_CLAUDE_LOG) {
    const entry = { argv: process.argv.slice(2), stdin, cwd: process.cwd(), cwdEntries: fs.readdirSync(process.cwd()), pid: process.pid, envKeys: Object.keys(env) };
    fs.appendFileSync(env.FAKE_CLAUDE_LOG, JSON.stringify(entry) + "\n");
  }
  const usage = { input_tokens: Number(env.FAKE_CLAUDE_TOKENS || 100), output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const reply = (fields) => process.stdout.write(JSON.stringify({ type: "result", is_error: false, usage, total_cost_usd: 0.01, ...fields }));
  const mode = env.FAKE_CLAUDE_MODE;
  if (mode === "sleep") return setTimeout(() => {}, 600000);
  if (mode === "stubborn") {
    process.on("SIGTERM", () => {});
    return setInterval(() => {}, 1000);
  }
  if (mode === "huge") return process.stdout.write("x".repeat(17 * 1024 * 1024));
  if (mode === "garbage") return process.stdout.write("this is not JSON");
  if (mode === "refuse") return reply({ stop_reason: "refusal", result: "I will not read this." });
  if (mode === "limit") {
    reply({ is_error: true, subtype: "error_during_execution", result: "Claude AI usage limit reached|1900000000" });
    process.exitCode = 1;
    return;
  }
  if (env.FAKE_CLAUDE_REPLY) return reply({ structured_output: JSON.parse(fs.readFileSync(env.FAKE_CLAUDE_REPLY, "utf-8")) });
  const parts = [...stdin.matchAll(/^<<<[0-9a-f]{16} path=("(?:[^"\\]|\\.)*") chunk=(\d+)\//gm)];
  const files = parts.map((m) => ({ path: JSON.parse(m[1]), chunk: Number(m[2]), verdict: env.FAKE_CLAUDE_VERDICT || "benign", findings: [] }));
  reply({ structured_output: { files } });
});
`;

function makeFakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scanskillsafety-fake-claude-"));
  const file = path.join(dir, "claude");
  fs.writeFileSync(file, `#!${process.execPath}\n${SCRIPT}`, { mode: 0o755 });
  return file;
}

// The calls the fake logged, oldest first.
function fakeClaudeCalls(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

module.exports = { makeFakeClaude, fakeClaudeCalls };

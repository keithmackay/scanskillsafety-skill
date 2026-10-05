// ABOUTME: Gathers a target's files (local or remote), runs the static scanner on each file
// ABOUTME: separately so every finding names the file it came from, and formats the result as
// ABOUTME: text or JSON. rating is null when nothing could be scanned — never "green". Findings with
// ABOUTME: severity "info" (e.g. install scripts) are listed as notes and never affect the rating.
"use strict";

const fs = require("fs");
const path = require("path");
const { scanText } = require("../lib/scanText");
const { SAFETY_SCANNER_NON_GOALS } = require("../lib/nonGoals");
const { parseTarget } = require("./parseTarget");
const { discoverLocal, MAX_FILE_BYTES } = require("./discover");
const { gatherGithub, gatherGitHost, gatherRawUrl } = require("./fetchRemote");

const RATING_ORDER = { green: 0, yellow: 1, red: 2 };

async function gather(target, fetchImpl) {
  switch (target.kind) {
    case "local-dir": {
      const files = discoverLocal(target.path);
      return { files, errors: files.length ? [] : ["no skill/plugin/MCP files (SKILL.md, README.md, plugin manifests, commands, agents, hooks, .mcp.json) found in this directory"], notices: [] };
    }
    case "local-file": {
      if (fs.statSync(target.path).size > MAX_FILE_BYTES) return { files: [], errors: ["file is larger than 512 KB"], notices: [] };
      return { files: [{ path: path.basename(target.path), text: fs.readFileSync(target.path, "utf-8") }], errors: [], notices: [] };
    }
    case "github": return gatherGithub(target, fetchImpl);
    case "git-host": return gatherGitHost(target, fetchImpl);
    case "raw-url": return gatherRawUrl(target.url, fetchImpl);
    default: return { files: [], errors: ["not a local path or an http(s) URL"], notices: [] };
  }
}

async function scanTarget(input, { fetchImpl = fetch } = {}) {
  const { files, errors, notices } = await gather(parseTarget(input), fetchImpl);
  const findings = [];
  let rating = files.length > 0 ? "green" : null;
  for (const file of files) {
    const result = scanText(file.text);
    if (RATING_ORDER[result.rating] > RATING_ORDER[rating]) rating = result.rating;
    for (const finding of result.findings) findings.push({ file: file.path, ...finding });
  }
  return {
    target: input,
    rating,
    scannedFiles: files.map((f) => f.path),
    findings,
    notices,
    errors,
    nonGoals: SAFETY_SCANNER_NON_GOALS.map((g) => g.title),
  };
}

function pushFinding(lines, f, label) {
  const where = f.line ? `${f.file}:${f.line}` : f.file;
  lines.push(`  ${where} [${label}] ${f.category}: ${f.detail}`);
  if (f.excerpt) lines.push(`      > ${f.excerpt}`);
}

function formatText(result) {
  const lines = [
    "scanskillsafety — static text analysis only. One signal, not a verdict. It does NOT check:",
    ...result.nonGoals.map((g) => `  - ${g}`),
    "",
    `Target: ${result.target}`,
  ];
  for (const n of result.notices) lines.push(`Note: ${n}`);
  if (result.rating === null) {
    lines.push("Rating: COULD NOT SCAN — no result. This is not a clean bill of health.");
    for (const e of result.errors) lines.push(`  error: ${e}`);
    return lines.join("\n");
  }
  lines.push(`Scanned ${result.scannedFiles.length} file(s): ${result.scannedFiles.join(", ")}`);
  for (const e of result.errors) lines.push(`  warning: could not fetch — ${e}`);
  lines.push(`Rating: ${result.rating.toUpperCase()}`);
  const issues = result.findings.filter((f) => f.severity !== "info");
  const notes = result.findings.filter((f) => f.severity === "info");
  if (issues.length === 0) lines.push("No issues found by the static scan.");
  for (const f of issues) pushFinding(lines, f, f.severity);
  if (notes.length > 0) {
    lines.push("", "Notes (these don't change the rating):");
    for (const f of notes) pushFinding(lines, f, "note");
  }
  return lines.join("\n");
}

const EXIT_CODES = { green: 0, yellow: 1, red: 2 };
const exitCodeFor = (result) => (result.rating === null ? 3 : EXIT_CODES[result.rating]);

module.exports = { scanTarget, formatText, exitCodeFor };

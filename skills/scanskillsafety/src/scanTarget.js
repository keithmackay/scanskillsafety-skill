// ABOUTME: Gathers a target's files (local or remote) and scans each separately, scripts with the code rules and the rest as
// ABOUTME: text, so every finding names its file; formats text or JSON. A null rating means nothing could be scanned; notes
// ABOUTME: (severity "info") never affect the rating.
"use strict";

const fs = require("fs");
const path = require("path");
const { scanText } = require("../lib/scanText");
const { scanScriptFile } = require("../lib/scanScriptFile");
const { ratingFromFindings } = require("../lib/ratingFromFindings");
const { partialScriptsNotice } = require("./scriptsNotice");
const { SAFETY_SCANNER_NON_GOALS } = require("../lib/nonGoals");
const { parseTarget } = require("./parseTarget");
const { discoverLocal, discoverLocalScripts, MAX_FILE_BYTES } = require("./discover");
const { gatherGithub, gatherGitHost, gatherRawUrl } = require("./fetchRemote");

// One file per path: a config that is also loaded as text (hooks.json, .mcp.json) is scanned as a script, at full weight.
function mergeByPath(textFiles, scriptFiles) {
  const scripts = new Set(scriptFiles.map((f) => f.path));
  return [...textFiles.filter((f) => !scripts.has(f.path)), ...scriptFiles];
}

async function gather(target, fetchImpl) {
  switch (target.kind) {
    case "local-dir": {
      const scripts = discoverLocalScripts(target.path);
      const files = mergeByPath(discoverLocal(target.path), scripts.files);
      return {
        files,
        errors: files.length ? [] : ["no skill/plugin/MCP files (SKILL.md, README.md, plugin manifests, commands, agents, hooks, .mcp.json) found in this directory"],
        notices: scripts.truncated ? [partialScriptsNotice()] : [],
      };
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
  const findings = files.flatMap((file) =>
    file.script ? scanScriptFile(file.path, file.text) : scanText(file.text).findings.map((finding) => ({ file: file.path, ...finding })),
  );
  const rating = files.length > 0 ? ratingFromFindings(findings) : null;
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

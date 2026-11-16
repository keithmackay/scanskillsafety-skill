// ABOUTME: The deep scan's text output: the plain scan's text, then the commit, the files read and left out, what runs at
// ABOUTME: install and start-up, the package check, findings in test files nothing launches and Claude's reading (its plan, or what
// ABOUTME: it found); and the services line.
"use strict";

const { formatText, pushFinding } = require("../scanTarget");

function formatServices(services) {
  if (services.length === 0) return "Deep scan will contact no service.";
  return `Deep scan will contact: ${services.map((s) => `${s.service} (${s.receives})`).join("; ")}.`;
}

function commitLine(deep) {
  if (deep.commit === null) return `Commit: ${deep.note}`;
  if (!deep.changesChecked) return `Commit: ${deep.commit}; ${deep.note}`;
  if (deep.changed) return `Commit: ${deep.commit}, with uncommitted changes: the files scanned are not exactly any commit`;
  return `Commit: ${deep.commit}`;
}

function packageLines(packages, findings) {
  if (packages.status === "off") return ["Packages: not checked (--no-osv)"];
  const lines = ["Packages:"];
  if (packages.status === "not-run") lines.push(`  The package check did not run (${packages.reason})`);
  else if (packages.checked === 0) lines.push("  No package found in a lockfile or manifest.");
  else lines.push(`  Checked ${packages.checked} package(s) against OSV.`);
  const malicious = findings.filter((f) => f.source === "osv" && f.category === "malicious-package");
  if (malicious.length > 0) lines.push("  Malicious (also in the findings above):");
  for (const f of malicious) lines.push(`    ${f.line ? `${f.file}:${f.line}` : f.file} ${f.detail}`);
  if (packages.vulnerabilities.length > 0) lines.push("  Known vulnerabilities (not counted in the rating):");
  for (const v of packages.vulnerabilities) {
    const severity = v.highest ? `highest ${v.highest}` : "severity not known";
    lines.push(`    ${v.ecosystem} ${v.name}@${v.version}: ${v.ids.length}, ${severity}: ${v.ids.join(", ")}`);
  }
  if (packages.detailsLeft > 0) {
    lines.push(`  ${packages.detailsLeft} more advisory id(s) are listed without severity: OSV's details were fetched for the first 200 only.`);
  }
  if (packages.namesOnly.length > 0) lines.push(`  Names only (no lockfile, so any version may be installed): ${packages.namesOnly.join(", ")}`);
  for (const c of packages.couldNotRead) lines.push(`  Could not read: ${c.file}: ${c.reason}`);
  if (packages.notChecked.length > 0) lines.push(`  Not checked (no support for these lockfiles): ${packages.notChecked.join(", ")}`);
  return lines;
}

const n = (x) => x.toLocaleString("en-US");

// What Claude would read and what it would cost, as shown before the person agrees.
function formatPlan(plan) {
  const lines = [
    `  Plan ${plan.id}: Claude (${plan.model}) would read ${plan.files.length} file(s) in ${plan.calls} call(s), about ${n(plan.inputTokens)} input and ${n(plan.outputTokens)} output tokens (an estimate).`,
    "  It sends their text to Anthropic, through your own claude CLI.",
    "  Files to read, in this order:",
    ...plan.files.map((f) => `    ${f.path}${f.parts > 1 ? ` (${f.parts} parts)` : ""}`),
  ];
  if (plan.leftOut.length > 0) lines.push("  Left out:", ...plan.leftOut.map((f) => `    ${f.path}: ${f.reason}`));
  return lines.join("\n");
}

function flaggedLines(claude, verdict, heading) {
  const files = claude.files.filter((f) => f.verdict === verdict);
  if (files.length === 0) return [];
  const lines = [`  ${heading}:`];
  for (const file of files) {
    lines.push(`    ${file.path}`);
    for (const f of claude.findings.filter((x) => x.path === file.path)) {
      lines.push(`      ${f.path}:${f.line} [${f.severity}] ${f.category}: ${f.reason}`);
      if (f.quote) lines.push(`        > ${f.quote}`);
    }
  }
  return lines;
}

function claudeLines(claude) {
  if (claude.status === "off") return ["Claude's reading: not run (--no-claude)"];
  if (claude.status === "skipped") return [`Claude's reading: skipped: ${claude.reason}`];
  if (claude.status === "planned") {
    return ["Claude's reading (not checked by a person): planned, not run", formatPlan(claude.plan), `  To run it, rerun with --claude-ok ${claude.plan.id}.`];
  }
  const lines = ["Claude's reading (not checked by a person)", `  Read with ${claude.plan.model}, on plan ${claude.plan.id}.`];
  if (claude.stopReason) lines.push(`  Stopped: ${claude.stopReason}.`);
  lines.push(...flaggedLines(claude, "malicious", "Malicious"), ...flaggedLines(claude, "suspicious", "Suspicious"));
  const benign = claude.files.filter((f) => f.verdict === "benign").length;
  if (benign > 0) lines.push(`  ${benign} file(s) Claude called benign.`);
  if (benign === claude.files.length) lines.push("  Claude flagged nothing; a file written to mislead a reviewer can pass.");
  if (claude.notRead.length > 0) lines.push(`  Not read (${claude.notRead.length}):`, ...claude.notRead.map((f) => `    ${f.path}: ${f.reason}`));
  if (claude.dropped > 0) lines.push(`  ${claude.dropped} of Claude's findings named lines it was not shown, and were dropped.`);
  lines.push(`  ${claude.usageLine}`);
  return lines;
}

function formatDeep(result) {
  const text = formatText(result);
  if (!result.deep.read) return text;
  const { deep } = result;
  const lines = ["", "Deep scan", commitLine(deep), `Read ${result.scannedFiles.length} file(s); left out ${deep.leftOut.length}${deep.leftOut.length ? ":" : "."}`];
  for (const f of deep.leftOut) lines.push(`  ${f.path}: ${f.reason}`);
  lines.push("What runs at install and start-up:");
  if (deep.installTime.length === 0) lines.push("  nothing found");
  for (const e of deep.installTime) lines.push(`  ${e.file}: ${e.when}: ${e.command}`);
  lines.push(...packageLines(deep.packages, result.findings));
  if (deep.launchedTests.length > 0) lines.push(`Test files the target runs (counted in the rating): ${deep.launchedTests.join(", ")}`);
  if (deep.testFindings.length > 0) {
    lines.push("Findings in test files nothing launches (not counted in the rating):");
    for (const f of deep.testFindings) pushFinding(lines, f, f.severity === "info" ? "note" : f.severity);
  }
  lines.push(...claudeLines(deep.claude));
  return [text, ...lines].join("\n");
}

module.exports = { formatDeep, formatServices, formatPlan };

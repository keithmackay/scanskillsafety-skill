// ABOUTME: The deep scan's text output: the plain scan's text, then the commit, the files read and left out, what runs at
// ABOUTME: install and start-up and findings in test files nothing launches; and the line naming the services it will contact.
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

function formatDeep(result) {
  const text = formatText(result);
  if (!result.deep.read) return text;
  const { deep } = result;
  const lines = ["", "Deep scan", commitLine(deep), `Read ${result.scannedFiles.length} file(s); left out ${deep.leftOut.length}${deep.leftOut.length ? ":" : "."}`];
  for (const f of deep.leftOut) lines.push(`  ${f.path}: ${f.reason}`);
  lines.push("What runs at install and start-up:");
  if (deep.installTime.length === 0) lines.push("  nothing found");
  for (const e of deep.installTime) lines.push(`  ${e.file}: ${e.when}: ${e.command}`);
  if (deep.launchedTests.length > 0) lines.push(`Test files the target runs (counted in the rating): ${deep.launchedTests.join(", ")}`);
  if (deep.testFindings.length > 0) {
    lines.push("Findings in test files nothing launches (not counted in the rating):");
    for (const f of deep.testFindings) pushFinding(lines, f, f.severity === "info" ? "note" : f.severity);
  }
  return [text, ...lines].join("\n");
}

module.exports = { formatDeep, formatServices };

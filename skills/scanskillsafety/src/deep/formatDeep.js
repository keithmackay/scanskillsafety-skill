// ABOUTME: The deep scan's text output: the plain scan's text, then the commit, the files read and left out, what runs at
// ABOUTME: install and start-up, the package check and findings in test files nothing launches; and the services line.
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
  return [text, ...lines].join("\n");
}

module.exports = { formatDeep, formatServices };

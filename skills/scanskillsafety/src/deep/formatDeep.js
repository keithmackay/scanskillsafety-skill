// ABOUTME: The deep scan's text output: the plain scan's text, then the commit, the files read and left out, what runs at
// ABOUTME: install and start-up, the package check and packages from outside the registry, how the commit relates to what findsafeskills scanned, findings in test files
// ABOUTME: nothing launches and Claude's reading (its plan, or what it found); and the services line.
"use strict";

const { formatText, pushFinding } = require("../scanTarget");
const { printable, printableCut, printableLines } = require("../printable");
const { n } = require("./util");
const { packageSource, lineText, fieldText } = require("./sourceText");

const COMMAND_MAX = 300;
const SITE_TEXT_MAX = 300;

const pathList = (paths) => paths.map(printable).join(", ");

function formatServices(services) {
  if (services.length === 0) return "Deep scan will contact no service.";
  return printable(`Deep scan will contact: ${services.map((s) => `${s.service} (${s.receives})`).join("; ")}.`);
}

function commitLine(deep) {
  if (deep.commit === null) return `Commit: ${deep.note}`;
  if (!deep.changesChecked) return `Commit: ${deep.commit}; ${deep.note}`;
  if (deep.changed) return `Commit: ${deep.commit}, with uncommitted changes: the files scanned are not exactly any commit`;
  return `Commit: ${deep.commit}`;
}

const couldNotReadLines = (packages) => (packages.couldNotRead ?? []).map((c) => `  Could not read: ${printable(c.file)}: ${c.reason}`);

function packageLines(packages, findings) {
  if (packages.status === "off") return ["Packages: not checked (--no-osv)", ...couldNotReadLines(packages)];
  const lines = ["Packages:"];
  if (packages.status === "not-run") lines.push(`  The package check did not run (${packages.reason})`);
  else if (packages.checked === 0 && packages.notSentToOsv > 0) lines.push("  No package was sent to OSV: every one comes from outside the registry.");
  else if (packages.checked === 0) lines.push("  No package found in a lockfile or manifest.");
  else lines.push(`  Checked ${packages.checked} package(s) against OSV.`);
  const malicious = findings.filter((f) => f.source === "osv" && f.category === "malicious-package");
  if (malicious.length > 0) lines.push("  Malicious (also in the findings above):");
  for (const f of malicious) lines.push(`    ${f.line ? `${printable(f.file)}:${f.line}` : printable(f.file)} ${f.detail}`);
  if (packages.vulnerabilities.length > 0) lines.push("  Known vulnerabilities (not counted in the rating):");
  for (const v of packages.vulnerabilities) {
    const severity = v.highest ? `highest ${v.highest}` : "severity not known";
    lines.push(`    ${v.ecosystem} ${v.name}@${v.version}: ${v.ids.length}, ${severity}: ${v.ids.join(", ")}`);
  }
  if (packages.detailsLeft > 0) {
    lines.push(`  ${packages.detailsLeft} more advisory id(s) are listed without severity: OSV's details were fetched for the first 200 only.`);
  }
  if (packages.namesOnly.length > 0) lines.push(`  Read from manifests (versions not fixed by a lockfile): ${pathList(packages.namesOnly)}`);
  lines.push(...couldNotReadLines(packages));
  if (packages.notChecked.length > 0) lines.push(`  Not checked (no support for these lockfiles): ${pathList(packages.notChecked)}`);
  return lines;
}

const count = (x, one, many) => `${n(x)} ${x === 1 ? one : many}`;

// A package as listed under its source: its name (or that it has none), its version when known, and its line.
const listedPackage = (p) => `${p.name === null ? "a package" : fieldText(p.name)}${p.version === null ? "" : ` ${fieldText(p.version)}`} (line ${p.line})`;

// One source's lines. A mirror, a plain-http host or a source it could not read is said once for all the packages of its file
// from there, a mirror's or http host's first five listed below it; a git, url or bundled source names its one package; a setting
// or index line says what it does.
function sourceEntryLines(entry) {
  const file = fieldText(printable(entry.file));
  if (entry.from) return [`  ${file}:${entry.line} ${lineText(entry)}`];
  const several = entry.total !== 1;
  const who = `${count(entry.total, "package", "packages")} in ${file}`;
  if (entry.kind === "unreadable") return [`  ${who} ${several ? "have" : "has"} a source it could not read (not checked against OSV)`];
  if (entry.kind === "host" || entry.kind === "http" || several) {
    const left = entry.total - entry.packages.length;
    const listed = [...entry.packages.map(listedPackage), ...(left > 0 ? [`… and ${n(left)} more`] : [])];
    return [`  ${who} ${several ? "come" : "comes"} from ${packageSource(entry)} (not checked against OSV):`, `    ${listed.join(", ")}`];
  }
  const [only] = entry.packages;
  const where = `${file}:${entry.line}`;
  return [`  ${only.name === null ? where : `${fieldText(only.name)} in ${where}`} comes from ${packageSource(entry)}`];
}

// The packages and settings from outside the registry (each also a finding), those past the entries kept counted, and each
// lockfile that records no registry; nothing when there are none, or when the result has no such fields.
function sourceLines(packages) {
  const { offRegistry = [], offRegistryMore = { packages: 0, lines: 0 }, notRecorded = [] } = packages;
  const more = [
    ...(offRegistryMore.packages > 0 ? [count(offRegistryMore.packages, "more package", "more packages")] : []),
    ...(offRegistryMore.lines > 0 ? [count(offRegistryMore.lines, "more setting", "more settings")] : []),
  ];
  if (offRegistry.length === 0 && more.length === 0 && notRecorded.length === 0) return [];
  const lines = ["Packages from outside the registry (also in the findings above):", ...offRegistry.flatMap(sourceEntryLines)];
  if (more.length > 0) lines.push(`  and ${more.join(" and ")} from other sources`);
  for (const note of notRecorded) {
    lines.push(`  ${fieldText(printable(note.file))} does not record where its packages come from; no config in the target names a registry, so they come from whatever registry the installing machine uses`);
  }
  return lines;
}

const commits = (count) => `${n(count)} commit${count === 1 ? "" : "s"}`;
const dayOf = (timestamp) => (timestamp === null ? "an unknown date" : printable(timestamp.slice(0, 10)));

// How one scan's commit relates to the commit read here. The lookup dates only the text scan, so a script scan's line has no date.
function relationLine(scan, scannedAt) {
  if (scan.relation === "same") return "findsafeskills scanned this commit";
  const scanned = `findsafeskills scanned ${scan.commit.slice(0, 7)}${scannedAt === undefined ? "" : ` on ${dayOf(scannedAt)}`}`;
  if (scan.relation === "newer") return `${scanned}; this commit is ${commits(scan.by)} newer`;
  if (scan.relation === "older") return `${scanned}; this commit is ${commits(scan.by)} older`;
  if (scan.relation === "diverged") {
    return `${scanned}; the two have diverged (this commit has ${commits(scan.newerBy)} the scanned one lacks, and the scanned one has ${n(scan.olderBy)} this commit lacks)`;
  }
  return `${scanned} (not compared: ${printableCut(scan.reason, SITE_TEXT_MAX)})`;
}

function siteLines(site) {
  if (site.status === "off") return ["findsafeskills: not compared (--no-site)"];
  if (site.status === "local") return ["findsafeskills: not compared (a local folder has no repository address)"];
  if (site.status === "unreachable") return [`findsafeskills: could not reach findsafeskills (${printableCut(site.reason, SITE_TEXT_MAX)})`];
  if (site.status === "refused") return [`findsafeskills: ${printableCut(site.reason, SITE_TEXT_MAX)}`];
  if (site.status === "not-listed") return ["findsafeskills: not listed on findsafeskills"];
  const lines = ["findsafeskills:"];
  for (const listing of site.listings) {
    const rating = listing.rating === null ? "no rating" : `rating: ${printableCut(listing.rating, SITE_TEXT_MAX)}`;
    lines.push(`  ${listing.url === null ? "a listing with no page address" : printableCut(listing.url, SITE_TEXT_MAX)} (${rating})`);
    if (listing.text && listing.scripts && listing.text.commit === listing.scripts.commit) {
      lines.push(`    Text and script scans: ${relationLine(listing.text, listing.scannedAt)}`);
      continue;
    }
    if (listing.text) lines.push(`    Text scan: ${relationLine(listing.text, listing.scannedAt)}`);
    if (listing.scripts) lines.push(`    Script scan: ${relationLine(listing.scripts)}`);
    if (!listing.text && !listing.scripts) lines.push(`    Scanned on ${dayOf(listing.scannedAt)}, with no commit recorded to compare`);
  }
  if (site.more > 0) lines.push(`  ${n(site.more)} more listing(s) not shown`);
  return lines;
}

// What Claude would read and what it would cost, as shown before the person agrees.
function planLines(plan) {
  const lines = [
    `  Plan ${plan.id}: Claude (${plan.model}) would read ${plan.files.length} file(s) in ${plan.calls} call(s), about ${n(plan.inputTokens)} input and ${n(plan.outputTokens)} output tokens (an estimate).`,
    "  It sends their text to Anthropic, through your own claude CLI.",
    "  Files to read, in this order:",
    ...plan.files.map((f) => `    ${f.path}${f.parts > 1 ? ` (${f.parts} parts)` : ""}`),
  ];
  if (plan.leftOut.length > 0) lines.push("  Left out:", ...plan.leftOut.map((f) => `    ${f.path}: ${f.reason}`));
  return lines;
}

const formatPlan = (plan) => printableLines(planLines(plan));

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
    return ["Claude's reading (not checked by a person): planned, not run", ...planLines(claude.plan), `  To run it, ask the person first; if they agree, rerun with --claude-ok ${claude.plan.id}. Never pass --claude-ok without their yes.`];
  }
  const lines = ["Claude's reading (not checked by a person)", `  Read with ${claude.plan.model}, on plan ${claude.plan.id}.`];
  if (claude.stopReason) lines.push(`  Stopped: ${claude.stopReason}.`);
  lines.push(...flaggedLines(claude, "malicious", "Malicious"), ...flaggedLines(claude, "suspicious", "Suspicious"));
  const benign = claude.files.filter((f) => f.verdict === "benign").length;
  if (benign > 0) lines.push(`  ${benign} file(s) Claude called benign.`);
  if (claude.files.length === 0) lines.push("  Claude read no file.");
  else if (benign === claude.files.length) lines.push("  Claude flagged nothing; a file written to mislead a reviewer can pass.");
  if (claude.notRead.length > 0) lines.push(`  Not read (${claude.notRead.length}):`, ...claude.notRead.map((f) => `    ${f.path}: ${f.reason}`));
  if (claude.dropped > 0) lines.push(`  ${claude.dropped} of Claude's findings named lines it was not shown, and were dropped.`);
  lines.push(`  ${claude.usageLine}`);
  return lines;
}

function formatDeep(result) {
  const text = formatText(result);
  if (!result.deep.read) return text;
  const { deep } = result;
  const route = deep.route === null ? [] : [deep.route.method === "git" ? "Read with git" : `Read from the archive; ${deep.route.reason}`];
  const lines = ["", "Deep scan", commitLine(deep), ...route, `Read ${result.scannedFiles.length} file(s); left out ${deep.leftOut.length}${deep.leftOut.length ? ":" : "."}`];
  for (const f of deep.leftOut) lines.push(`  ${printable(f.path)}: ${f.reason}`);
  if (deep.fetchedSeparately.length > 0) lines.push(`Left out of the archive by .gitattributes; fetched separately: ${pathList(deep.fetchedSeparately)}`);
  lines.push("What runs at install and start-up:");
  if (deep.installTime.length === 0) lines.push("  nothing found");
  for (const e of deep.installTime) lines.push(`  ${printable(e.file)}: ${printable(e.when)}: ${printableCut(e.command, COMMAND_MAX)}`);
  lines.push(...packageLines(deep.packages, result.findings), ...sourceLines(deep.packages));
  lines.push(...siteLines(deep.site));
  if (deep.launchedTests.length > 0) lines.push(`Test files the target runs (counted in the rating): ${pathList(deep.launchedTests)}`);
  if (deep.testFindings.length > 0) {
    lines.push("Findings in test files nothing launches (not counted in the rating):");
    for (const f of deep.testFindings) pushFinding(lines, f, f.severity === "info" ? "note" : f.severity);
  }
  lines.push(...claudeLines(deep.claude));
  return [text, printableLines(lines)].join("\n");
}

module.exports = { formatDeep, formatServices, formatPlan };

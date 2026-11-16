// ABOUTME: Runs a deep scan's stages in order and builds its result: the plain scan's shape plus `deep`, holding the services it
// ABOUTME: may contact (named before any request), the exact commit and how it relates to what findsafeskills scanned, every
// ABOUTME: file's findings, what runs at install and start-up, what OSV knows about the packages it pulls in, and Claude's reading
// ABOUTME: of every file once the person agrees to its plan.
"use strict";

const { posix } = require("path");
const { ratingFromFindings } = require("../../lib/ratingFromFindings");
const { SAFETY_SCANNER_NON_GOALS } = require("../../lib/nonGoals");
const { parseTarget } = require("../parseTarget");
const { fetchCommit, ARCHIVE_LIMITS } = require("./archive");
const { localCommit } = require("./localCommit");
const { listEveryFile } = require("./everyFile");
const { scanEveryFile } = require("./scanEveryFile");
const { installTimeEntries } = require("./installTime");
const { readPackages } = require("./lockfiles");
const { checkPackages, osvUrl } = require("./osv");
const { compareWithSite, siteUrl } = require("./siteCompare");
const { findClaude } = require("./runClaude");
const { chooseForReading, planReading, readEveryFile, quoteLine } = require("./reading");
const { printable, printableCut } = require("../printable");
const { isDiscoverable } = require("../discover");
const { formatClaudeUsage } = require("../../lib/deep/claudeUsage");

const isRepository = (target) => (target.kind === "github" || target.kind === "git-host") && !target.isFile;

// The hosts the commit stage contacts for a repository; a local folder is read in place.
function commitServices(target) {
  if (target.kind === "github") {
    return [
      { service: "api.github.com", receives: "a request for this repository's commit id" },
      { service: "codeload.github.com", receives: "a request for that commit's archive" },
    ];
  }
  if (target.kind === "git-host") return [{ service: new URL(target.origin).host, receives: "requests for this repository, its commit id and its archive" }];
  return [];
}

// A repository's address goes to the site; GitHub is asked how this commit relates to each commit the site scanned.
function siteServices(target, options) {
  if (!options.site || !isRepository(target)) return [];
  const site = { service: new URL(siteUrl()).host, receives: "this repository's address" };
  if (target.kind !== "github") return [site];
  return [site, { service: "api.github.com", receives: "a request comparing this commit with the one findsafeskills scanned, if it is listed" }];
}

const osvServices = (target, options) =>
  options.osv ? [{ service: new URL(osvUrl()).host, receives: "the names, ecosystems and versions of the packages it uses" }] : [];

// Named whenever Claude's reading may run: the person still agrees to its plan before anything is sent.
const claudeServices = (target, options, { claudeFound }) =>
  claudeFound ? [{ service: "Anthropic, through your own claude CLI", receives: "the text of the files Claude reads, only after you agree" }] : [];

const ADDRESS_SHOWN_MAX = 200;

const isWebAddress = (value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

// The addresses the environment gives the services this run would contact, each of which must be an http or https address.
function addressErrors(target, options) {
  const given = [];
  if (options.site && isRepository(target)) given.push(["FINDSAFESKILLS_URL", siteUrl()]);
  if (options.osv) given.push(["OSV_URL", osvUrl()]);
  return given.filter(([, value]) => !isWebAddress(value)).map(([name, value]) => `${name} is not an http or https address: ${printableCut(value, ADDRESS_SHOWN_MAX)}`);
}

// Each stage that contacts a service names it here, with what it receives, so the list is complete before any request.
const SERVICE_STAGES = [commitServices, siteServices, osvServices, claudeServices];
const servicesFor = (target, options, found) => SERVICE_STAGES.flatMap((stage) => stage(target, options, found));

// The folder to read: a local folder in place, or a repository's exact commit unpacked into a temporary folder.
async function openTarget(target, options, deps) {
  if (target.kind === "local-dir") return { root: target.path, ...localCommit(target.path), cleanup: () => {} };
  const { commit, root, cleanup } = await fetchCommit(target, options.ref, deps.fetchImpl ?? fetch, deps.limits ?? ARCHIVE_LIMITS);
  return { root, commit, changed: false, changesChecked: true, note: null, cleanup };
}

// The folders a command's relative path may start from: the folder of the file naming it, each folder above it (a plugin's
// hooks and manifest name scripts from the plugin's folder), and the root.
function ancestors(file) {
  const folders = [];
  for (let folder = posix.dirname(file); folder !== "."; folder = posix.dirname(folder)) folders.push(folder);
  return [...folders, ""];
}

// Files that say what runs at install and start-up, and the files of the target their commands name.
function installPaths(entries, files) {
  const paths = new Set(files.map((f) => f.path));
  const named = entries.flatMap((e) =>
    e.command.split(/\s+/)
      .map((word) => word.replace(/^["'`]+|["'`]+$/g, "").replace(/^(\.\/|\$\{?\w+\}?\/)/, ""))
      .filter(Boolean)
      .flatMap((word) => {
        const found = ancestors(e.file).map((folder) => posix.join(folder, word)).find((p) => paths.has(p));
        return found ? [found] : [];
      }),
  );
  return [...entries.map((e) => e.file), ...named];
}

// What Claude would read and what it would cost. The plan id pins the model and the exact text read, and for a repository the
// commit too ("<commit>:<digest>"), so a --claude-ok given for it reads nothing else.
function claudePlan(target, files, entries, opened, model) {
  const agentPaths = files.map((f) => f.path).filter(isDiscoverable);
  const { reading, leftOut } = chooseForReading(files, { installPaths: installPaths(entries, files), agentPaths });
  const { calls, estimate, planId } = planReading(reading, model);
  const parts = new Map();
  for (const c of calls.flat()) parts.set(c.path, (parts.get(c.path) ?? 0) + 1);
  const plan = {
    id: target.kind === "local-dir" ? planId : `${opened.commit}:${planId}`,
    model,
    files: reading.map((f) => ({ path: printable(f.path), parts: parts.get(f.path) })),
    leftOut: leftOut.map((f) => ({ path: printable(f.path), reason: f.reason })),
    calls: estimate.calls,
    inputTokens: estimate.inputTokens,
    outputTokens: estimate.outputTokens,
  };
  return { plan, calls };
}

const agreed = (answer) => /^\s*(y|yes)\s*$/i.test(answer ?? "");

// Claude's reading: planned only, asked for in a terminal, or run on the plan id the person agreed to.
async function claudeStage({ plan, calls }, files, options, claudePath, deps) {
  if (plan.files.length === 0) return { status: "skipped", reason: "no file for Claude to read" };
  if (!options.claudeOk) {
    if (!deps.interactive) return { status: "planned", plan };
    if (deps.onPlan) deps.onPlan(plan);
    if (!agreed(await deps.ask("Run Claude's reading? [y/N] "))) return { status: "skipped", reason: "you did not agree to it" };
  }
  const outcome = await readEveryFile({
    calls, model: options.model, budget: options.budget, command: claudePath, env: deps.env ?? process.env, timeoutMs: deps.claudeTimeoutMs,
  });
  const textOf = new Map(files.map((f) => [f.path, f.text]));
  return {
    status: outcome.status,
    stopReason: outcome.stopReason,
    plan,
    files: outcome.files.map((f) => ({ path: printable(f.path), verdict: f.verdict })),
    findings: outcome.findings.map((f) => ({
      path: printable(f.path), line: f.line, category: f.category, severity: f.severity, reason: f.reason, quote: quoteLine(textOf.get(f.path), f.line),
    })),
    dropped: outcome.dropped,
    notRead: outcome.notRead.map((f) => ({ path: printable(f.path), reason: f.reason })),
    usageLine: formatClaudeUsage(outcome.usage),
  };
}

// The packages the files pull in, checked against OSV unless the person turned that off.
async function packageCheck(files, leftOut, options, fetchImpl) {
  if (!options.osv) return { findings: [], packages: { status: "off" } };
  const { packages, namesOnly, couldNotRead, notChecked } = readPackages(files, leftOut);
  const checked = await checkPackages(packages, fetchImpl);
  const { findings = [], vulnerabilities = [], detailsLeft = 0, reason = null } = checked;
  return {
    findings,
    packages: { status: checked.status, checked: packages.length, namesOnly, couldNotRead, notChecked, vulnerabilities, detailsLeft, reason },
  };
}

async function runDeep(input, options, deps = {}) {
  const target = parseTarget(input);
  const found = options.claude ? findClaude(deps.env ?? process.env) : null;
  const claudePath = found?.path ?? null;
  const badAddresses = addressErrors(target, options);
  const readable = target.kind === "local-dir" || isRepository(target);
  const services = readable && badAddresses.length === 0 ? servicesFor(target, options, { claudeFound: claudePath !== null }) : [];
  const result = {
    target: input,
    rating: null,
    scannedFiles: [],
    findings: [],
    notices: [],
    errors: [],
    nonGoals: SAFETY_SCANNER_NON_GOALS.map((g) => g.title),
    deep: {
      services,
      read: false,
      commit: null,
      changed: false,
      changesChecked: false,
      note: null,
      leftOut: [],
      installTime: [],
      testFindings: [],
      launchedTests: [],
      site: { status: "off" },
      packages: { status: "off" },
      claude: found?.reason ? { status: "skipped", reason: found.reason } : { status: "off" },
    },
  };
  if (target.kind !== "local-dir" && !isRepository(target)) {
    result.errors.push("--deep needs a repository URL or a local folder");
    return result;
  }
  if (badAddresses.length > 0) {
    result.errors.push(...badAddresses);
    return result;
  }
  if (deps.onServices) deps.onServices(services);
  // Agreeing to a repository's plan pins its commit: with no --ref, that commit is the one read.
  const agreedCommit = /^([0-9a-f]{40}|[0-9a-f]{64}):[0-9a-f]+$/.exec(options.claudeOk ?? "")?.[1];
  const pinned = claudePath && agreedCommit && isRepository(target) && !options.ref ? { ...options, ref: agreedCommit } : options;
  let opened;
  try {
    opened = await openTarget(target, pinned, deps);
  } catch (err) {
    result.errors.push(err.message);
    return result;
  }
  try {
    const { files, leftOut } = listEveryFile(opened.root);
    const entries = installTimeEntries(files);
    const reading = claudePath && files.length > 0 ? claudePlan(target, files, entries, opened, options.model) : null;
    if (reading && options.claudeOk && options.claudeOk !== reading.plan.id) {
      result.deep.commit = opened.commit;
      result.errors.push(`the target or model changed since the plan (plan id ${options.claudeOk}, now ${reading.plan.id}); run --deep again without --claude-ok`);
      return result;
    }
    const { findings: fileFindings, testFindings, launched } = scanEveryFile(files);
    const { findings: packageFindings, packages } = await packageCheck(files, leftOut, options, deps.fetchImpl ?? fetch);
    const site = options.site ? await compareWithSite(target, opened.commit, deps.fetchImpl ?? fetch) : { status: "off" };
    const findings = [...fileFindings, ...packageFindings];
    Object.assign(result, {
      rating: files.length > 0 ? ratingFromFindings(findings) : null,
      scannedFiles: files.map((f) => f.path),
      findings,
      errors: files.length > 0 ? [] : ["no text file to read"],
    });
    Object.assign(result.deep, {
      read: true,
      commit: opened.commit,
      changed: opened.changed,
      changesChecked: opened.changesChecked,
      note: opened.note,
      leftOut,
      installTime: entries,
      testFindings,
      launchedTests: launched,
      site,
      packages,
    });
    if (reading) result.deep.claude = await claudeStage(reading, files, options, claudePath, deps);
    return result;
  } finally {
    opened.cleanup();
  }
}

module.exports = { runDeep };

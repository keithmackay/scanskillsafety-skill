// ABOUTME: Runs a deep scan's stages in order and builds its result: the plain scan's shape plus `deep`, holding the services it
// ABOUTME: may contact (named before any request), the exact commit and how it relates to what findsafeskills scanned, every
// ABOUTME: file's findings, what runs at install and start-up, what OSV knows about the packages it pulls in, and Claude's reading
// ABOUTME: of every file once the person agrees to its plan.
"use strict";

const { posix } = require("path");
const { ratingFromFindings } = require("../../lib/ratingFromFindings");
const { SAFETY_SCANNER_NON_GOALS } = require("../../lib/nonGoals");
const { parseTarget } = require("../parseTarget");
const { fetchCommit, resolveRef } = require("./archive");
const { readCommitWithGit, findGit, gitUrl } = require("./gitCommit");
const { localCommit } = require("./localCommit");
const { listEveryFile } = require("./everyFile");
const { scanEveryFile, splitTestFindings } = require("./scanEveryFile");
const { installTimeEntries } = require("./installTime");
const { readPackages, NO_PINS_REASON, UNREADABLE_SOURCE_REASON } = require("./lockfiles");
const { checkPackages, osvUrl } = require("./osv");
const { groupSources } = require("./packageSources");
const { sourceDetail } = require("./sourceText");
const { compareWithSite, siteUrl } = require("./siteCompare");
const { findClaude } = require("./runClaude");
const { chooseForReading, planReading, readEveryFile, quoteLine } = require("./reading");
const { printable, cut } = require("../printable");
const { isDiscoverable } = require("../discover");
const { OBJECT_ID, COMMIT_LIMITS } = require("./util");
const { formatClaudeUsage } = require("../../lib/deep/claudeUsage");

const isRepository = (target) => (target.kind === "github" || target.kind === "git-host") && !target.isFile;

// The hosts the commit stage contacts for a repository: the commit id from its API, then a git fetch, or without git its archive;
// a local folder is read in place.
function commitServices(target, options, { git }) {
  if (target.kind === "github") {
    if (git.found) {
      return [
        { service: "api.github.com", receives: "a request for this repository's commit id" },
        { service: "github.com", receives: "a git fetch of this commit, with no credentials sent" },
      ];
    }
    return [
      { service: "api.github.com", receives: "requests for this repository's commit id and file list, and for any file the archive leaves out" },
      { service: "codeload.github.com", receives: "a request for that commit's archive" },
    ];
  }
  if (target.kind !== "git-host") return [];
  const host = new URL(target.origin).host;
  if (git.found) {
    return [{
      service: host,
      receives: "requests for this repository and its commit id, and a git fetch of this commit, with no credentials sent; if the host will not serve that commit to git, its archive and file list, and any file the archive leaves out",
    }];
  }
  return [{ service: host, receives: "requests for this repository, its commit id, file list and archive, and any file the archive leaves out" }];
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
  return given.filter(([, value]) => !isWebAddress(value)).map(([name, value]) => `${name} is not an http or https address: ${cut(printable(value), ADDRESS_SHOWN_MAX)}`);
}

// Each stage that contacts a service names it here, with what it receives, so the list is complete before any request.
const SERVICE_STAGES = [commitServices, siteServices, osvServices, claudeServices];
const servicesFor = (target, options, found) => SERVICE_STAGES.flatMap((stage) => stage(target, options, found));

// The files to read and where they came from: a local folder in place, or a repository's exact commit, read with git when git
// is installed and otherwise from the commit's archive.
async function openTarget(target, options, deps, git) {
  if (target.kind === "local-dir") return { ...listEveryFile(target.path), ...localCommit(target.path), fetchedSeparately: [], route: null };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limits = { ...COMMIT_LIMITS, ...deps.limits };
  if (!git.found) return fromArchive(target, options.ref, fetchImpl, limits, { method: "archive", reason: "git is not installed" });
  const commit = await resolveRef(target, options.ref, fetchImpl);
  try {
    const { files, leftOut } = await readCommitWithGit({
      target, commit, ref: options.ref, url: deps.gitUrl ? deps.gitUrl(target) : gitUrl(target), limits, git,
      env: deps.env ?? process.env, testOnlyProtocols: deps.testOnlyProtocols ?? [],
    });
    return { files, leftOut, commit, changed: false, changesChecked: true, note: null, fetchedSeparately: [], route: { method: "git" } };
  } catch (err) {
    // A Gitea or Forgejo archive comes from the same host the services line names; GitHub's would be another host.
    if (!err.gitRefused || target.kind !== "git-host") throw err;
    return fromArchive(target, commit, fetchImpl, limits, { method: "archive", reason: `the host would not serve this commit to git (${err.message})` });
  }
}

// A repository's commit read from its archive, unpacked into a temporary folder that is removed once its files are read.
async function fromArchive(target, ref, fetchImpl, limits, route) {
  const { commit, root, cleanup, fetchedSeparately, leftOut } = await fetchCommit(target, ref, fetchImpl, limits);
  try {
    const listed = listEveryFile(root);
    // Submodules and links the archive left out are known only from the commit's file list.
    const allLeftOut = [...listed.leftOut, ...leftOut].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { files: listed.files, leftOut: allLeftOut, commit, changed: false, changesChecked: true, note: null, fetchedSeparately, route };
  } finally {
    cleanup();
  }
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

// The warning an entry of packages or settings from outside the registry adds.
const sourceFinding = (entry) =>
  ({ severity: "warning", category: "package-source", source: "deep", file: entry.file, line: entry.line, detail: sourceDetail(entry) });

// A file that can install packages but could not be read may name any source, so it is a warning too. A file read but for a source
// it could not read is not: that source is already a warning of its own. Nor is a requirements file with no pins: it installs from
// PyPI, so nothing about its sources is unknown.
const REASONS_ADDING_NO_WARNING = new Set([UNREADABLE_SOURCE_REASON, NO_PINS_REASON]);
const unreadFinding = ({ file, reason }) =>
  ({ severity: "warning", category: "package-source", source: "deep", file, line: null, detail: `could not be read: ${reason}` });

// How many distinct packages (ecosystem, name and version) were kept from OSV for their source; a setting or index line is no
// package, one package named in several files or lines counts once, and each package with no name found counts on its own.
function distinctPackages(sourced) {
  const packages = sourced.filter((item) => item.from === undefined);
  const named = packages.filter((item) => item.name !== null);
  return new Set(named.map((item) => [item.ecosystem, item.name, item.version ?? ""].join("\0"))).size + packages.length - named.length;
}

// The packages the files pull in and where each comes from, read whether or not OSV is asked; those from the official registry
// are checked against OSV unless the person turned that off. Packages from elsewhere are never sent to OSV, since their name may
// not mean what OSV's record means.
async function packageCheck(files, leftOut, options, fetchImpl) {
  const { packages, namesOnly, couldNotRead, notChecked, sourced, notRecorded } = readPackages(files, leftOut);
  const { entries, more } = groupSources(sourced);
  const sources = {
    offRegistry: entries,
    offRegistryMore: more,
    notRecorded,
    notSentToOsv: distinctPackages(sourced),
  };
  const unreadFiles = couldNotRead.filter((c) => !REASONS_ADDING_NO_WARNING.has(c.reason));
  const sourceFindings = [...entries.map(sourceFinding), ...unreadFiles.map(unreadFinding)];
  if (!options.osv) return { findings: sourceFindings, packages: { status: "off", ...sources, couldNotRead } };
  const checked = await checkPackages(packages, fetchImpl);
  const { findings = [], vulnerabilities = [], detailsLeft = 0, reason = null } = checked;
  return {
    findings: [...findings, ...sourceFindings],
    packages: { status: checked.status, checked: packages.length, namesOnly, couldNotRead, notChecked, vulnerabilities, detailsLeft, reason, ...sources },
  };
}

async function runDeep(input, options, deps = {}) {
  const target = parseTarget(input);
  const found = options.claude ? findClaude(deps.env ?? process.env) : null;
  const claudePath = found?.path ?? null;
  const badAddresses = addressErrors(target, options);
  const refOnLocal = target.kind === "local-dir" && options.ref !== null && options.ref !== undefined;
  const readable = (target.kind === "local-dir" && !refOnLocal) || isRepository(target);
  // Whether git is installed decides which hosts a repository's commit comes from, so it is known before the services are named.
  const git = readable && isRepository(target) ? deps.git ?? findGit(deps.env ?? process.env) : { found: false, filter: false };
  const services = readable && badAddresses.length === 0 ? servicesFor(target, options, { claudeFound: claudePath !== null, git }) : [];
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
      fetchedSeparately: [],
      route: null,
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
  // A local folder is read as it is, so a ref would name a commit the scan does not read.
  if (refOnLocal) {
    result.errors.push("--ref needs a repository URL; a local folder is read as it is");
    return result;
  }
  if (badAddresses.length > 0) {
    result.errors.push(...badAddresses);
    return result;
  }
  if (deps.onServices) deps.onServices(services);
  // Agreeing to a repository's plan pins its commit: with no --ref, that commit is the one read.
  const [agreedCommit, agreedDigest] = (options.claudeOk ?? "").split(":");
  const pinsCommit = OBJECT_ID.test(agreedCommit) && agreedDigest !== undefined;
  const pinned = claudePath && pinsCommit && isRepository(target) && !options.ref ? { ...options, ref: agreedCommit } : options;
  let opened;
  try {
    opened = await openTarget(target, pinned, deps, git);
  } catch (err) {
    result.errors.push(err.message);
    return result;
  }
  const { files, leftOut } = opened;
  const entries = installTimeEntries(files);
  const reading = claudePath && files.length > 0 ? claudePlan(target, files, entries, opened, options.model) : null;
  if (reading && options.claudeOk && options.claudeOk !== reading.plan.id) {
    result.deep.commit = opened.commit;
    result.errors.push(`the target or model changed since the plan (plan id ${options.claudeOk}, now ${reading.plan.id}); run --deep again without --claude-ok`);
    return result;
  }
  const { findings: fileFindings, testFindings: fileTestFindings, launched } = scanEveryFile(files);
  const { findings: packageFindings, packages } = await packageCheck(files, leftOut, options, deps.fetchImpl ?? fetch);
  // A package source or unreadable install file in a test file nothing launches is kept apart as the other findings there are; a
  // package OSV calls malicious counts wherever its lockfile is.
  const sourceSplit = splitTestFindings(packageFindings.filter((f) => f.source === "deep"), new Set(launched));
  const site = options.site ? await compareWithSite(target, opened.commit, deps.fetchImpl ?? fetch) : { status: "off" };
  const findings = [...fileFindings, ...packageFindings.filter((f) => f.source !== "deep"), ...sourceSplit.findings];
  const testFindings = [...fileTestFindings, ...sourceSplit.testFindings];
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
    fetchedSeparately: opened.fetchedSeparately,
    route: opened.route,
    installTime: entries,
    testFindings,
    launchedTests: launched,
    site,
    packages,
  });
  if (reading) result.deep.claude = await claudeStage(reading, files, options, claudePath, deps);
  return result;
}

module.exports = { runDeep };

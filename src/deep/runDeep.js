// ABOUTME: Runs a deep scan's stages in order and builds its result: the plain scan's shape plus `deep`, holding the services it
// ABOUTME: may contact (named before any request), the exact commit, every file's findings and what runs at install and start-up.
"use strict";

const { ratingFromFindings } = require("../../lib/ratingFromFindings");
const { SAFETY_SCANNER_NON_GOALS } = require("../../lib/nonGoals");
const { parseTarget } = require("../parseTarget");
const { fetchCommit, ARCHIVE_LIMITS } = require("./archive");
const { localCommit } = require("./localCommit");
const { listEveryFile } = require("./everyFile");
const { scanEveryFile } = require("./scanEveryFile");
const { installTimeEntries } = require("./installTime");

const isRepository = (target) => (target.kind === "github" || target.kind === "git-host") && !target.isFile;
const hostOf = (target) => (target.kind === "github" ? "github.com" : new URL(target.origin).host);

function servicesFor(target, options) {
  const services = [];
  if (isRepository(target)) services.push({ service: hostOf(target), receives: "requests for this repository's commit id and archive" });
  if (isRepository(target) && options.site) services.push({ service: "findsafeskills.com", receives: "the repository URL" });
  if (options.osv) services.push({ service: "api.osv.dev", receives: "package names, ecosystems and versions" });
  if (options.claude) {
    services.push({ service: "Anthropic", receives: "the contents of the files Claude reads, through your claude program, only after you agree" });
  }
  return services;
}

// The folder to read: a local folder in place, or a repository's exact commit unpacked into a temporary folder.
async function openTarget(target, options, deps) {
  if (target.kind === "local-dir") return { root: target.path, ...localCommit(target.path), cleanup: () => {} };
  const { commit, root, cleanup } = await fetchCommit(target, options.ref, deps.fetchImpl, deps.limits ?? ARCHIVE_LIMITS);
  return { root, commit, changed: false, changesChecked: true, cleanup };
}

async function runDeep(input, options, deps = {}) {
  const target = parseTarget(input);
  const services = target.kind === "local-dir" || isRepository(target) ? servicesFor(target, options) : [];
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
      commit: null,
      changed: false,
      changesChecked: false,
      leftOut: [],
      installTime: [],
      testFindings: [],
      launchedTests: [],
      site: { status: "off" },
      packages: { status: "off" },
      claude: { status: "off" },
    },
  };
  if (target.kind !== "local-dir" && !isRepository(target)) {
    result.errors.push("--deep needs a repository URL or a local folder");
    return result;
  }
  if (deps.onServices) deps.onServices(services);
  let opened;
  try {
    opened = await openTarget(target, options, { fetchImpl: fetch, ...deps });
  } catch (err) {
    result.errors.push(err.message);
    return result;
  }
  try {
    const { files, leftOut } = listEveryFile(opened.root);
    const { findings, testFindings, launched } = scanEveryFile(files);
    Object.assign(result, {
      rating: files.length > 0 ? ratingFromFindings(findings) : null,
      scannedFiles: files.map((f) => f.path),
      findings,
      errors: files.length > 0 ? [] : ["no text file to read"],
    });
    Object.assign(result.deep, {
      commit: opened.commit,
      changed: opened.changed,
      changesChecked: opened.changesChecked,
      leftOut,
      installTime: installTimeEntries(files),
      testFindings,
      launchedTests: launched,
    });
    return result;
  } finally {
    opened.cleanup();
  }
}

module.exports = { runDeep };

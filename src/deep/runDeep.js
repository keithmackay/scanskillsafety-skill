// ABOUTME: Runs a deep scan's stages in order and builds its result: the plain scan's shape plus `deep`, holding the services it
// ABOUTME: may contact (named before any request), the exact commit, every file's findings, what runs at install and start-up and
// ABOUTME: what OSV knows about the packages it pulls in.
"use strict";

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

const isRepository = (target) => (target.kind === "github" || target.kind === "git-host") && !target.isFile;

// The hosts the commit stage contacts for a repository; a local folder is read in place.
function commitServices(target) {
  if (target.kind === "github") {
    return [
      { service: "api.github.com", receives: "a request for this repository's commit id" },
      { service: "codeload.github.com", receives: "a request for that commit's archive" },
    ];
  }
  if (target.kind === "git-host") return [{ service: new URL(target.origin).host, receives: "requests for this repository's commit id and archive" }];
  return [];
}

const osvServices = (target, options) =>
  options.osv ? [{ service: new URL(osvUrl()).host, receives: "the names, ecosystems and versions of the packages it uses" }] : [];

// Each stage that contacts a service names it here, with what it receives, so the list is complete before any request.
const SERVICE_STAGES = [commitServices, osvServices];
const servicesFor = (target, options) => SERVICE_STAGES.flatMap((stage) => stage(target, options));

// The folder to read: a local folder in place, or a repository's exact commit unpacked into a temporary folder.
async function openTarget(target, options, deps) {
  if (target.kind === "local-dir") return { root: target.path, ...localCommit(target.path), cleanup: () => {} };
  const { commit, root, cleanup } = await fetchCommit(target, options.ref, deps.fetchImpl ?? fetch, deps.limits ?? ARCHIVE_LIMITS);
  return { root, commit, changed: false, changesChecked: true, note: null, cleanup };
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
    opened = await openTarget(target, options, deps);
  } catch (err) {
    result.errors.push(err.message);
    return result;
  }
  try {
    const { files, leftOut } = listEveryFile(opened.root);
    const { findings: fileFindings, testFindings, launched } = scanEveryFile(files);
    const { findings: packageFindings, packages } = await packageCheck(files, leftOut, options, deps.fetchImpl ?? fetch);
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
      installTime: installTimeEntries(files),
      testFindings,
      launchedTests: launched,
      packages,
    });
    return result;
  } finally {
    opened.cleanup();
  }
}

module.exports = { runDeep };

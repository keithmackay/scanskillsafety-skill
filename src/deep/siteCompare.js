// ABOUTME: Compares the commit a deep scan reads with what findsafeskills scanned: asks the site's lookup about the repository's
// ABOUTME: address, then GitHub's compare call how each scanned commit relates to this one; out of reach is never "not listed".
"use strict";

const { fetchText, describeFailure } = require("../fetchRemote");
const { repoPath } = require("./archive");

// Shapes observed 2026-11-16:
// - GET <site>/api/listings/lookup?repo=<repository URL> -> {"listings":[{"slug","url","rating","scannedAt","scanCommit",
//   "scriptsCommit","pushedAt","scriptsScan"}]}; scanCommit and scriptsCommit may each be null; an unknown repository answers
//   {"listings":[]}, an unusable one 400, and more than 60 requests a minute 429.
// - GET api.github.com/repos/<o>/<r>/compare/<base>...<head>?per_page=1 -> {"status": "ahead"|"behind"|"diverged"|"identical",
//   "ahead_by", "behind_by", ...}, where ahead means head is newer than base; an unknown commit answers 404.
const DEFAULT_SITE_URL = "https://findsafeskills.com";
const COMMIT_ID = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

const siteUrl = () => process.env.FINDSAFESKILLS_URL ?? DEFAULT_SITE_URL;

// The repository's root address, which is how the site keys its listings.
const repositoryUrl = (target) =>
  target.kind === "github" ? `https://github.com/${target.owner}/${target.repo}` : `${target.origin}/${target.owner}/${target.repo}`;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const stringOrNull = (v) => (typeof v === "string" ? v : null);
const commitOrNull = (v) => (typeof v === "string" && COMMIT_ID.test(v) ? v : null);

async function lookUp(target, fetchImpl, base) {
  const url = `${base}/api/listings/lookup?repo=${encodeURIComponent(repositoryUrl(target))}`;
  const result = await fetchText(fetchImpl, url, { headers: { Accept: "application/json" } });
  if (!result.ok) return { ok: false, reason: result.status === 429 ? "rate limited" : describeFailure(result) };
  let body;
  try {
    body = JSON.parse(result.text);
  } catch {
    body = null;
  }
  if (!isObject(body) || !Array.isArray(body.listings) || !body.listings.every(isObject)) {
    return { ok: false, reason: `did not answer a list of listings: ${url}` };
  }
  return { ok: true, listings: body.listings };
}

// How this commit relates to the scanned one, from GitHub's compare call; for other hosts, or when the call fails, not compared.
async function relationTo(target, scanned, commit, fetchImpl) {
  if (target.kind !== "github") return { relation: "not-compared", reason: "only commits on GitHub are compared" };
  const url = `https://api.github.com/repos/${repoPath(target)}/compare/${scanned}...${commit}?per_page=1`;
  const result = await fetchText(fetchImpl, url, { headers: { Accept: "application/vnd.github+json" } });
  if (!result.ok) {
    if (result.status === 404) return { relation: "not-compared", reason: "GitHub does not know the scanned commit" };
    if (result.reason === "rate-limited") return { relation: "not-compared", reason: "GitHub's compare call was rate limited" };
    return { relation: "not-compared", reason: describeFailure(result) };
  }
  let body;
  try {
    body = JSON.parse(result.text);
  } catch {
    body = null;
  }
  const count = (v) => Number.isSafeInteger(v) && v >= 0;
  if (isObject(body) && count(body.ahead_by) && count(body.behind_by)) {
    if (body.status === "identical") return { relation: "same" };
    if (body.status === "ahead") return { relation: "newer", by: body.ahead_by };
    if (body.status === "behind") return { relation: "older", by: body.behind_by };
    if (body.status === "diverged") return { relation: "diverged", newerBy: body.ahead_by, olderBy: body.behind_by };
  }
  return { relation: "not-compared", reason: `GitHub's compare call answered an unexpected shape: ${url}` };
}

async function compareWithSite(target, commit, fetchImpl, base = siteUrl()) {
  if (target.kind === "local-dir") return { status: "local" };
  const found = await lookUp(target, fetchImpl, base);
  if (!found.ok) return { status: "unreachable", reason: found.reason };
  if (found.listings.length === 0) return { status: "not-listed", listings: [] };
  // Each scanned commit is compared once, however many listings or scans name it.
  const relations = new Map();
  const compare = async (scanned) => {
    if (scanned === null) return null;
    if (scanned === commit) return { commit: scanned, relation: "same" };
    if (!relations.has(scanned)) relations.set(scanned, await relationTo(target, scanned, commit, fetchImpl));
    return { commit: scanned, ...relations.get(scanned) };
  };
  const listings = [];
  for (const listing of found.listings) {
    listings.push({
      url: stringOrNull(listing.url),
      rating: stringOrNull(listing.rating),
      scannedAt: stringOrNull(listing.scannedAt),
      text: await compare(commitOrNull(listing.scanCommit)),
      scripts: await compare(commitOrNull(listing.scriptsCommit)),
    });
  }
  return { status: "listed", listings };
}

module.exports = { compareWithSite, siteUrl };

// ABOUTME: Compares the commit a deep scan reads with what findsafeskills scanned: asks the site's lookup about the repository's
// ABOUTME: address, then GitHub's compare call how each scanned commit relates to this one; out of reach is never "not listed".
"use strict";

const { fetchResponse, describeFailure } = require("../fetchRemote");
const { repoPath, describeLimit } = require("./archive");

// Shapes observed 2026-11-16:
// - GET <site>/api/listings/lookup?repo=<repository URL> -> {"listings":[{"slug","url","rating","scannedAt","scanCommit",
//   "scriptsCommit","pushedAt","scriptsScan"}]}; scanCommit and scriptsCommit may each be null; an unknown repository answers
//   {"listings":[]}, an unusable one 400, and more than 60 requests a minute 429.
// - GET api.github.com/repos/<o>/<r>/compare/<base>...<head>?per_page=1 -> {"status": "ahead"|"behind"|"diverged"|"identical",
//   "ahead_by", "behind_by", ...}, where ahead means head is newer than base; an unknown commit answers 404.
const DEFAULT_SITE_URL = "https://findsafeskills.com";
const COMMIT_ID = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const RATINGS = ["green", "yellow", "red"];
const MAX_LISTINGS = 10;
const LOOKUP_MAX_BYTES = 1024 ** 2;
const COMPARE_MAX_BYTES = 5 * 1024 ** 2;

const siteUrl = () => (process.env.FINDSAFESKILLS_URL ?? DEFAULT_SITE_URL).replace(/\/+$/, "");

// The repository's root address, which is how the site keys its listings.
const repositoryUrl = (target) =>
  target.kind === "github" ? `https://github.com/${target.owner}/${target.repo}` : `${target.origin}/${target.owner}/${target.repo}`;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const stringOrNull = (v) => (typeof v === "string" ? v : null);
const commitOrNull = (v) => (typeof v === "string" && COMMIT_ID.test(v) ? v : null);
const ratingOf = (v) => (v === null || RATINGS.includes(v) ? v : "unknown");

// The listing's page on the site itself: its own address when that is on the site's origin, else the page its slug names.
function pageOf(listing, base) {
  try {
    if (typeof listing.url === "string" && new URL(listing.url).origin === new URL(base).origin) return listing.url;
  } catch {
    // not an address; the slug decides
  }
  return typeof listing.slug === "string" && listing.slug ? `${base}/listings/${encodeURIComponent(listing.slug)}` : null;
}

const rateLimited = (result) => `rate limited (HTTP ${result.status}): ${result.url}`;
const failureText = (result) => (result.reason === "too-large" ? `answered more than ${describeLimit(result.maxBytes)}: ${result.url}` : describeFailure(result));

// An answer parsed as JSON (null when it is not JSON), read no further than maxBytes; a longer one is a failure.
async function fetchJsonWithin(fetchImpl, url, accept, maxBytes) {
  const result = await fetchResponse(fetchImpl, url, { headers: { Accept: accept } });
  if (!result.ok) return result;
  const chunks = [];
  let size = 0;
  try {
    const reader = result.response.body ? result.response.body.getReader() : null;
    for (let part = reader && (await reader.read()); part && !part.done; part = await reader.read()) {
      size += part.value.length;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too-large", maxBytes, url };
      }
      chunks.push(part.value);
    }
  } catch (err) {
    const reason = err && (err.name === "TimeoutError" || err.name === "AbortError") ? "timeout" : "network";
    return { ok: false, reason, url, message: err && err.message };
  }
  try {
    return { ok: true, json: JSON.parse(Buffer.concat(chunks).toString("utf-8")) };
  } catch {
    return { ok: true, json: null };
  }
}

async function lookUp(target, fetchImpl, base) {
  const url = `${base}/api/listings/lookup?repo=${encodeURIComponent(repositoryUrl(target))}`;
  const result = await fetchJsonWithin(fetchImpl, url, "application/json", LOOKUP_MAX_BYTES);
  if (!result.ok) {
    if (result.status === 400) return { ok: false, status: "refused", reason: "findsafeskills could not use this repository address (HTTP 400)" };
    return { ok: false, status: "unreachable", reason: result.reason === "rate-limited" ? rateLimited(result) : failureText(result) };
  }
  const body = result.json;
  if (!isObject(body) || !Array.isArray(body.listings) || !body.listings.every(isObject)) {
    return { ok: false, status: "unreachable", reason: `did not answer a list of listings: ${url}` };
  }
  return { ok: true, listings: body.listings };
}

// How this commit relates to the scanned one, from GitHub's compare call; for other hosts, or when the call fails, not compared.
// A rate-limited call also says so, so no other commit is asked about.
async function relationTo(target, scanned, commit, fetchImpl) {
  if (target.kind !== "github") return { relation: "not-compared", reason: "only commits on GitHub are compared" };
  const url = `https://api.github.com/repos/${repoPath(target)}/compare/${scanned}...${commit}?per_page=1`;
  const result = await fetchJsonWithin(fetchImpl, url, "application/vnd.github+json", COMPARE_MAX_BYTES);
  if (!result.ok) {
    if (result.status === 404) return { relation: "not-compared", reason: "GitHub does not know the scanned commit" };
    if (result.reason === "rate-limited") return { relation: "not-compared", reason: `GitHub's compare call was ${rateLimited(result)}`, rateLimited: true };
    return { relation: "not-compared", reason: failureText(result) };
  }
  const body = result.json;
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
  if (!found.ok) return { status: found.status, reason: found.reason };
  if (found.listings.length === 0) return { status: "not-listed", listings: [] };
  // Each scanned commit is compared once, however many listings or scans name it; once GitHub rate-limits a call, the rest
  // are not compared, for the same reason.
  const relations = new Map();
  let stopped = null;
  const compare = async (scanned) => {
    if (scanned === null) return null;
    if (scanned === commit) return { commit: scanned, relation: "same" };
    if (!relations.has(scanned)) {
      const { rateLimited: limited, ...relation } = stopped ?? (await relationTo(target, scanned, commit, fetchImpl));
      if (limited) stopped = relation;
      relations.set(scanned, relation);
    }
    return { commit: scanned, ...relations.get(scanned) };
  };
  const listings = [];
  for (const listing of found.listings.slice(0, MAX_LISTINGS)) {
    listings.push({
      url: pageOf(listing, base),
      rating: ratingOf(listing.rating),
      scannedAt: stringOrNull(listing.scannedAt),
      text: await compare(commitOrNull(listing.scanCommit)),
      scripts: await compare(commitOrNull(listing.scriptsCommit)),
    });
  }
  return { status: "listed", listings, more: Math.max(0, found.listings.length - MAX_LISTINGS) };
}

module.exports = { compareWithSite, siteUrl };

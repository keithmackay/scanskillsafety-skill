// ABOUTME: Asks OSV (api.osv.dev) about a target's packages, sending only their names, ecosystems and versions: malicious packages
// ABOUTME: become findings, known vulnerabilities are listed apart, and any failed request means the check did not run.
"use strict";

// Shapes observed 2026-11-15:
// POST /v1/querybatch {"queries":[{"package":{"name":"flatmap-stream","ecosystem":"npm"},"version":"0.1.1"},
//   {"package":{"name":"left-pad","ecosystem":"npm"},"version":"1.3.0"}]}
//   -> {"results":[{"vulns":[{"id":"GHSA-9x64-5r7x-2q53","modified":"..."},{"id":"MAL-2025-20690","modified":"..."}]},{}]}
//   One result per query, in order; a package with no record gives an empty object. A query with no version is asked about
//   every version. A result may carry "next_page_token", to be sent back as the query's "page_token". At most 1000 queries.
// GET /v1/vulns/<id> -> {"id", "withdrawn"?: timestamp, "database_specific": {"severity": "CRITICAL"|"HIGH"|"MODERATE"|"LOW"},
//   "affected": [{"package": {...}, "ranges"?: [{"type": "SEMVER", "events": [{"introduced": "0"}, {"fixed": "x"}]}],
//   "versions"?: ["5.6.1"]}]}. Malicious-package records (MAL-...) have no severity; MAL-2025-20690 (flatmap-stream) has one
//   range introduced at "0" with no end, MAL-2025-46969 (chalk) lists only "versions": ["5.6.1"]. An unknown id answers 404.

const DEFAULT_OSV_URL = "https://api.osv.dev";
const QUERIES_PER_REQUEST = 1000;
const MAX_DETAILS = 200;
const MAX_PAGES_PER_QUERY = 50;
const DETAIL_CONCURRENCY = 8;
const TIMEOUT_MS = 30_000;
const SEVERITY_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

const osvUrl = () => (process.env.OSV_URL ?? DEFAULT_OSV_URL).replace(/\/+$/, "");
const isMalicious = (id) => id.startsWith("MAL-");

class OsvFailure extends Error {}

async function request(fetchImpl, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "scanskillsafety", ...init.headers } });
  } catch (err) {
    throw new OsvFailure(`${url}: ${err.message}`);
  }
  if (!response.ok) throw new OsvFailure(`${url} answered ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new OsvFailure(`${url} did not answer JSON`);
  }
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// The ids OSV lists for each query, following each result's pages until it has none; a query that pages on and on, or hands
// back a token it gave before, is a failure rather than a loop.
async function queryIds(queries, fetchImpl, base) {
  const ids = queries.map(() => []);
  const pages = queries.map(() => 1);
  const tokens = queries.map(() => new Set());
  let pending = queries.map((query, index) => ({ index, query }));
  while (pending.length > 0) {
    const next = [];
    for (let i = 0; i < pending.length; i += QUERIES_PER_REQUEST) {
      const chunk = pending.slice(i, i + QUERIES_PER_REQUEST);
      const url = `${base}/v1/querybatch`;
      const body = await request(fetchImpl, url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: chunk.map((p) => p.query) }),
      });
      const results = body && Array.isArray(body.results) ? body.results : [];
      if (results.length !== chunk.length) throw new OsvFailure(`${url} answered ${results.length} results for ${chunk.length} queries`);
      chunk.forEach(({ index, query }, j) => {
        const result = isObject(results[j]) ? results[j] : {};
        for (const vuln of Array.isArray(result.vulns) ? result.vulns : []) {
          if (vuln && typeof vuln.id === "string") ids[index].push(vuln.id);
        }
        const token = result.next_page_token;
        if (typeof token !== "string" || !token) return;
        const name = query.package.name;
        if (tokens[index].has(token)) throw new OsvFailure(`${url} answered the same page token twice for ${name}`);
        if (pages[index] >= MAX_PAGES_PER_QUERY) throw new OsvFailure(`${url} answered more than ${MAX_PAGES_PER_QUERY} pages for ${name}`);
        tokens[index].add(token);
        pages[index]++;
        next.push({ index, query: { ...query, page_token: token } });
      });
    }
    pending = next;
  }
  return ids;
}

async function fetchDetails(ids, fetchImpl, base) {
  const details = new Map();
  let cursor = 0;
  let failed = false;
  const worker = async () => {
    while (cursor < ids.length && !failed) {
      const id = ids[cursor++];
      try {
        const body = await request(fetchImpl, `${base}/v1/vulns/${encodeURIComponent(id)}`);
        details.set(id, isObject(body) ? body : {});
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, ids.length) }, worker));
  return details;
}

// Only the parts of a record in the expected shape are read: an object, string versions, and ranges whose every event is an
// object of strings. Anything else is left out, so a malformed record can only name fewer versions, never every version.
const listOf = (v) => (Array.isArray(v) ? v : []);
const affectedOf = (record) => listOf(record.affected).filter(isObject);
const isEvent = (e) => isObject(e) && Object.values(e).every((v) => typeof v === "string");
const readableRanges = (affected) => listOf(affected.ranges).filter((r) => isObject(r) && listOf(r.events).length > 0 && r.events.every(isEvent));

// A record says every version is malicious when a range starts at 0 and never ends.
const everyVersion = (record) => affectedOf(record).some((a) => readableRanges(a).some(({ events }) =>
  events.some((e) => e.introduced === "0") && !events.some((e) => e.fixed !== undefined || e.last_affected !== undefined)));

function rangeText({ events }) {
  const parts = [];
  for (const e of events) {
    if (e.introduced !== undefined) parts.push(`>=${e.introduced}`);
    if (e.fixed !== undefined) parts.push(`<${e.fixed}`);
    if (e.last_affected !== undefined) parts.push(`<=${e.last_affected}`);
  }
  return parts.join(" ");
}

// The versions a record names, or its ranges when it names none; empty when it has neither in a shape that can be read.
function affectedVersionsText(record) {
  const versions = affectedOf(record).flatMap((a) => listOf(a.versions).filter((v) => typeof v === "string"));
  const named = versions.length > 0 ? [...new Set(versions)] : affectedOf(record).flatMap((a) => readableRanges(a).map(rangeText));
  return named.filter(Boolean).join(", ");
}

function maliciousFinding(pkg, id, record) {
  const finding = (severity, detail) => ({ severity, category: "malicious-package", source: "osv", file: pkg.file, line: pkg.line, detail });
  const unpinned = "this project does not pin a version";
  if (pkg.version !== null) return finding("critical", `${pkg.name}@${pkg.version} is listed as malicious in OSV (${id})`);
  if (!record) return finding("warning", `${pkg.name} has malicious-package records in OSV (${id}); their versions were not fetched, and ${unpinned}`);
  if (everyVersion(record)) return finding("critical", `${pkg.name} is listed as malicious in OSV, every version (${id})`);
  const versions = affectedVersionsText(record);
  if (!versions) return finding("warning", `${pkg.name} has malicious-package records in OSV (${id}) that name no versions it can read; ${unpinned}`);
  return finding("warning", `${pkg.name} had malicious versions ${versions} (${id}); ${unpinned}`);
}

function highestSeverity(ids, details) {
  const ranks = ids.map((id) => SEVERITY_ORDER.indexOf(details.get(id)?.database_specific?.severity)).filter((rank) => rank >= 0);
  return ranks.length > 0 ? SEVERITY_ORDER[Math.max(...ranks)] : null;
}

async function checkPackages(packages, fetchImpl, base = osvUrl()) {
  try {
    const queries = packages.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, ...(p.version !== null ? { version: p.version } : {}) }));
    const found = await queryIds(queries, fetchImpl, base);
    // A package checked by name only is asked about every version, so only its malicious records count.
    const idsOf = found.map((ids, i) => [...new Set(packages[i].version === null ? ids.filter(isMalicious) : ids)]);
    const distinct = [...new Set(idsOf.flat())];
    const ordered = [...distinct.filter(isMalicious), ...distinct.filter((id) => !isMalicious(id))];
    const details = await fetchDetails(ordered.slice(0, MAX_DETAILS), fetchImpl, base);
    const withdrawn = (id) => Boolean(details.get(id)?.withdrawn);
    const findings = [];
    const vulnerabilities = [];
    packages.forEach((pkg, i) => {
      const ids = idsOf[i].filter((id) => !withdrawn(id));
      for (const id of ids.filter(isMalicious)) findings.push(maliciousFinding(pkg, id, details.get(id)));
      const others = ids.filter((id) => !isMalicious(id));
      if (others.length > 0) {
        vulnerabilities.push({ ecosystem: pkg.ecosystem, name: pkg.name, version: pkg.version, ids: others, highest: highestSeverity(others, details) });
      }
    });
    return { status: "done", findings, vulnerabilities, detailsLeft: Math.max(0, ordered.length - MAX_DETAILS) };
  } catch (err) {
    if (!(err instanceof OsvFailure)) throw err;
    return { status: "not-run", reason: err.message };
  }
}

module.exports = { checkPackages, osvUrl };

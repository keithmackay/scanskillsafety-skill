// ABOUTME: Fetches the discoverable files of a remote skill/plugin/MCP repo from its own host —
// ABOUTME: GitHub (REST API for default branch + file tree, raw.githubusercontent.com for
// ABOUTME: content) or a self-hosted Gitea/Forgejo instance's REST API — with timeouts and
// ABOUTME: errors classified so "couldn't fetch" is never confused with "found nothing".
"use strict";

const { isDiscoverable, MAX_FILE_BYTES, MAX_FILES } = require("./discover");
const { selectScriptFiles, MAX_BYTES_PER_FILE } = require("../lib/scriptFiles");
const { findLaunchedTestFiles } = require("./launchedTestFiles");
const { partialScriptsNotice, launchedTestFilesNotice } = require("./scriptsNotice");

// The first MAX_BYTES_PER_FILE bytes of a script's text, as findsafeskills reads it.
const capScript = (text) => {
  const bytes = Buffer.from(text, "utf-8");
  return bytes.length > MAX_BYTES_PER_FILE ? bytes.subarray(0, MAX_BYTES_PER_FILE).toString("utf-8") : text;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const CONCURRENCY = 6;
// Used only when GitHub's API is unavailable (rate limit) and the file tree can't be listed.
const FALLBACK_PATHS = [
  "SKILL.md", "README.md", "plugin.json", ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json", "hooks/hooks.json", ".mcp.json", "package.json",
];

async function fetchText(fetchImpl, url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "scanskillsafety" },
    });
    if (response.ok) return { ok: true, text: await response.text() };
    const reason = response.status === 404 ? "not-found"
      : response.status === 403 || response.status === 429 ? "rate-limited"
      : "http";
    return { ok: false, reason, status: response.status, url };
  } catch (err) {
    const reason = err && (err.name === "TimeoutError" || err.name === "AbortError") ? "timeout" : "network";
    return { ok: false, reason, url, message: err && err.message };
  }
}

async function fetchJson(fetchImpl, url) {
  const result = await fetchText(fetchImpl, url);
  if (!result.ok) return result;
  try {
    return { ok: true, json: JSON.parse(result.text) };
  } catch {
    return { ok: false, reason: "http", url, message: "response was not JSON" };
  }
}

function describeFailure(result) {
  switch (result.reason) {
    case "not-found": return `not found: ${result.url}`;
    case "rate-limited": return `rate-limited or forbidden (HTTP ${result.status}): ${result.url}`;
    case "timeout": return `timed out: ${result.url}`;
    case "network": return `network error (${result.message}): ${result.url}`;
    default: return `HTTP ${result.status ?? "error"}${result.message ? ` (${result.message})` : ""}: ${result.url}`;
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function stripSubpath(fullPath, subpath) {
  if (!subpath) return fullPath;
  return fullPath.startsWith(`${subpath}/`) ? fullPath.slice(subpath.length + 1) : null;
}

// Filters a tree listing to discoverable blobs under subpath, and the scripts findsafeskills would read there, then fetches
// each one, then the scripts in test and eval folders that those run. A file that is both (hooks.json, .mcp.json) is fetched
// once and scanned as a script.
async function fetchTreeFiles(fetchImpl, tree, subpath, rawUrlFor) {
  const blobs = [];
  for (const entry of tree) {
    if (entry.type !== "blob" && entry.type !== "file") continue;
    const rel = stripSubpath(entry.path, subpath);
    if (rel) blobs.push({ full: entry.path, rel, size: entry.size ?? 0, sha: entry.sha });
  }
  const scripts = selectScriptFiles(blobs.map((b) => ({ path: b.rel, size: b.size, sha: b.sha })));
  const scriptPaths = new Set(scripts.paths);
  const wanted = blobs.filter((b) => !scriptPaths.has(b.rel) && isDiscoverable(b.rel) && b.size <= MAX_FILE_BYTES);
  const limited = wanted.slice(0, MAX_FILES);
  const toFetch = [...limited, ...blobs.filter((b) => scriptPaths.has(b.rel)).map((b) => ({ ...b, script: true }))];
  const fetched = await mapLimit(toFetch, CONCURRENCY, async (w) => ({ w, result: await fetchText(fetchImpl, rawUrlFor(w.full)) }));
  const files = [];
  const errors = [];
  for (const { w, result } of fetched) {
    if (!result.ok) errors.push(describeFailure(result));
    else if (w.script) files.push({ path: w.rel, text: capScript(result.text), script: true });
    else files.push({ path: w.rel, text: result.text });
  }
  const relTree = blobs.map((b) => ({ path: b.rel, size: b.size }));
  const fullPath = new Map(blobs.map((b) => [b.rel, b.full]));
  const launched = [];
  const tried = new Set();
  let launchTruncated = false;
  for (;;) {
    const round = findLaunchedTestFiles(relTree, files, tried);
    launchTruncated ||= round.truncated;
    if (round.launched.length === 0) break;
    round.launched.forEach((l) => tried.add(l.path));
    const results = await mapLimit(round.launched, CONCURRENCY, async (l) => ({ l, result: await fetchText(fetchImpl, rawUrlFor(fullPath.get(l.path))) }));
    for (const { l, result } of results) {
      if (!result.ok) errors.push(describeFailure(result));
      else {
        files.push({ path: l.path, text: capScript(result.text), script: true, launchedBy: l.by });
        launched.push(l);
      }
    }
  }
  const notices = wanted.length > limited.length ? [`Only the first ${MAX_FILES} of ${wanted.length} matching files were scanned.`] : [];
  if (scripts.truncated || launchTruncated) notices.push(partialScriptsNotice());
  if (launched.length > 0) notices.push(launchedTestFilesNotice(launched));
  return { files, errors, notices };
}

async function gatherGithub(target, fetchImpl) {
  const { owner, repo, subpath } = target;
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const rawUrl = (ref, p) => `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${p.split("/").map(encodeURIComponent).join("/")}`;

  if (target.isFile) {
    const result = await fetchText(fetchImpl, rawUrl(target.ref, subpath));
    return result.ok
      ? { files: [{ path: subpath, text: result.text }], errors: [], notices: [] }
      : { files: [], errors: [describeFailure(result)], notices: [] };
  }

  let ref = target.ref;
  let apiFailure = null;
  if (!ref) {
    const info = await fetchJson(fetchImpl, api);
    if (info.ok && typeof info.json.default_branch === "string") ref = info.json.default_branch;
    else if (!info.ok && info.reason === "not-found") return { files: [], errors: [describeFailure(info)], notices: [] };
    else apiFailure = info.ok ? { reason: "http", url: api, message: "no default_branch" } : info;
  }

  if (ref && !apiFailure) {
    const tree = await fetchJson(fetchImpl, `${api}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (tree.ok && Array.isArray(tree.json.tree)) {
      const out = await fetchTreeFiles(fetchImpl, tree.json.tree, subpath, (p) => rawUrl(ref, p));
      if (tree.json.truncated) out.notices.push("GitHub truncated the file listing for this very large repo; some files may not have been scanned.");
      return out;
    }
    if (!tree.ok && tree.reason === "not-found") return { files: [], errors: [describeFailure(tree)], notices: [] };
    apiFailure = tree.ok ? { reason: "http", url: tree.url, message: "unexpected tree response" } : tree;
  }

  // API unavailable: probe a fixed list of well-known paths on the given ref (or main/master).
  const notices = [`GitHub API unavailable (${describeFailure(apiFailure)}); checked only well-known file paths${ref ? "" : " on main/master"}.`];
  const errors = [];
  for (const branch of ref ? [ref] : ["main", "master"]) {
    const prefix = subpath ? `${subpath}/` : "";
    const results = await mapLimit(FALLBACK_PATHS, CONCURRENCY, async (p) => ({ p, result: await fetchText(fetchImpl, rawUrl(branch, prefix + p)) }));
    const files = results.filter((r) => r.result.ok).map((r) => ({ path: r.p, text: r.result.text }));
    errors.push(...results.filter((r) => !r.result.ok && r.result.reason !== "not-found").map((r) => describeFailure(r.result)));
    if (files.length > 0) return { files, errors, notices };
  }
  return { files: [], errors: errors.length ? errors : [`none of the well-known files were found for ${owner}/${repo}`], notices };
}

async function gatherGitHost(target, fetchImpl) {
  const { origin, owner, repo, subpath } = target;
  const api = `${origin}/api/v1/repos/${owner}/${repo}`;
  const rawUrl = (ref, p) => `${api}/raw/${p.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;

  let ref = target.ref;
  if (!ref) {
    const info = await fetchJson(fetchImpl, api);
    if (!info.ok) return { files: [], errors: [describeFailure(info)], notices: [] };
    if (typeof info.json.default_branch !== "string") {
      return { files: [], errors: [`${api} did not return a default branch — not a Gitea/Forgejo repo?`], notices: [] };
    }
    ref = info.json.default_branch;
  }

  if (target.isFile) {
    const result = await fetchText(fetchImpl, rawUrl(ref, subpath));
    return result.ok
      ? { files: [{ path: subpath, text: result.text }], errors: [], notices: [] }
      : { files: [], errors: [describeFailure(result)], notices: [] };
  }

  const tree = await fetchJson(fetchImpl, `${api}/git/trees/${encodeURIComponent(ref)}?recursive=true&per_page=1000`);
  if (!tree.ok || !Array.isArray(tree.json.tree)) {
    return { files: [], errors: [tree.ok ? `${api}: unexpected tree response` : describeFailure(tree)], notices: [] };
  }
  const out = await fetchTreeFiles(fetchImpl, tree.json.tree, subpath, (p) => rawUrl(ref, p));
  if (tree.json.truncated) out.notices.push("The host truncated the file listing; some files may not have been scanned.");
  return out;
}

async function gatherRawUrl(url, fetchImpl) {
  const result = await fetchText(fetchImpl, url);
  if (!result.ok) return { files: [], errors: [describeFailure(result)], notices: [] };
  const name = new URL(url).pathname.split("/").filter(Boolean).pop() || url;
  return { files: [{ path: name, text: result.text }], errors: [], notices: [] };
}

module.exports = { fetchText, gatherGithub, gatherGitHost, gatherRawUrl };

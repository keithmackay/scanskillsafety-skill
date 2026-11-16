// ABOUTME: Completes an unpacked archive from the commit's own file list: a file .gitattributes keeps out of the archive
// ABOUTME: (export-ignore) is fetched at that commit and written in place; submodules and left-out links are listed, never read.
"use strict";

const fs = require("fs");
const path = require("path");
const { fetchText, describeFailure, repoPath } = require("../fetchRemote");
const { printable } = require("../printable");
const { MAX_TEXT_BYTES } = require("./everyFile");
const { OBJECT_ID, LINK_MODE } = require("./util");

// Endpoint shapes, checked with curl on 2026-11-16:
// - GitHub: GET api.github.com/repos/<o>/<r>/git/trees/<commit>?recursive=1 answers { sha, url, tree: [{ path, mode, type
//   ("blob", "tree" or "commit"), sha, size }], truncated }. GET .../git/blobs/<sha> answers { sha, size, content, encoding:
//   "base64" }.
// - Gitea and Forgejo (codeberg.org): GET <origin>/api/v1/repos/<o>/<r>/git/trees/<commit>?recursive=true&per_page=<n>&page=<p>
//   answers { sha, url, tree, truncated, page, total_count }, where truncated is true while later pages hold more entries
//   (forgejo/docs, 380 entries: per_page=5 gave page 1 of 5 entries with truncated true; per_page=10000 gave all 380 with
//   truncated false). GET .../git/blobs/<sha> answers { content, encoding: "base64", url, sha, size }.
const MAX_SEPARATE_FETCHES = 50;
const GITEA_PER_PAGE = 10_000;
const MAX_TREE_PAGES = 100;
const TREE_TIMEOUT_MS = 60_000;

const cannotList = (reason) => new Error(`could not list every file of the commit: ${reason}`);
const outside = (p) => cannotList(`the host's file list holds a path outside the repository: ${printable(String(p))}`);

function apiOf(target) {
  return target.kind === "github" ? `https://api.github.com/repos/${repoPath(target)}` : `${target.origin}/api/v1/repos/${repoPath(target)}`;
}

async function fetchJsonOrFail(fetchImpl, url, fail) {
  const result = await fetchText(fetchImpl, url, { timeoutMs: TREE_TIMEOUT_MS });
  if (!result.ok) throw fail(describeFailure(result));
  try {
    return JSON.parse(result.text);
  } catch {
    throw fail(`the host's answer was not JSON: ${url}`);
  }
}

// Every entry of the commit's tree. GitHub answers in one reply and says when it cut the list; Gitea and Forgejo answer in pages.
async function listCommitTree(target, commit, fetchImpl) {
  const api = apiOf(target);
  const notUnderstood = (url) => cannotList(`the host's file list was not understood: ${url}`);
  if (target.kind === "github") {
    const url = `${api}/git/trees/${commit}?recursive=1`;
    const reply = await fetchJsonOrFail(fetchImpl, url, cannotList);
    if (!reply || !Array.isArray(reply.tree)) throw notUnderstood(url);
    if (reply.truncated) throw cannotList("the host cut its file list short");
    return reply.tree;
  }
  const entries = [];
  for (let page = 1; ; page++) {
    if (page > MAX_TREE_PAGES) throw cannotList(`the host's file list runs past ${MAX_TREE_PAGES} pages`);
    const url = `${api}/git/trees/${commit}?recursive=true&per_page=${GITEA_PER_PAGE}&page=${page}`;
    const reply = await fetchJsonOrFail(fetchImpl, url, cannotList);
    if (!reply || !Array.isArray(reply.tree)) throw notUnderstood(url);
    if (!reply.truncated) return [...entries, ...reply.tree];
    if (reply.tree.length === 0) throw cannotList("the host's file list stopped early");
    entries.push(...reply.tree);
  }
}

// A path inside the repository: relative, and with no empty, "." or ".." part.
const isInsidePath = (p) => typeof p === "string" && p !== "" && !p.includes("\0") && p.split("/").every((part) => part !== "" && part !== "." && part !== "..");

// Whether the archive put something at this path, reached through real folders only: a file seen through a linked folder is not
// the commit's file and is never read.
function presentWithin(folder, relPath) {
  const parts = relPath.split("/");
  let at = folder;
  return parts.every((part, i) => {
    at = path.join(at, part);
    const stat = fs.lstatSync(at, { throwIfNoEntry: false });
    return Boolean(stat) && (i === parts.length - 1 || stat.isDirectory());
  });
}

// Writes a fetched file at its path in the folder, making each missing folder and refusing to pass through a link or a file.
function writeWithin(folder, relPath, bytes) {
  const parts = relPath.split("/");
  let dir = folder;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!stat) fs.mkdirSync(dir);
    else if (!stat.isDirectory()) throw outside(relPath);
  }
  const realFolder = fs.realpathSync(folder);
  const realDir = fs.realpathSync(dir);
  if (realDir !== realFolder && !realDir.startsWith(realFolder + path.sep)) throw outside(relPath);
  // "wx" fails if anything, a link included, is already at the path.
  fs.writeFileSync(path.join(dir, parts[parts.length - 1]), bytes, { flag: "wx" });
}

async function fetchBlob(target, entry, fetchImpl) {
  const fail = (reason) => new Error(`could not read every file of the commit: ${printable(entry.path)} (${reason})`);
  if (!OBJECT_ID.test(entry.sha ?? "")) throw fail("the host's file list gave no object id");
  const url = `${apiOf(target)}/git/blobs/${entry.sha}`;
  const reply = await fetchJsonOrFail(fetchImpl, url, fail);
  if (!reply || reply.encoding !== "base64" || typeof reply.content !== "string") throw fail(`the host's answer was not understood: ${url}`);
  return Buffer.from(reply.content, "base64");
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// Returns the files fetched separately and the entries listed instead of read, each path given from the target's subpath.
async function fillArchiveGaps(target, commit, folder, fetchImpl) {
  const tree = await listCommitTree(target, commit, fetchImpl);
  for (const entry of tree) if (!entry || !isInsidePath(entry.path)) throw outside(entry && entry.path);
  const prefix = target.subpath ? `${target.subpath.replace(/\/+$/, "")}/` : "";
  const fromSubpath = (p) => p.slice(prefix.length);
  const missing = (p) => !presentWithin(folder, p);
  const leftOut = [];
  const toFetch = [];
  for (const entry of tree.filter((e) => e.path.startsWith(prefix))) {
    if (entry.type === "commit") leftOut.push({ path: fromSubpath(entry.path), reason: "submodule, not read" });
    else if (entry.type !== "blob" || !missing(entry.path)) continue;
    else if (entry.mode === LINK_MODE) leftOut.push({ path: fromSubpath(entry.path), reason: "symbolic link, not followed" });
    else if (entry.size > MAX_TEXT_BYTES) {
      leftOut.push({ path: fromSubpath(entry.path), reason: "left out of the archive by .gitattributes; larger than 5 MB, not fetched" });
    } else toFetch.push(entry);
  }
  if (toFetch.length > MAX_SEPARATE_FETCHES) throw cannotList(`the archive leaves out more than ${MAX_SEPARATE_FETCHES} files`);
  for (const entry of toFetch.sort(byPath)) {
    const bytes = await fetchBlob(target, entry, fetchImpl);
    writeWithin(folder, entry.path, bytes);
  }
  return { fetched: toFetch.map((e) => fromSubpath(e.path)), leftOut: leftOut.sort(byPath) };
}

module.exports = { fillArchiveGaps, MAX_SEPARATE_FETCHES };

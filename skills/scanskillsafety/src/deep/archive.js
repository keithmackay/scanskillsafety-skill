// ABOUTME: Fetches the exact commit a deep scan reads: resolves a ref to a full commit id on GitHub, Gitea or Forgejo, downloads
// ABOUTME: that commit's archive within limits, checks it before unpacking, and unpacks it into a temporary folder it removes.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const { Readable, Transform, Writable } = require("stream");
const { pipeline } = require("stream/promises");
const { fetchResponse, fetchText, describeFailure } = require("../fetchRemote");

// Endpoint shapes, checked with curl on 2026-11-15:
// - GitHub: GET api.github.com/repos/<o>/<r>/commits/<ref or HEAD> with "Accept: application/vnd.github.sha" answers the full
//   commit id as plain text (content-type application/vnd.github.sha); an unknown ref answers 422 ("No commit found for SHA"), an
//   unknown repository 404. codeload.github.com/<o>/<r>/tar.gz/<sha> answers application/x-gzip whose one top folder is
//   "<repo>-<sha>/"; an unknown commit answers 404.
// - Gitea and Forgejo (codeberg.org): GET <origin>/api/v1/repos/<o>/<r>/commits?sha=<ref>&limit=1&stat=false&verification=false
//   &files=false answers [{ "sha": "<40 hex>", ... }], the default branch's head without sha=; an unknown ref or repository
//   answers 404. <origin>/api/v1/repos/<o>/<r>/archive/<sha>.tar.gz answers application/gzip whose one top folder is the
//   repository's name in lower case.
const ARCHIVE_LIMITS = { downloadBytes: 200 * 1024 ** 2, unpackedBytes: 1024 ** 3, files: 100_000 };
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const LIST_MAX_BUFFER = 256 * 1024 ** 2;
const COMMIT_ID = /^[0-9a-f]{40}$/;
const GITEA_COMMIT_QUERY = "limit=1&stat=false&verification=false&files=false";

const describeLimit = (bytes) =>
  bytes % 1024 ** 3 === 0 ? `${bytes / 1024 ** 3} GB` : bytes % 1024 ** 2 === 0 ? `${bytes / 1024 ** 2} MB` : `${bytes} bytes`;
const tooLarge = (what) => new Error(`too large to check deeply: ${what}`);

function endpoints(target, ref) {
  const { owner, repo } = target;
  if (target.kind === "github") {
    return {
      commitUrl: `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref ?? "HEAD")}`,
      archiveUrl: (sha) => `https://codeload.github.com/${owner}/${repo}/tar.gz/${sha}`,
    };
  }
  const api = `${target.origin}/api/v1/repos/${owner}/${repo}`;
  return {
    commitUrl: `${api}/commits?${ref ? `sha=${encodeURIComponent(ref)}&` : ""}${GITEA_COMMIT_QUERY}`,
    archiveUrl: (sha) => `${api}/archive/${sha}.tar.gz`,
  };
}

function commitIdOf(target, text) {
  if (target.kind === "github") return text.trim();
  try {
    const commits = JSON.parse(text);
    return Array.isArray(commits) && commits.length > 0 && commits[0] ? commits[0].sha : null;
  } catch {
    return undefined;
  }
}

async function resolveCommit(target, ref, commitUrl, fetchImpl) {
  const noCommit = new Error(`no commit ${ref ?? "HEAD"} in ${target.owner}/${target.repo}`);
  const result = await fetchText(fetchImpl, commitUrl, { headers: target.kind === "github" ? { Accept: "application/vnd.github.sha" } : {} });
  if (!result.ok) {
    if (result.status === 404 || result.status === 422) throw noCommit;
    throw new Error(describeFailure(result));
  }
  const commit = commitIdOf(target, result.text);
  if (commit === null) throw noCommit;
  if (typeof commit !== "string" || !COMMIT_ID.test(commit)) throw new Error(`did not answer a commit id: ${commitUrl}`);
  return commit;
}

// A temporary folder removed by cleanup(), and also when the process exits or is stopped by Ctrl-C or SIGTERM, after which the
// signal is sent again so the process ends as it would have. Cleaning up removes its own listeners.
function temporaryFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scanskillsafety-deep-"));
  const cleanup = () => {
    process.removeListener("exit", cleanup);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  const onSignal = (signal) => {
    cleanup();
    process.kill(process.pid, signal);
  };
  process.once("exit", cleanup);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return { dir, cleanup };
}

function byteLimit(limit, error) {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      seen += chunk.length;
      done(seen > limit ? error : null, chunk);
    },
  });
}

async function download(url, file, fetchImpl, limits) {
  const result = await fetchResponse(fetchImpl, url, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
  if (!result.ok) throw new Error(describeFailure(result));
  const overLimit = tooLarge(`the download is larger than ${describeLimit(limits.downloadBytes)}`);
  try {
    await pipeline(Readable.fromWeb(result.response.body), byteLimit(limits.downloadBytes, overLimit), fs.createWriteStream(file));
  } catch (err) {
    if (err === overLimit) throw err;
    throw new Error(`could not download the archive (${err.message}): ${url}`);
  }
}

// Counts the archive's unpacked bytes without writing them anywhere.
async function checkUnpackedSize(file, limits) {
  const overLimit = tooLarge(`the unpacked archive is larger than ${describeLimit(limits.unpackedBytes)}`);
  const discard = new Writable({ write: (_chunk, _encoding, done) => done() });
  try {
    await pipeline(fs.createReadStream(file), zlib.createGunzip(), byteLimit(limits.unpackedBytes, overLimit), discard);
  } catch (err) {
    if (err === overLimit) throw err;
    throw new Error(`could not unpack the archive (${err.message})`);
  }
}

function runTar(args) {
  const run = spawnSync("tar", args, { encoding: "utf-8", maxBuffer: LIST_MAX_BUFFER });
  if (run.error) throw new Error(`could not unpack the archive (${run.error.message})`);
  if (run.status !== 0) throw new Error(`could not unpack the archive (tar: ${run.stderr.trim()})`);
  return run.stdout;
}

// Any Gitea or Forgejo address can serve a crafted archive, so its names are checked before anything is unpacked.
function checkListing(file, limits) {
  const names = runTar(["-tzf", file]).split("\n").filter(Boolean);
  if (names.some((n) => n.startsWith("/") || n.split("/").includes(".."))) throw new Error("the archive holds a path outside its folder");
  const files = names.filter((n) => !n.endsWith("/")).length;
  if (files > limits.files) throw tooLarge(`the archive holds more than ${limits.files.toLocaleString("en-US")} files`);
}

async function fetchCommit(target, ref, fetchImpl, limits = ARCHIVE_LIMITS) {
  const wanted = ref ?? target.ref ?? null;
  const { commitUrl, archiveUrl } = endpoints(target, wanted);
  const commit = await resolveCommit(target, wanted, commitUrl, fetchImpl);
  const { dir, cleanup } = temporaryFolder();
  try {
    const archive = path.join(dir, "archive.tar.gz");
    const tree = path.join(dir, "tree");
    await download(archiveUrl(commit), archive, fetchImpl, limits);
    await checkUnpackedSize(archive, limits);
    checkListing(archive, limits);
    fs.mkdirSync(tree);
    runTar(["-xzf", archive, "-C", tree, "--strip-components=1", "--no-same-owner"]);
    fs.rmSync(archive);
    const root = path.join(tree, target.subpath);
    const inside = root === tree || root.startsWith(tree + path.sep);
    if (!inside || !fs.lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`no folder ${target.subpath} in ${target.owner}/${target.repo} at ${commit.slice(0, 7)}`);
    }
    return { commit, root, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

module.exports = { fetchCommit, ARCHIVE_LIMITS, describeLimit };

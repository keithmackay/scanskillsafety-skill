"use strict";
// ABOUTME: Tests fetching the exact commit for a deep scan: a ref resolved to a commit id on GitHub, Gitea and Forgejo, its archive
// ABOUTME: downloaded and unpacked within limits, crafted archives refused, and the temporary folder removed every way it can end.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { fetchCommit } = require("../../src/deep/archive");
const { makeTree, fakeFetch } = require("../helpers");

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const github = { kind: "github", owner: "o", repo: "r", ref: null, subpath: "", isFile: false };
const forgejo = { kind: "git-host", origin: "https://code.example", owner: "o", repo: "r", ref: null, subpath: "", isFile: false };
const ARCHIVE_PATH = path.join(__dirname, "..", "..", "src", "deep", "archive.js");

// A real .tar.gz made with the system tar; extra entries are given as paths relative to the folder, kept as written.
function makeTarball(files, extraEntries = []) {
  const root = makeTree(files);
  const top = [...new Set(Object.keys(files).map((p) => p.split("/")[0]))];
  const out = path.join(makeTree({}), "out.tgz");
  const made = spawnSync("tar", ["-czPf", out, "-C", root, ...top, ...extraEntries], { encoding: "utf-8" });
  assert.equal(made.status, 0, made.stderr);
  return fs.readFileSync(out);
}

const githubRoutes = (tgz, ref = "main", sha = SHA) => ({
  [`https://api.github.com/repos/o/r/commits/${ref}`]: sha,
  [`https://codeload.github.com/o/r/tar.gz/${sha}`]: { body: tgz },
});

test("resolves a GitHub ref to a commit and unpacks that commit's archive without its top folder", async () => {
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi", "r-abc/scripts/x.sh": "echo" });
  const fetchImpl = fakeFetch(githubRoutes(tgz));
  const got = await fetchCommit(github, "main", fetchImpl);
  try {
    assert.equal(got.commit, SHA);
    assert.deepEqual(fs.readdirSync(got.root).sort(), ["SKILL.md", "scripts"]);
    assert.equal(fs.readFileSync(path.join(got.root, "scripts", "x.sh"), "utf-8"), "echo");
    assert.equal(fetchImpl.options[0].headers.Accept, "application/vnd.github.sha");
  } finally {
    got.cleanup();
  }
  assert.equal(fs.existsSync(got.root), false);
});

test("with no ref it uses the link's ref, or else the default branch", async () => {
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi" });
  const fromLink = await fetchCommit({ ...github, ref: "v1" }, null, fakeFetch(githubRoutes(tgz, "v1")));
  fromLink.cleanup();
  assert.equal(fromLink.commit, SHA);
  const fromDefault = await fetchCommit(github, null, fakeFetch(githubRoutes(tgz, "HEAD")));
  fromDefault.cleanup();
  assert.equal(fromDefault.commit, SHA);
});

test("stops before unpacking an archive over the limits, and leaves no temporary folder", async () => {
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi", "r-abc/scripts/x.sh": "echo" });
  const fetchImpl = fakeFetch(githubRoutes(tgz));
  await allRemoved(async () => {
    await assert.rejects(fetchCommit(github, "main", fetchImpl, { downloadBytes: 10, unpackedBytes: 1e9, files: 1e5 }), /^Error: too large to check deeply: the download is larger than 10 bytes$/);
    await assert.rejects(fetchCommit(github, "main", fetchImpl, { downloadBytes: 1e9, unpackedBytes: 10, files: 1e5 }), /^Error: too large to check deeply: the unpacked archive is larger than 10 bytes$/);
    await assert.rejects(fetchCommit(github, "main", fetchImpl, { downloadBytes: 1e9, unpackedBytes: 1e9, files: 1 }), /^Error: too large to check deeply: the archive holds more than 1 files$/);
  });
});

test("names the default limits in the errors", async () => {
  const { ARCHIVE_LIMITS, describeLimit } = require("../../src/deep/archive");
  assert.deepEqual(ARCHIVE_LIMITS, { downloadBytes: 200 * 1024 ** 2, unpackedBytes: 1024 ** 3, files: 100_000 });
  assert.equal(describeLimit(ARCHIVE_LIMITS.downloadBytes), "200 MB");
  assert.equal(describeLimit(ARCHIVE_LIMITS.unpackedBytes), "1 GB");
  assert.equal(ARCHIVE_LIMITS.files.toLocaleString("en-US"), "100,000");
});

test("refuses an archive that holds a path outside its folder", async () => {
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi", "outside.txt": "x" }, ["r-abc/../outside.txt"]);
  await allRemoved(() => assert.rejects(fetchCommit(github, "main", fakeFetch(githubRoutes(tgz))), /the archive holds a path outside its folder/));
});

test("refuses an archive with an absolute path", async () => {
  const outside = makeTree({ "abs.txt": "x" });
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi" }, [path.join(outside, "abs.txt")]);
  await assert.rejects(fetchCommit(github, "main", fakeFetch(githubRoutes(tgz))), /the archive holds a path outside its folder/);
});

test("Gitea and Forgejo use their own commit and archive endpoints", async () => {
  const tgz = makeTarball({ "r/SKILL.md": "hi" });
  const api = "https://code.example/api/v1/repos/o/r";
  const query = "limit=1&stat=false&verification=false&files=false";
  const fetchImpl = fakeFetch({
    [`${api}/commits?sha=dev&${query}`]: { body: [{ sha: SHA }] },
    [`${api}/commits?${query}`]: { body: [{ sha: OTHER_SHA }] },
    [`${api}/archive/${SHA}.tar.gz`]: { body: tgz },
    [`${api}/archive/${OTHER_SHA}.tar.gz`]: { body: tgz },
  });
  const pinned = await fetchCommit(forgejo, "dev", fetchImpl);
  pinned.cleanup();
  assert.equal(pinned.commit, SHA);
  const byDefault = await fetchCommit(forgejo, null, fetchImpl);
  try {
    assert.equal(byDefault.commit, OTHER_SHA);
    assert.deepEqual(fs.readdirSync(byDefault.root), ["SKILL.md"]);
  } finally {
    byDefault.cleanup();
  }
});

test("a subpath link scans that folder of the unpacked commit", async () => {
  const tgz = makeTarball({ "r-abc/skills/x/SKILL.md": "hi", "r-abc/README.md": "top" });
  const got = await fetchCommit({ ...github, subpath: "skills/x" }, "main", fakeFetch(githubRoutes(tgz)));
  try {
    assert.deepEqual(fs.readdirSync(got.root), ["SKILL.md"]);
  } finally {
    got.cleanup();
  }
});

test("a subpath the commit does not hold, or one that leaves the repository, is a clear error", async () => {
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi" });
  await allRemoved(async () => {
    await assert.rejects(fetchCommit({ ...github, subpath: "skills/missing" }, "main", fakeFetch(githubRoutes(tgz))), /no folder skills\/missing in o\/r at aaaaaaa/);
    await assert.rejects(fetchCommit({ ...github, subpath: "../.." }, "main", fakeFetch(githubRoutes(tgz))), /no folder \.\.\/\.\. in o\/r at aaaaaaa/);
  });
});

test("a ref the host does not know is a clear error", async () => {
  const unknown = fakeFetch({ "https://api.github.com/repos/o/r/commits/nope": { status: 422, body: { message: "No commit found for SHA: nope" } } });
  await assert.rejects(fetchCommit(github, "nope", unknown), /^Error: no commit nope in o\/r$/);
  await assert.rejects(fetchCommit(github, "gone", fakeFetch({})), /^Error: no commit gone in o\/r$/);
  await assert.rejects(fetchCommit(forgejo, "nope", fakeFetch({})), /^Error: no commit nope in o\/r$/);
  const empty = fakeFetch({ "https://code.example/api/v1/repos/o/r/commits?sha=nope&limit=1&stat=false&verification=false&files=false": { body: [] } });
  await assert.rejects(fetchCommit(forgejo, "nope", empty), /^Error: no commit nope in o\/r$/);
});

test("a reply that is not a commit id is an error naming the address", async () => {
  const json = fakeFetch({ "https://api.github.com/repos/o/r/commits/main": { body: { sha: SHA } } });
  await assert.rejects(fetchCommit(github, "main", json), /did not answer a commit id: https:\/\/api\.github\.com\/repos\/o\/r\/commits\/main/);
  const other = fakeFetch({ "https://api.github.com/repos/o/r/commits/main": { status: 500, body: "down" } });
  await assert.rejects(fetchCommit(github, "main", other), /HTTP 500: https:\/\/api\.github\.com\/repos\/o\/r\/commits\/main/);
});

test("a download that fails is an error and leaves no temporary folder", async () => {
  const fetchImpl = fakeFetch({ "https://api.github.com/repos/o/r/commits/main": SHA });
  const notGzip = fakeFetch(githubRoutes(Buffer.from("not an archive")));
  await allRemoved(async () => {
    await assert.rejects(fetchCommit(github, "main", fetchImpl), new RegExp(`not found: https://codeload\\.github\\.com/o/r/tar\\.gz/${SHA}`));
    await assert.rejects(fetchCommit(github, "main", notGzip), /could not unpack the archive/);
  });
});

test("cleaning up removes its own exit and signal listeners", async () => {
  const counts = () => ["exit", "SIGINT", "SIGTERM"].map((e) => process.listenerCount(e));
  const before = counts();
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi" });
  for (let i = 0; i < 12; i++) {
    const got = await fetchCommit(github, "main", fakeFetch(githubRoutes(tgz)));
    assert.notDeepEqual(counts(), before);
    got.cleanup();
  }
  assert.deepEqual(counts(), before);
});

test("Ctrl-C during a slow download removes the temporary folder and ends the process by that signal", async (t) => {
  const child = spawn(process.execPath, ["-e", `
    const fs = require("fs");
    const makeFolder = fs.mkdtempSync;
    fs.mkdtempSync = (...args) => { const dir = makeFolder(...args); console.log("folder " + dir); return dir; };
    const { fetchCommit } = require(${JSON.stringify(ARCHIVE_PATH)});
    const slow = () => new ReadableStream({ pull(c) { c.enqueue(new Uint8Array([0x1f, 0x8b])); console.log("downloading"); return new Promise(() => {}); } });
    const fetchImpl = async (url) => url.includes("/commits/") ? new Response(${JSON.stringify(SHA)}) : new Response(slow());
    setInterval(() => {}, 1000);
    fetchCommit(${JSON.stringify(github)}, "main", fetchImpl);
  `], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  let out = "";
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  await new Promise((resolve) => child.stdout.on("data", (d) => {
    out += d;
    if (/downloading/.test(out)) resolve();
  }));
  const folder = /folder (\S+)/.exec(out)[1];
  assert.equal(fs.existsSync(folder), true);
  child.kill("SIGINT");
  const [code, signal] = await new Promise((resolve) => child.on("exit", (...args) => resolve(args)));
  assert.equal(stderr, "");
  assert.deepEqual([code, signal], [null, "SIGINT"]);
  assert.equal(fs.existsSync(folder), false);
});

// Runs fn, then checks it made at least one temporary folder and that every one is gone.
async function allRemoved(fn) {
  const made = [];
  const makeFolder = fs.mkdtempSync;
  fs.mkdtempSync = (...args) => {
    const dir = makeFolder(...args);
    made.push(dir);
    return dir;
  };
  try {
    await fn();
  } finally {
    fs.mkdtempSync = makeFolder;
  }
  assert.ok(made.length > 0);
  for (const dir of made) {
    assert.ok(path.basename(dir).startsWith("scanskillsafety-deep-"), dir);
    assert.equal(fs.existsSync(dir), false, `${dir} is removed`);
  }
}

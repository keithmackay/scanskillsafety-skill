"use strict";
// ABOUTME: Tests fetching the exact commit for a deep scan: a ref resolved to a commit id on GitHub, Gitea and Forgejo, its archive
// ABOUTME: downloaded and unpacked within limits, crafted archives refused, and the temporary folder removed every way it can end.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { fetchCommit } = require("../../src/deep/archive");
const { COMMIT_LIMITS } = require("../../src/deep/util");
const { describeDuration } = require("../../src/deep/runTool");
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

// The commit's file list is empty unless given, so nothing counts as left out of the archive.
const githubRoutes = (tgz, ref = "main", sha = SHA, tree = []) => ({
  [`https://api.github.com/repos/o/r/commits/${ref}`]: sha,
  [`https://codeload.github.com/o/r/tar.gz/${sha}`]: { body: tgz },
  [`https://api.github.com/repos/o/r/git/trees/${sha}?recursive=1`]: { body: { sha, truncated: false, tree } },
});

test("a file .gitattributes keeps out of the archive is fetched at that commit, and named", async () => {
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi" });
  const hooks = '{"hooks":{}}';
  const fetchImpl = fakeFetch({
    ...githubRoutes(tgz, "main", SHA, [{ path: "SKILL.md", type: "blob", mode: "100644", sha: OTHER_SHA, size: 2 }, { path: "hooks/hooks.json", type: "blob", mode: "100644", sha: "d".repeat(40), size: 12 }]),
    [`https://api.github.com/repos/o/r/git/blobs/${"d".repeat(40)}`]: { body: { encoding: "base64", content: Buffer.from(hooks).toString("base64") } },
  });
  const got = await fetchCommit(github, "main", fetchImpl);
  try {
    assert.deepEqual(got.fetchedSeparately, ["hooks/hooks.json"]);
    assert.deepEqual(got.leftOut, []);
    assert.equal(fs.readFileSync(path.join(got.root, "hooks", "hooks.json"), "utf-8"), hooks);
  } finally {
    got.cleanup();
  }
});

test("a commit file list the host cut short leaves no temporary folder and no result", async () => {
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi" });
  const fetchImpl = fakeFetch({
    ...githubRoutes(tgz),
    [`https://api.github.com/repos/o/r/git/trees/${SHA}?recursive=1`]: { body: { sha: SHA, truncated: true, tree: [] } },
  });
  await allRemoved(() => assert.rejects(fetchCommit(github, "main", fetchImpl), /could not list every file of the commit: the host cut its file list short/));
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
  const { describeLimit } = require("../../src/deep/util");
  assert.deepEqual(COMMIT_LIMITS, { downloadBytes: 200 * 1024 ** 2, unpackedBytes: 1024 ** 3, files: 100_000, downloadMs: 10 * 60 * 1000 });
  assert.equal(describeLimit(COMMIT_LIMITS.downloadBytes), "200 MB");
  assert.equal(describeLimit(COMMIT_LIMITS.unpackedBytes), "1 GB");
  assert.equal(COMMIT_LIMITS.files.toLocaleString("en-US"), "100,000");
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
    [`${api}/git/trees/${SHA}?recursive=true&per_page=10000&page=1`]: { body: { truncated: false, page: 1, tree: [] } },
    [`${api}/git/trees/${OTHER_SHA}?recursive=true&per_page=10000&page=1`]: { body: { truncated: false, page: 1, tree: [] } },
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

test("an owner or repository name is encoded in every address, so it cannot reach another path or query", async () => {
  const odd = { owner: "o?x=1", repo: "r#/../y" };
  const githubCalls = fakeFetch({});
  await assert.rejects(fetchCommit({ ...github, ...odd }, "main", githubCalls));
  assert.deepEqual(githubCalls.calls, ["https://api.github.com/repos/o%3Fx%3D1/r%23%2F..%2Fy/commits/main"]);
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi" });
  const archived = fakeFetch({
    "https://api.github.com/repos/o%3Fx%3D1/r%23%2F..%2Fy/commits/main": SHA,
    [`https://codeload.github.com/o%3Fx%3D1/r%23%2F..%2Fy/tar.gz/${SHA}`]: { body: tgz },
    [`https://api.github.com/repos/o%3Fx%3D1/r%23%2F..%2Fy/git/trees/${SHA}?recursive=1`]: { body: { truncated: false, tree: [] } },
  });
  (await fetchCommit({ ...github, ...odd }, "main", archived)).cleanup();
  assert.equal(archived.calls.length, 3);
  const giteaCalls = fakeFetch({});
  await assert.rejects(fetchCommit({ ...forgejo, ...odd }, "main", giteaCalls));
  assert.ok(giteaCalls.calls.length > 0);
  for (const url of giteaCalls.calls) assert.ok(url.startsWith("https://code.example/api/v1/repos/o%3Fx%3D1/r%23%2F..%2Fy"), url);
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
  const repository = fakeFetch({ "https://code.example/api/v1/repos/o/r": { body: { name: "r" } } });
  await assert.rejects(fetchCommit(forgejo, "nope", repository), /^Error: no commit nope in o\/r$/);
  const empty = fakeFetch({ "https://code.example/api/v1/repos/o/r/commits?sha=nope&limit=1&stat=false&verification=false&files=false": { body: [] } });
  await assert.rejects(fetchCommit(forgejo, "nope", empty), /^Error: no commit nope in o\/r$/);
});

test("a repository the host does not show is missing or private, which the deep scan cannot read", async () => {
  const missing = /^Error: no repository o\/r, or it is private \(the deep scan reads public repositories only\)$/;
  await assert.rejects(fetchCommit(github, null, fakeFetch({})), missing);
  await assert.rejects(fetchCommit(github, "main", fakeFetch({})), missing);
  const gone = fakeFetch({});
  await assert.rejects(fetchCommit(forgejo, "main", gone), missing);
  assert.deepEqual(gone.calls.slice(1), ["https://code.example/api/v1/repos/o/r"]);
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

test("Ctrl-C during a slow download removes the temporary folder and ends the process by that signal", { timeout: 10000 }, async (t) => {
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
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      out += d;
      if (/downloading/.test(out)) resolve();
    });
    child.on("exit", (code, signal) => reject(new Error(`the child ended before downloading (${code ?? signal}): ${stderr}`)));
  });
  const folder = /folder (\S+)/.exec(out)[1];
  assert.equal(fs.existsSync(folder), true);
  child.kill("SIGINT");
  const [code, signal] = await new Promise((resolve) => child.on("exit", (...args) => resolve(args)));
  assert.equal(stderr, "");
  assert.deepEqual([code, signal], [null, "SIGINT"]);
  assert.equal(fs.existsSync(folder), false);
});

test("refuses a subpath that passes through a link in the archive, and reads nothing outside", async () => {
  const outside = makeTree({ "secret/private.md": "not part of the target" });
  const root = makeTree({ "r-abc/SKILL.md": "hi" });
  fs.symlinkSync(outside, path.join(root, "r-abc", "link"));
  const out = path.join(makeTree({}), "out.tgz");
  assert.equal(spawnSync("tar", ["-czf", out, "-C", root, "r-abc"]).status, 0);
  const tgz = fs.readFileSync(out);
  await allRemoved(async () => {
    for (const subpath of ["link/secret", "link"]) {
      await assert.rejects(fetchCommit({ ...github, subpath }, "main", fakeFetch(githubRoutes(tgz))), new RegExp(`no folder ${subpath} in o/r at aaaaaaa`));
    }
  });
});

test("a download that takes longer than its time limit says so", { timeout: 5000 }, async () => {
  const neverAnswers = (url, { signal }) =>
    url.includes("/commits/") ? Promise.resolve(new Response(SHA)) : new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  const stalls = (url, { signal }) =>
    url.includes("/commits/")
      ? Promise.resolve(new Response(SHA))
      : Promise.resolve(new Response(new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([0x1f, 0x8b]));
          signal.addEventListener("abort", () => c.error(signal.reason));
        },
      })));
  const limits = { ...COMMIT_LIMITS, downloadMs: 50 };
  await allRemoved(async () => {
    await assert.rejects(fetchCommit(github, "main", neverAnswers, limits), /^Error: the download timed out after 50 ms$/);
    await assert.rejects(fetchCommit(github, "main", stalls, limits), /^Error: the download timed out after 50 ms$/);
  });
  assert.equal(describeDuration(COMMIT_LIMITS.downloadMs), "10 minutes");
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

test("tar's complaint is cut to 300 characters with control and format characters replaced", { skip: process.platform === "win32" ? "the stand-in tar is a POSIX script" : false }, async () => {
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi" });
  const bin = makeTree({});
  fs.writeFileSync(path.join(bin, "tar"), `#!${process.execPath}\nprocess.stderr.write("\\u0007\\u202e" + "e".repeat(1000));\nprocess.exitCode = 2;\n`, { mode: 0o755 });
  const savedPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
  try {
    await assert.rejects(fetchCommit(github, "main", fakeFetch(githubRoutes(tgz))), (err) => {
      const said = /^could not unpack the archive \(tar: (.*)\)$/s.exec(err.message);
      assert.ok(said, err.message);
      assert.equal(Array.from(said[1]).length, 300);
      assert.doesNotMatch(said[1], /[\p{Cc}\p{Cf}]/u);
      return true;
    });
  } finally {
    process.env.PATH = savedPath;
  }
});

test("a commit id of a SHA-256 repository (64 hex characters) is accepted", async () => {
  const tgz = makeTarball({ "r-abc/SKILL.md": "hi" });
  const long = "e".repeat(64);
  const got = await fetchCommit(github, "main", fakeFetch(githubRoutes(tgz, "main", long, [{ path: "SKILL.md", type: "blob", mode: "100644", sha: "f".repeat(64), size: 2 }])));
  got.cleanup();
  assert.equal(got.commit, long);
});

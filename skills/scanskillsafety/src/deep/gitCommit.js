// ABOUTME: Reads a repository's exact commit with git: a shallow fetch into a bare repository, isolated from every git setting
// ABOUTME: and credential, then every file read from git's object store within limits; nothing from the target is written out.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { runTool, describeDuration } = require("./runTool");
const { classifyFile, MAX_TEXT_BYTES } = require("./everyFile");
const { LINK_MODE, describeLimit, temporaryFolder } = require("./util");
const { repoPath } = require("../fetchRemote");

// What git does here, checked with git 2.56.1 against github.com, codeberg.org and a local repository on 2026-11-16:
// - `git fetch --depth 1 --filter=blob:limit=5m <url> <commit>` into an empty bare repository fetches that one commit, its trees
//   and its blobs up to 5 MB, even a commit that is not a branch tip (protocol v2, git's default since 2.26; a v0 server refuses
//   one that is not a tip, so the ref is then fetched by name and its commit compared).
// - A bare fetch carries none of the repository's own configuration: the only config in the bare repository is what git init
//   wrote and a remote entry for the URL marked promisor, from the filter.
// - Because of that promisor entry, git would fetch a filtered blob when asked about it later (ls-tree -l, cat-file), and a
//   "-c remote.<url>.promisor=false" given on the command line does not stop it. So the remote entry is removed right after the
//   fetch, and GIT_NO_LAZY_FETCH (git 2.44 and newer) is set as well: a filtered blob then reads as missing.
// - With http.followRedirects=false, a host that redirects (a renamed repository on some hosts; github.com serves a renamed
//   repository without one) fails with "The requested URL returned error: 301".
// - `ls-tree -l` prints no size for a filtered blob; `cat-file --batch-check` answers "<id> missing".
const GIT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 100;
const STDERR_MAX = 64 * 1024;
const READ_CHUNK_BYTES = 64 * 1024 ** 2;
const FILTER_SINCE = [2, 19];
const END_OF_OPTIONS_SINCE = [2, 24];
const REDIRECTED = /returned error: 30[1278]\b/;
const IS_WINDOWS = process.platform === "win32";

// No system or user configuration, no credential helper or prompt, no hooks, https only with no redirects followed, and every
// object checked as it arrives.
const ISOLATION_ARGS = [
  "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "credential.helper=",
  "-c", `core.hooksPath=${os.devNull}`, "-c", "transfer.fsckObjects=true", "-c", "http.followRedirects=false",
];

const tooLarge = (what) => new Error(`too large to check deeply: ${what}`);

const gitUrl = (target) => `${target.kind === "github" ? "https://github.com" : target.origin}/${repoPath(target)}.git`;

// What this git can do: leave out blobs by size when fetching, and end its options with --end-of-options.
function gitFeatures(versionLine) {
  const [major, minor] = (/(\d+)\.(\d+)/.exec(versionLine) || []).slice(1).map(Number);
  const since = ([m, n]) => major > m || (major === m && minor >= n);
  return { filter: since(FILTER_SINCE), endOfOptions: since(END_OF_OPTIONS_SINCE) };
}

// The environment git runs with: the person's own, less every GIT_ setting that could redirect or reconfigure it, with an empty
// home folder (so no .gitconfig, XDG configuration or .netrc of theirs is read, whatever the git version), plus isolation.
function gitEnv(env, home) {
  const kept = Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("GIT_") && name !== "SSH_ASKPASS"));
  return {
    ...kept,
    HOME: home,
    XDG_CONFIG_HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GIT_NO_LAZY_FETCH: "1",
  };
}

// Whether git is installed, and what it can do.
function findGit(env) {
  const run = runTool("git", ["version"], GIT_TIMEOUT_MS, { env: gitEnv(env, os.devNull) });
  if (run.error || run.status !== 0) return { found: false, filter: false, endOfOptions: false };
  return { found: true, ...gitFeatures(run.stdout) };
}

function folderSize(dir) {
  let total = 0;
  const walk = (at) => {
    let entries;
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += fs.lstatSync(full).size;
        } catch {}
      }
    }
  };
  walk(dir);
  return total;
}

// Runs a fetch while watching how much it has written, stopping it past the download limit or the time limit.
function fetchWithin(args, env, repoDir, limits) {
  const overLimit = () => tooLarge(`the fetch is larger than ${describeLimit(limits.downloadBytes)}`);
  return new Promise((resolve, reject) => {
    // Started in its own process group (on POSIX), so stopping it stops the helpers it starts, which write the download.
    const child = spawn("git", args, { env, stdio: ["ignore", "ignore", "pipe"], detached: !IS_WINDOWS });
    const killAll = () => {
      try {
        if (IS_WINDOWS) child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    // A group of its own no longer gets the terminal's Ctrl-C, so the scan's own ending stops it.
    process.once("exit", killAll);
    process.prependOnceListener("SIGINT", killAll);
    process.prependOnceListener("SIGTERM", killAll);
    let stderr = "";
    let stopped = null;
    child.stderr.on("data", (d) => {
      if (stderr.length < STDERR_MAX) stderr += d;
    });
    const stop = (err) => {
      if (stopped) return;
      stopped = err;
      killAll();
    };
    const poll = setInterval(() => folderSize(repoDir) > limits.downloadBytes && stop(overLimit()), POLL_MS);
    const timer = setTimeout(() => stop(new Error(`the fetch timed out after ${describeDuration(limits.downloadMs)}`)), limits.downloadMs);
    const done = () => {
      clearInterval(poll);
      clearTimeout(timer);
      process.removeListener("exit", killAll);
      process.removeListener("SIGINT", killAll);
      process.removeListener("SIGTERM", killAll);
    };
    child.on("error", (err) => {
      done();
      reject(err);
    });
    child.on("close", (status) => {
      done();
      if (stopped) reject(stopped);
      else if (folderSize(repoDir) > limits.downloadBytes) reject(overLimit());
      else resolve({ status, stderr });
    });
  });
}

const firstLine = (text) => text.split("\n").map((l) => l.trim()).find(Boolean) ?? "no reason given";

function refused(commit, url, reason) {
  const err = new Error(`git could not fetch commit ${commit} from ${url}: ${reason}`);
  err.gitRefused = true;
  return err;
}

// Listing order of a folder walk: path by path segment, so "a/z.md" comes before "a-b.md".
function byFolderOrder(a, b) {
  const x = a.path.split("/");
  const y = b.path.split("/");
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length - y.length;
}

// Entries of `ls-tree -r -z`: "<mode> <type> <object>\t<path>", each ended by NUL.
function treeEntries(bytes) {
  return bytes.toString("utf-8").split("\0").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    const [mode, type, object] = line.slice(0, tab).split(" ");
    return { mode, type, object, path: line.slice(tab + 1) };
  });
}

// The contents of blobs from `cat-file --batch`: "<object> <type> <size>\n<bytes>\n" for each.
function blobContents(bytes) {
  const contents = new Map();
  for (let at = 0; at < bytes.length;) {
    const end = bytes.indexOf(0x0a, at);
    const [object, type, size] = bytes.subarray(at, end).toString("utf-8").split(" ");
    if (type !== "blob") throw new Error(`git could not read object ${object}`);
    contents.set(object, bytes.subarray(end + 1, end + 1 + Number(size)));
    at = end + 1 + Number(size) + 1;
  }
  return contents;
}

// git: what findGit found this git can do. testOnlyProtocols: protocols a test serves from (file, http), for the fetch only.
async function readCommitWithGit({ target, commit, ref, url, limits, git, env = process.env, testOnlyProtocols = [] }) {
  const { dir, cleanup } = temporaryFolder("scanskillsafety-git-");
  const repo = path.join(dir, "repo.git");
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  const environment = gitEnv(env, home);
  const fetchArgs = (wanted) => [
    "-C", repo, ...ISOLATION_ARGS, ...testOnlyProtocols.flatMap((p) => ["-c", `protocol.${p}.allow=always`]),
    "fetch", "-q", "--depth", "1", "--no-tags", ...(git.filter ? [`--filter=blob:limit=${MAX_TEXT_BYTES}`] : []),
    ...(git.endOfOptions ? ["--end-of-options"] : []), url, wanted,
  ];
  const local = (args, options = {}) => {
    const run = runTool("git", ["-C", repo, ...ISOLATION_ARGS, ...args], GIT_TIMEOUT_MS, { env: environment, binary: true, ...options });
    if (run.error || run.status !== 0) throw new Error(`git could not read the commit (${firstLine(String(run.stderr ?? run.error))})`);
    return run.stdout;
  };
  const fetch = async (wanted) => {
    const run = await fetchWithin(fetchArgs(wanted), environment, repo, limits);
    if (REDIRECTED.test(run.stderr)) throw new Error("the repository answered with a redirect; scan its current address");
    return run;
  };
  try {
    const init = runTool("git", [...ISOLATION_ARGS, "init", "--bare", "-q", repo], GIT_TIMEOUT_MS, { env: environment });
    if (init.error || init.status !== 0) throw new Error(`git could not make a repository to fetch into (${firstLine(String(init.stderr ?? init.error))})`);
    const byId = await fetch(commit);
    if (byId.status !== 0) {
      const name = ref ?? target.ref ?? "HEAD";
      const byName = await fetch(name);
      if (byName.status !== 0) throw refused(commit, url, firstLine(byId.stderr));
      const fetched = local(["rev-parse", "--verify", "-q", "FETCH_HEAD^{commit}"]).toString("utf-8").trim();
      if (fetched !== commit) throw refused(commit, url, `the host gave another commit for ${name} (${fetched})`);
    }
    // The filter marks the URL a promisor remote; without the entry, a filtered blob stays missing instead of being fetched.
    if (git.filter) local(["config", "--remove-section", `remote.${url}`]);
    return readTree(target, commit, limits, local);
  } finally {
    cleanup();
  }
}

function readTree(target, commit, limits, local) {
  const prefix = target.subpath ? `${target.subpath.replace(/\/+$/, "")}/` : "";
  const all = treeEntries(local(["ls-tree", "-r", "-z", "--full-tree", commit]));
  if (all.length > limits.files) throw tooLarge(`the commit holds more than ${limits.files.toLocaleString("en-US")} files`);
  const entries = all.filter((e) => e.path.startsWith(prefix)).map((e) => ({ ...e, path: e.path.slice(prefix.length) }));
  if (prefix && entries.length === 0) throw new Error(`no folder ${target.subpath} in ${target.owner}/${target.repo} at ${commit.slice(0, 7)}`);
  const files = [];
  const leftOut = [];
  const blobs = [];
  for (const e of entries) {
    if (e.type === "commit") leftOut.push({ path: e.path, reason: "submodule, not read" });
    else if (e.type === "blob" && e.mode === LINK_MODE) leftOut.push({ path: e.path, reason: "symbolic link, not followed" });
    else if (e.type === "blob") blobs.push(e);
  }
  // A blob the size filter left out is missing from the fetch, and is over 5 MB.
  const sizes = new Map(local(["cat-file", "--batch-check"], { input: blobs.map((b) => b.object).join("\n") + "\n" })
    .toString("utf-8").split("\n").filter(Boolean).map((line) => {
      const [object, type, size] = line.split(" ");
      return [object, type === "blob" ? Number(size) : null];
    }));
  const toRead = [];
  for (const b of blobs) {
    const size = sizes.get(b.object);
    if (size === null || size === undefined || size > MAX_TEXT_BYTES) leftOut.push(classifyFile(b.path, null, MAX_TEXT_BYTES + 1).leftOut);
    else toRead.push({ ...b, size });
  }
  const total = toRead.reduce((sum, b) => sum + b.size, 0);
  if (total > limits.unpackedBytes) throw tooLarge(`the commit's files are larger than ${describeLimit(limits.unpackedBytes)}`);
  const contents = new Map();
  for (const chunk of chunksOf(toRead)) {
    for (const [object, bytes] of blobContents(local(["cat-file", "--batch"], { input: chunk.join("\n") + "\n" }))) contents.set(object, bytes);
  }
  for (const b of toRead) {
    const { file, leftOut: notRead } = classifyFile(b.path, contents.get(b.object));
    if (file) files.push(file);
    else leftOut.push(notRead);
  }
  files.sort(byFolderOrder);
  leftOut.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files, leftOut };
}

// Distinct objects in groups of about READ_CHUNK_BYTES, so no single read holds more than that.
function chunksOf(blobs) {
  const chunks = [];
  const seen = new Set();
  let chunk = [];
  let size = 0;
  for (const b of blobs) {
    if (seen.has(b.object)) continue;
    seen.add(b.object);
    if (chunk.length > 0 && size + b.size > READ_CHUNK_BYTES) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(b.object);
    size += b.size;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

module.exports = { readCommitWithGit, findGit, gitUrl, gitFeatures };

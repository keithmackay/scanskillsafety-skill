"use strict";
// ABOUTME: Tests reading a commit with git: a real local repository stands in for the host (file:// is allowed in tests only), and
// ABOUTME: every file of the commit is read, including ones .gitattributes keeps out of an archive, within limits and isolated.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const http = require("http");
const { readCommitWithGit, findGit, gitUrl, gitFeatures } = require("../../src/deep/gitCommit");
const { COMMIT_LIMITS } = require("../../src/deep/util");
const { makeTree } = require("../helpers");
const { sourceRepository, git, HOOKS } = require("./gitSource");

const hasGit = spawnSync("git", ["--version"]).status === 0;
const skip = hasGit ? false : "no git here";

const FEATURES = { filter: true, endOfOptions: true };
// A git on PATH that runs the shell text given before handing its arguments to the real git.
function wrappedGit(shell) {
  const bin = makeTree({});
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\n${shell}\nexec ${JSON.stringify(gitPath())} "$@"\n`, { mode: 0o755 });
  return { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}
const target = { kind: "github", owner: "o", repo: "r", ref: null, subpath: "", isFile: false };
const read = (source, options = {}) =>
  readCommitWithGit({ target, commit: source.commit, ref: null, url: source.url, limits: COMMIT_LIMITS, git: FEATURES, testOnlyProtocols: ["file"], ...options });

test("reads every file of the commit, one .gitattributes keeps out of an archive too, and lists what it does not read", { skip }, async () => {
  const source = sourceRepository();
  const { files, leftOut } = await read(source);
  assert.deepEqual(files.map((f) => f.path), [".gitattributes", "SKILL.md", "hooks/hooks.json", "skills/x/SKILL.md"]);
  assert.deepEqual(files.find((f) => f.path === "hooks/hooks.json"), { path: "hooks/hooks.json", size: Buffer.byteLength(HOOKS), text: HOOKS });
  assert.deepEqual(leftOut, [
    { path: "big.txt", reason: "larger than 5 MB" },
    { path: "img.png", reason: "binary" },
    { path: "link", reason: "symbolic link, not followed" },
    { path: "sub", reason: "submodule, not read" },
  ]);
});

test("a host that ignores the size filter still has its files over 5 MB listed, not read", { skip }, async () => {
  const source = sourceRepository();
  git(source.root, "config", "uploadpack.allowFilter", "false");
  const { leftOut } = await read(source);
  assert.deepEqual(leftOut.find((f) => f.path === "big.txt"), { path: "big.txt", reason: "larger than 5 MB" });
});

test("files are ordered as listing the folder orders them", { skip }, async () => {
  const source = sourceRepository({ "a-b.md": "x", "a/z.md": "y" });
  const names = (await read(source)).files.map((f) => f.path);
  assert.ok(names.indexOf("a/z.md") < names.indexOf("a-b.md"), names.join(" "));
});

test("a subpath link reads that folder, with paths from it; a subpath the commit lacks is an error", { skip }, async () => {
  const source = sourceRepository();
  const { files, leftOut } = await read(source, { target: { ...target, subpath: "skills/x" } });
  assert.deepEqual(files.map((f) => f.path), ["SKILL.md"]);
  assert.deepEqual(leftOut, []);
  await assert.rejects(read(source, { target: { ...target, subpath: "skills/missing" } }), new RegExp(`^Error: no folder skills/missing in o/r at ${source.commit.slice(0, 7)}$`));
  await assert.rejects(read(source, { target: { ...target, subpath: "SKILL.md" } }), /no folder SKILL\.md in o\/r/);
});

test("stops a fetch past the download limit, and a commit past the file or size limits", { skip }, async () => {
  const source = sourceRepository({ "noise.txt": crypto.randomBytes(200 * 1024).toString("hex") });
  await assert.rejects(read(source, { limits: { ...COMMIT_LIMITS, downloadBytes: 50 * 1024 } }), /^Error: too large to check deeply: the fetch is larger than 51200 bytes$/);
  await assert.rejects(read(source, { limits: { ...COMMIT_LIMITS, files: 2 } }), /^Error: too large to check deeply: the commit holds more than 2 files$/);
  await assert.rejects(read(source, { limits: { ...COMMIT_LIMITS, unpackedBytes: 1024 } }), /^Error: too large to check deeply: the commit's files are larger than 1024 bytes$/);
});

test("a fetch that runs past its time limit says so", { skip, timeout: 10000 }, async (t) => {
  const bin = makeTree({});
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\ncase "$*" in *fetch*) exec sleep 5;; esac\nexec ${JSON.stringify(gitPath())} "$@"\n`, { mode: 0o755 });
  await assert.rejects(read(sourceRepository(), { env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, limits: { ...COMMIT_LIMITS, downloadMs: 300 } }), /^Error: the fetch timed out after 300 ms$/);
});

test("a commit the host will not serve to git by id or by name is a refusal the caller can fall back from", { skip }, async () => {
  const source = sourceRepository();
  const err = await read(source, { commit: "0".repeat(39) + "1", ref: "HEAD" }).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.equal(err.gitRefused, true);
  assert.match(err.message, /^git could not fetch commit 0{39}1 from file:/);
});

test("a host that refuses a commit id is asked for the ref by name, and the commit it gives must be the one resolved", { skip }, async () => {
  const source = sourceRepository();
  const bin = makeTree({});
  // Refuses any fetch that names a commit id, as a server without uploadpack.allowReachableSHA1InWant does for one that is not a tip.
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\ncase "$*" in *fetch*[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) echo "error: Server does not allow request for unadvertised object" >&2; exit 1;; esac\nexec ${JSON.stringify(gitPath())} "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const { files } = await read(source, { ref: "HEAD", env });
  assert.ok(files.some((f) => f.path === "hooks/hooks.json"));
  git(source.root, "commit", "-q", "--allow-empty", "-m", "moved on");
  const err = await read(source, { ref: "HEAD", env }).catch((e) => e);
  assert.equal(err.gitRefused, true);
  assert.match(err.message, /the host gave another commit for HEAD/);
});

test("git runs with no user or system configuration, no credentials, no prompts and no hooks, over https only", { skip }, async () => {
  const bin = makeTree({});
  const log = path.join(makeTree({}), "calls");
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\n{ printf 'ARGS'; for a; do printf ' [%s]' "$a"; done; echo; env | grep -E '^(GIT_|SSH_ASKPASS)' | sort; } >> ${JSON.stringify(log)}\nexit 1\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GIT_CONFIG_PARAMETERS: "'protocol.file.allow'='always'", GIT_DIR: "/elsewhere", GIT_ASKPASS: "/bin/echo" };
  await assert.rejects(readCommitWithGit({ target, commit: "c".repeat(40), ref: null, url: "https://github.com/o/r.git", limits: COMMIT_LIMITS, git: FEATURES, env }));
  const calls = fs.readFileSync(log, "utf-8");
  for (const arg of ["protocol.allow=never", "protocol.https.allow=always", "credential.helper=", `core.hooksPath=${os.devNull}`, "transfer.fsckObjects=true", "http.followRedirects=false"]) {
    assert.ok(calls.includes(`[-c] [${arg}]`), `${arg} in ${calls}`);
  }
  assert.doesNotMatch(calls, /protocol\.file\.allow/);
  for (const line of ["GIT_CONFIG_NOSYSTEM=1", `GIT_CONFIG_GLOBAL=${os.devNull}`, "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=", "SSH_ASKPASS=", "GIT_NO_LAZY_FETCH=1"]) {
    assert.ok(calls.split("\n").includes(line), `${line} in ${calls}`);
  }
  assert.doesNotMatch(calls, /GIT_CONFIG_PARAMETERS|GIT_DIR=/);
});

test("the person's own git configuration is not applied", { skip }, async () => {
  const source = sourceRepository();
  const home = makeTree({ ".gitconfig": `[url "file:///nowhere/"]\n\tinsteadOf = ${source.url}\n` });
  const { files } = await read(source, { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home } });
  assert.ok(files.some((f) => f.path === "SKILL.md"));
});

test("names the address git fetches from, and finds git and whether it can filter by size", () => {
  assert.equal(gitUrl(target), "https://github.com/o/r.git");
  assert.equal(gitUrl({ kind: "git-host", origin: "https://code.example", owner: "o?x", repo: "r#y" }), "https://code.example/o%3Fx/r%23y.git");
  assert.deepEqual(gitFeatures("git version 2.18.0"), { filter: false, endOfOptions: false });
  assert.deepEqual(gitFeatures("git version 2.19.0"), { filter: true, endOfOptions: false });
  assert.deepEqual(gitFeatures("git version 2.24.0"), { filter: true, endOfOptions: true });
  assert.deepEqual(gitFeatures("git version 2.56.1.windows.1"), { filter: true, endOfOptions: true });
  assert.equal(findGit({ PATH: makeTree({}) }).found, false);
  if (hasGit) assert.equal(findGit(process.env).found, true);
});

function gitPath() {
  return spawnSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).stdout.trim();
}

test("a blob the size filter left out is never fetched later, even by a git that does not know GIT_NO_LAZY_FETCH", { skip }, async () => {
  const source = sourceRepository();
  // Reading after the fetch is not allowed file://, so a lazy fetch of big.txt would fail the read.
  const { leftOut } = await read(source, { env: wrappedGit("unset GIT_NO_LAZY_FETCH") });
  assert.deepEqual(leftOut.find((f) => f.path === "big.txt"), { path: "big.txt", reason: "larger than 5 MB" });
});

test("git sees an empty home folder, so no .gitconfig, .netrc or XDG configuration of the person's is read", { skip }, async () => {
  const log = path.join(makeTree({}), "homes");
  const home = makeTree({ ".netrc": "machine github.com login me password secret\n", ".gitconfig": "[http]\n\textraHeader = Authorization: secret\n" });
  const env = { ...wrappedGit(`{ echo "HOME=$HOME XDG=$XDG_CONFIG_HOME USERPROFILE=$USERPROFILE"; ls -A "$HOME"; } >> ${JSON.stringify(log)}`), HOME: home, XDG_CONFIG_HOME: home, USERPROFILE: home };
  await read(sourceRepository(), { env });
  const lines = fs.readFileSync(log, "utf-8").split("\n").filter(Boolean);
  const homes = lines.filter((l) => l.startsWith("HOME="));
  assert.ok(homes.length > 0);
  for (const line of homes) {
    const [, given] = /^HOME=(\S+) /.exec(line);
    assert.notEqual(given, home);
    assert.equal(line, `HOME=${given} XDG=${given} USERPROFILE=${given}`);
  }
  assert.deepEqual(lines.filter((l) => !l.startsWith("HOME=")), [], "the home folder git sees is empty");
});

test("a repository that answers with a redirect is not followed, and the scan says to use its current address", { skip }, async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(301, { Location: `http://127.0.0.1:${server.address().port}/moved${req.url}` });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const err = await read(sourceRepository(), { url: `http://127.0.0.1:${server.address().port}/o/r.git`, testOnlyProtocols: ["http"] }).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.equal(err.message, "the repository answered with a redirect; scan its current address");
  assert.notEqual(err.gitRefused, true);
});

test("stopping a fetch stops every process git started", { skip, timeout: 10000 }, async () => {
  const pidFile = path.join(makeTree({}), "pid");
  const env = wrappedGit(`case "$*" in *fetch*) sleep 30 & echo $! > ${JSON.stringify(pidFile)}; wait; exit 1;; esac`);
  await assert.rejects(read(sourceRepository(), { env, limits: { ...COMMIT_LIMITS, downloadMs: 500 } }), /the fetch timed out/);
  const pid = Number(fs.readFileSync(pidFile, "utf-8"));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("a ref that looks like an option is fetched as a ref, never read as one", { skip }, async () => {
  const marker = path.join(makeTree({}), "ran");
  // Refuses fetches by commit id, so the ref is fetched by name.
  const env = wrappedGit(`case "$*" in *fetch*" "[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) exit 1;; esac`);
  await assert.rejects(read(sourceRepository(), { ref: `--upload-pack=touch ${marker}`, env }));
  assert.equal(fs.existsSync(marker), false);
});

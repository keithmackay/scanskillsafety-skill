"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fetchText, gatherGithub, gatherGitHost, gatherRawUrl } = require("../src/fetchRemote");
const { fakeFetch } = require("./helpers");

const API = "https://api.github.com/repos/o/r";
const RAW = "https://raw.githubusercontent.com/o/r";

test("fetchText classifies 404, rate limits, and network errors", async () => {
  const f = fakeFetch({ "https://a/limited": { status: 403, body: "rate limit" }, "https://a/down": new TypeError("fetch failed") });
  assert.equal((await fetchText(f, "https://a/missing")).reason, "not-found");
  assert.equal((await fetchText(f, "https://a/limited")).reason, "rate-limited");
  assert.equal((await fetchText(f, "https://a/down")).reason, "network");
});

test("fetchText times out instead of hanging", async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  const result = await fetchText(hang, "https://slow", { timeoutMs: 20 });
  assert.equal(result.reason, "timeout");
});

test("GitHub: resolves the default branch, lists the tree, and fetches only discoverable files", async () => {
  const f = fakeFetch({
    [API]: { body: { default_branch: "trunk" } },
    [`${API}/git/trees/trunk?recursive=1`]: { body: { truncated: false, tree: [
      { path: "SKILL.md", type: "blob", size: 10 },
      { path: "skills/x/SKILL.md", type: "blob", size: 10 },
      { path: "src/index.js", type: "blob", size: 10 },
      { path: "skills", type: "tree" },
    ] } },
    [`${RAW}/trunk/SKILL.md`]: "root skill",
    [`${RAW}/trunk/skills/x/SKILL.md`]: "nested skill",
  });
  const result = await gatherGithub({ owner: "o", repo: "r", ref: null, subpath: "", isFile: false }, f);
  assert.deepEqual(result.files.map((x) => x.path).sort(), ["SKILL.md", "skills/x/SKILL.md"]);
  assert.ok(!f.calls.some((u) => u.endsWith("src/index.js")));
  assert.deepEqual(result.errors, []);
});

test("GitHub: a subdirectory target scans only that subtree, with paths relative to it", async () => {
  const f = fakeFetch({
    [`${API}/git/trees/main?recursive=1`]: { body: { tree: [
      { path: "skills/pdf/SKILL.md", type: "blob", size: 5 },
      { path: "skills/docx/SKILL.md", type: "blob", size: 5 },
    ] } },
    [`${RAW}/main/skills/pdf/SKILL.md`]: "pdf",
  });
  const result = await gatherGithub({ owner: "o", repo: "r", ref: "main", subpath: "skills/pdf", isFile: false }, f);
  assert.deepEqual(result.files, [{ path: "SKILL.md", text: "pdf" }]);
});

test("GitHub: a blob URL fetches exactly that file", async () => {
  const f = fakeFetch({ [`${RAW}/dev/skills/x/SKILL.md`]: "one file" });
  const result = await gatherGithub({ owner: "o", repo: "r", ref: "dev", subpath: "skills/x/SKILL.md", isFile: true }, f);
  assert.deepEqual(result.files, [{ path: "skills/x/SKILL.md", text: "one file" }]);
});

test("GitHub: when the API is rate-limited, falls back to probing main/master and says so", async () => {
  const f = fakeFetch({
    [API]: { status: 403, body: "rate limit" },
    [`${RAW}/master/SKILL.md`]: "fallback skill",
  });
  const result = await gatherGithub({ owner: "o", repo: "r", ref: null, subpath: "", isFile: false }, f);
  assert.deepEqual(result.files, [{ path: "SKILL.md", text: "fallback skill" }]);
  assert.ok(result.notices.some((n) => /rate-limited/.test(n)));
});

test("GitHub: a missing repo reports a not-found error rather than an empty success", async () => {
  const result = await gatherGithub({ owner: "o", repo: "r", ref: null, subpath: "", isFile: false }, fakeFetch({}));
  assert.equal(result.files.length, 0);
  assert.ok(result.errors.some((e) => /not found/i.test(e)));
});

test("Gitea/Forgejo: uses the repo API for default branch, tree, and raw files", async () => {
  const base = "https://git.example.com/api/v1/repos/o/r";
  const f = fakeFetch({
    [base]: { body: { default_branch: "main" } },
    [`${base}/git/trees/main?recursive=true&per_page=1000`]: { body: { tree: [
      { path: ".claude-plugin/plugin.json", type: "blob", size: 2 },
      { path: "lib/x.js", type: "blob", size: 2 },
    ] } },
    [`${base}/raw/.claude-plugin/plugin.json?ref=main`]: "{}",
  });
  const result = await gatherGitHost({ origin: "https://git.example.com", owner: "o", repo: "r", ref: null, subpath: "", isFile: false }, f);
  assert.deepEqual(result.files, [{ path: ".claude-plugin/plugin.json", text: "{}" }]);
});

test("raw URL: fetched directly, named by its last path segment", async () => {
  const f = fakeFetch({ "https://example.com/x/SKILL.md": "raw" });
  const result = await gatherRawUrl("https://example.com/x/SKILL.md", f);
  assert.deepEqual(result.files, [{ path: "SKILL.md", text: "raw" }]);
});

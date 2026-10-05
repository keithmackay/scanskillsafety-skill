"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseTarget } = require("../src/parseTarget");
const { makeTree } = require("./helpers");

test("plain GitHub repo URL", () => {
  assert.deepEqual(parseTarget("https://github.com/owner/repo"), {
    kind: "github", owner: "owner", repo: "repo", ref: null, subpath: "", isFile: false,
  });
});

test("GitHub URL with .git suffix and trailing slash", () => {
  assert.equal(parseTarget("https://github.com/owner/repo.git").repo, "repo");
  assert.equal(parseTarget("https://github.com/owner/repo/").repo, "repo");
});

test("GitHub tree URL into a monorepo subdirectory", () => {
  assert.deepEqual(parseTarget("https://github.com/anthropics/skills/tree/main/skills/pdf"), {
    kind: "github", owner: "anthropics", repo: "skills", ref: "main", subpath: "skills/pdf", isFile: false,
  });
});

test("GitHub blob URL to a single file", () => {
  assert.deepEqual(parseTarget("https://github.com/o/r/blob/dev/skills/x/SKILL.md"), {
    kind: "github", owner: "o", repo: "r", ref: "dev", subpath: "skills/x/SKILL.md", isFile: true,
  });
});

test("other github.com pages fall back to the repo root", () => {
  const t = parseTarget("https://github.com/o/r/issues/12");
  assert.equal(t.kind, "github");
  assert.equal(t.repo, "r");
  assert.equal(t.subpath, "");
});

test("Gitea/Forgejo src/branch URL", () => {
  assert.deepEqual(parseTarget("https://git.example.com/o/r/src/branch/trunk/plugins/p"), {
    kind: "git-host", origin: "https://git.example.com", owner: "o", repo: "r", ref: "trunk", subpath: "plugins/p", isFile: false,
  });
});

test("plain self-hosted repo URL", () => {
  const t = parseTarget("https://git.example.com/o/r");
  assert.equal(t.kind, "git-host");
  assert.equal(t.ref, null);
});

test("raw.githubusercontent.com and one-segment URLs are fetched directly", () => {
  assert.equal(parseTarget("https://raw.githubusercontent.com/o/r/main/SKILL.md").kind, "raw-url");
  assert.equal(parseTarget("https://example.com/SKILL.md").kind, "raw-url");
});

test("local directory and local file", () => {
  const root = makeTree({ "SKILL.md": "hi" });
  assert.deepEqual(parseTarget(root), { kind: "local-dir", path: root });
  assert.deepEqual(parseTarget(`${root}/SKILL.md`), { kind: "local-file", path: `${root}/SKILL.md` });
});

test("garbage input is invalid", () => {
  assert.equal(parseTarget("not a url or path").kind, "invalid");
});

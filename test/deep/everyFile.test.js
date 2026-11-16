"use strict";
// ABOUTME: Tests listing every file of a deep scan: text files read whole, everything else listed with the reason, .git not
// ABOUTME: read and links never followed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { listEveryFile } = require("../../src/deep/everyFile");
const { makeTree } = require("../helpers");

test("reads every text file, tests included, and lists binary, oversized, non-UTF-8 files and links with the reason", () => {
  const root = makeTree({ "a.md": "hi", "tests/t.py": "print(1)", "img.png": Buffer.from([0x89, 0x50, 0, 1]), "bad.txt": Buffer.from([0xff, 0xfe, 0x41]) });
  fs.writeFileSync(path.join(root, "big.txt"), "x".repeat(5 * 1024 * 1024 + 1));
  fs.symlinkSync("/etc/passwd", path.join(root, "link"));
  const { files, leftOut } = listEveryFile(root);
  assert.deepEqual(files.map((f) => f.path), ["a.md", "tests/t.py"]);
  assert.deepEqual(files[1], { path: "tests/t.py", size: 8, text: "print(1)" });
  assert.deepEqual(leftOut, [
    { path: "bad.txt", reason: "not UTF-8 text" },
    { path: "big.txt", reason: "larger than 5 MB" },
    { path: "img.png", reason: "binary" },
    { path: "link", reason: "symbolic link, not followed" },
  ]);
});

test("does not read a .git folder", () => {
  const root = makeTree({ ".git/config": "[core]", "x.md": "y" });
  assert.deepEqual(listEveryFile(root).files.map((f) => f.path), ["x.md"]);
});

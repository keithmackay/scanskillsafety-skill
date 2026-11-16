"use strict";
// ABOUTME: Tests listing every file of a deep scan: text files read whole, everything else listed with the reason, .git not
// ABOUTME: read and links never followed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
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

test("does not read a .git folder; one below the root is listed as git metadata, the root's own is not", () => {
  const root = makeTree({ ".git/config": "[core]", "x.md": "y", "sub/.git/config": "[core]", "sub/z.md": "z" });
  const { files, leftOut } = listEveryFile(root);
  assert.deepEqual(files.map((f) => f.path), ["sub/z.md", "x.md"]);
  assert.deepEqual(leftOut, [{ path: "sub/.git", reason: "git metadata folder, not read" }]);
});

test("lists a folder it cannot read with the reason and reads the rest", { skip: process.getuid && process.getuid() === 0 ? "root reads every folder" : false }, (t) => {
  const root = makeTree({ "a.md": "hi", "locked/b.md": "secret", "z.md": "bye" });
  const locked = path.join(root, "locked");
  fs.chmodSync(locked, 0o000);
  t.after(() => fs.chmodSync(locked, 0o755));
  const { files, leftOut } = listEveryFile(root);
  assert.deepEqual(files.map((f) => f.path), ["a.md", "z.md"]);
  assert.deepEqual(leftOut, [{ path: "locked", reason: "unreadable (EACCES)" }]);
});

test("does not follow a link swapped in for a file after the folder was listed", { skip: fs.constants.O_NOFOLLOW === undefined ? "no O_NOFOLLOW here" : false }, (t) => {
  const outside = makeTree({ "private.txt": "not part of the target" });
  const root = makeTree({});
  fs.symlinkSync(path.join(outside, "private.txt"), path.join(root, "swapped.txt"));
  // The listing reports a regular file, as it would have before the swap.
  const readdirSync = fs.readdirSync;
  t.after(() => (fs.readdirSync = readdirSync));
  fs.readdirSync = (dir, options) =>
    readdirSync(dir, options).map((entry) => Object.assign(Object.create(Object.getPrototypeOf(entry)), entry, { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true }));
  const { files, leftOut } = listEveryFile(root);
  assert.deepEqual(files, []);
  assert.equal(leftOut.length, 1);
  assert.match(leftOut[0].reason, /^unreadable \((ELOOP|EMLINK)\)$/);
});

const canMakeFifo = spawnSync("mkfifo", ["--help"]).error === undefined;

test("lists a FIFO swapped in for a file after the folder was listed as not a regular file, without waiting on it", { skip: canMakeFifo ? false : "no mkfifo here", timeout: 5000 }, (t) => {
  const root = makeTree({});
  assert.equal(spawnSync("mkfifo", [path.join(root, "pipe.txt")]).status, 0);
  // The listing reports a regular file, as it would have before the swap.
  const readdirSync = fs.readdirSync;
  t.after(() => (fs.readdirSync = readdirSync));
  fs.readdirSync = (dir, options) =>
    readdirSync(dir, options).map((entry) => Object.assign(Object.create(Object.getPrototypeOf(entry)), entry, { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true }));
  const { files, leftOut } = listEveryFile(root);
  assert.deepEqual(files, []);
  assert.deepEqual(leftOut, [{ path: "pipe.txt", reason: "not a regular file" }]);
});

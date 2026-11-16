// ABOUTME: Lists every file under a folder for the deep scan: text files are read whole; binary, non-UTF-8 and oversized files,
// ABOUTME: links and anything else are listed with the reason, never skipped silently. Links are never followed; .git is not read.
"use strict";

const fs = require("fs");
const path = require("path");

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const BINARY_PROBE_BYTES = 8 * 1024;
// A link swapped in for a file after its folder was listed fails to open rather than being followed (where the system can say so).
const OPEN_WITHOUT_FOLLOWING = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
const utf8 =new TextDecoder("utf-8", { fatal: true });
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function listEveryFile(root) {
  const files = [];
  const leftOut = [];
  const unreadable = (relPath, err) => leftOut.push({ path: relPath, reason: `unreadable (${err.code ?? err.message})` });
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return unreadable(rel, err);
    }
    for (const entry of entries.sort(byName)) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) leftOut.push({ path: relPath, reason: "symbolic link, not followed" });
      else if (entry.isDirectory()) {
        if (entry.name !== ".git") walk(full, relPath);
      } else if (!entry.isFile()) leftOut.push({ path: relPath, reason: "not a regular file" });
      else readOne(full, relPath);
    }
  };
  const readOne = (full, relPath) => {
    let size;
    let bytes;
    let fd;
    try {
      fd = fs.openSync(full, OPEN_WITHOUT_FOLLOWING);
      size = fs.fstatSync(fd).size;
      if (size <= MAX_TEXT_BYTES) bytes = fs.readFileSync(fd);
    } catch (err) {
      return unreadable(relPath, err);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    if (size > MAX_TEXT_BYTES) return leftOut.push({ path: relPath, reason: "larger than 5 MB" });
    if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return leftOut.push({ path: relPath, reason: "binary" });
    try {
      files.push({ path: relPath, size, text: utf8.decode(bytes) });
    } catch {
      leftOut.push({ path: relPath, reason: "not UTF-8 text" });
    }
  };
  walk(root, "");
  leftOut.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files, leftOut };
}

module.exports = { listEveryFile, MAX_TEXT_BYTES };

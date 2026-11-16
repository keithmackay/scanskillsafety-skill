// ABOUTME: Lists every file under a folder for the deep scan: text files are read whole; binary, non-UTF-8 and oversized files,
// ABOUTME: links and anything else are listed with the reason, never skipped silently. Links are never followed; .git is not read.
"use strict";

const fs = require("fs");
const path = require("path");

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const BINARY_PROBE_BYTES = 8 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function listEveryFile(root) {
  const files = [];
  const leftOut = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort(byName)) {
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
    const size = fs.lstatSync(full).size;
    if (size > MAX_TEXT_BYTES) return leftOut.push({ path: relPath, reason: "larger than 5 MB" });
    let bytes;
    try {
      bytes = fs.readFileSync(full);
    } catch (err) {
      return leftOut.push({ path: relPath, reason: `unreadable (${err.code ?? err.message})` });
    }
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

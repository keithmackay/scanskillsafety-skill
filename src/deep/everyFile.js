// ABOUTME: Lists every file under a folder for the deep scan: text files are read whole; binary, non-UTF-8 and oversized files,
// ABOUTME: links and anything else are listed with the reason, never skipped silently. Links are never followed; .git is not read.
"use strict";

const fs = require("fs");
const path = require("path");

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const BINARY_PROBE_BYTES = 8 * 1024;
// A link swapped in for a file after its folder was listed fails to open rather than being followed, and a FIFO or device swapped
// in opens without waiting, so the opened file's type can be checked (where the system can say so).
const OPEN_WITHOUT_FOLLOWING = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
const utf8 = new TextDecoder("utf-8", { fatal: true });
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Whether a file is read as text: { file: { path, size, text } }, or { leftOut: { path, reason } } for a file over 5 MB (whose bytes
// need not be given), a binary file or one that is not UTF-8.
function classifyFile(relPath, bytes, size = bytes.length) {
  if (size > MAX_TEXT_BYTES) return { leftOut: { path: relPath, reason: "larger than 5 MB" } };
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return { leftOut: { path: relPath, reason: "binary" } };
  try {
    return { file: { path: relPath, size, text: utf8.decode(bytes) } };
  } catch {
    return { leftOut: { path: relPath, reason: "not UTF-8 text" } };
  }
}

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
        // The root's own .git is the checkout being read; one further down is another repository's metadata, named so.
        if (entry.name !== ".git") walk(full, relPath);
        else if (rel) leftOut.push({ path: relPath, reason: "git metadata folder, not read" });
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
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) return leftOut.push({ path: relPath, reason: "not a regular file" });
      size = stat.size;
      if (size <= MAX_TEXT_BYTES) bytes = fs.readFileSync(fd);
    } catch (err) {
      return unreadable(relPath, err);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    const { file, leftOut: notRead } = classifyFile(relPath, bytes, size);
    if (file) files.push(file);
    else leftOut.push(notRead);
  };
  walk(root, "");
  leftOut.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files, leftOut };
}

module.exports = { listEveryFile, classifyFile, MAX_TEXT_BYTES };

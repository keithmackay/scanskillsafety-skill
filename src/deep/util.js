// ABOUTME: Small helpers the deep scan's files share: path names, ordering, JSON and object checks, git object ids, vendored
// ABOUTME: folders, how a size limit is named, and temporary folders removed however the scan ends.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// A git object id, a commit's among them: 40 hex characters (SHA-1) or 64 (SHA-256).
const OBJECT_ID = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

// How much of a repository's commit the deep scan fetches and reads: bytes downloaded, bytes of its files, files, and time.
const COMMIT_LIMITS = { downloadBytes: 200 * 1024 ** 2, unpackedBytes: 1024 ** 3, files: 100_000, downloadMs: 10 * 60 * 1000 };

// The mode git gives a symbolic link.
const LINK_MODE = "120000";

// Folders that hold copies of other projects' code.
const VENDORED_FOLDERS = ["node_modules", "vendor"];

const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isVendored = (p) => p.split("/").slice(0, -1).some((s) => VENDORED_FOLDERS.includes(s));

// The parsed JSON, or null when the text is not JSON.
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const describeLimit = (bytes) =>
  bytes % 1024 ** 3 === 0 ? `${bytes / 1024 ** 3} GB` : bytes % 1024 ** 2 === 0 ? `${bytes / 1024 ** 2} MB` : `${bytes} bytes`;

// A temporary folder removed by cleanup(), and also when the process exits or is stopped by Ctrl-C or SIGTERM, after which the
// signal is sent again so the process ends as it would have. Cleaning up removes its own listeners; a folder that cannot be
// removed (a program still holding it open on Windows) is left rather than ending the scan.
function temporaryFolder(prefix, tmpDir = os.tmpdir()) {
  const dir = fs.mkdtempSync(path.join(tmpDir, prefix));
  const cleanup = () => {
    process.removeListener("exit", cleanup);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  };
  const onSignal = (signal) => {
    cleanup();
    process.kill(process.pid, signal);
  };
  process.once("exit", cleanup);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return { dir, cleanup };
}

module.exports = { OBJECT_ID, COMMIT_LIMITS, LINK_MODE, VENDORED_FOLDERS, baseName, compare, isObject, isVendored, parseJson, describeLimit, temporaryFolder };

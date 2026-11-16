// ABOUTME: Small helpers the deep scan's files share: path names, ordering, JSON and object checks, git object ids, vendored
// ABOUTME: folders and how a size limit is named.
"use strict";

// A git object id, a commit's among them: 40 hex characters (SHA-1) or 64 (SHA-256).
const OBJECT_ID = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

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

module.exports = { OBJECT_ID, VENDORED_FOLDERS, baseName, compare, isObject, isVendored, parseJson, describeLimit };

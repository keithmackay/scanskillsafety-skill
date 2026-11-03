// ABOUTME: Decides which files in a skill/plugin/MCP repo get scanned — the ones Claude Code loads (SKILL.md, plugin manifests,
// ABOUTME: commands, agents, hooks, MCP config, root README/package.json) and the scripts it runs — and reads them locally.
"use strict";

const fs = require("fs");
const path = require("path");
const { selectScriptFiles, MAX_BYTES_PER_FILE } = require("../lib/scriptFiles");

const MAX_DEPTH = 5; // path segments, e.g. plugins/p/skills/x/SKILL.md
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 200;
const SKIP_DIRS = new Set(["node_modules", "test", "tests", "__tests__", "fixtures"]);

const ROOT_ONLY = new Set(["README.md", "package.json", "server.json"]);
const ANYWHERE = [
  /(^|\/)SKILL\.md$/,
  /(^|\/)plugin\.json$/,
  /(^|\/)\.claude-plugin\/marketplace\.json$/,
  /(^|\/)hooks\/hooks\.json$/,
  /(^|\/)\.mcp\.json$/,
  /(^|\/)(commands|agents)\/[^/]+\.md$/,
];

function isSkippedDir(name) {
  return SKIP_DIRS.has(name) || (name.startsWith(".") && name !== ".claude-plugin");
}

function isDiscoverable(relPath) {
  const segments = relPath.split("/");
  if (segments.length > MAX_DEPTH) return false;
  if (segments.slice(0, -1).some(isSkippedDir)) return false;
  if (segments.length === 1 && ROOT_ONLY.has(relPath)) return true;
  return ANYWHERE.some((re) => re.test(relPath));
}

function discoverLocal(root) {
  const found = [];
  const walk = (dir, rel, depth) => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      // Dirent types come from lstat, so symlinks are neither files nor dirs here and are
      // never followed out of the target tree.
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name)) walk(path.join(dir, entry.name), relPath, depth + 1);
      } else if (entry.isFile() && isDiscoverable(relPath)) {
        const full = path.join(dir, entry.name);
        if (fs.statSync(full).size <= MAX_FILE_BYTES && found.length < MAX_FILES) {
          found.push({ path: relPath, text: fs.readFileSync(full, "utf-8") });
        }
      }
    }
  };
  walk(root, "", 1);
  return found;
}

// Every file in the tree, for choosing scripts: dependencies and git internals are left out, and symlinks are not followed.
const TREE_SKIP_DIRS = new Set(["node_modules", ".git"]);
const MAX_TREE_ENTRIES = 100_000;

function listLocalTree(root) {
  const tree = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (tree.length >= MAX_TREE_ENTRIES) return;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!TREE_SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        tree.push({ path: relPath, size: fs.statSync(path.join(dir, entry.name)).size });
      }
    }
  };
  walk(root, "");
  return tree;
}

// The first MAX_BYTES_PER_FILE bytes of a file as text, or null for a binary file.
function readScriptText(full) {
  const fd = fs.openSync(full, "r");
  try {
    const buffer = Buffer.alloc(Math.min(fs.fstatSync(fd).size, MAX_BYTES_PER_FILE));
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, read);
    return bytes.includes(0) ? null : bytes.toString("utf-8");
  } finally {
    fs.closeSync(fd);
  }
}

// The scripts, hooks and MCP configs in the folders holding a SKILL.md or plugin manifest, chosen and capped as findsafeskills
// does; truncated when the caps left some out.
function discoverLocalScripts(root) {
  const { paths, truncated } = selectScriptFiles(listLocalTree(root));
  const files = [];
  for (const relPath of paths) {
    const text = readScriptText(path.join(root, relPath));
    if (text !== null) files.push({ path: relPath, text, script: true });
  }
  return { files, truncated };
}

module.exports = { isDiscoverable, discoverLocal, discoverLocalScripts, MAX_FILE_BYTES, MAX_FILES };

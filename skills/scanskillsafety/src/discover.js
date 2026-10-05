// ABOUTME: Decides which files in a skill/plugin/MCP repo get scanned — the ones Claude Code
// ABOUTME: actually loads or executes (SKILL.md, plugin manifests, commands, agents, hooks, MCP
// ABOUTME: config) plus the root README/package.json — and reads them from a local directory.
"use strict";

const fs = require("fs");
const path = require("path");

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

module.exports = { isDiscoverable, discoverLocal, MAX_FILE_BYTES, MAX_FILES };

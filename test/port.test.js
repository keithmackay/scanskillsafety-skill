"use strict";
// ABOUTME: The Codex/Gemini/Antigravity copy under skills/scanskillsafety/ must ship the same
// ABOUTME: scanner as the root Claude Code copy. Only SKILL.md and references/ differ by platform.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { PORT_DIR, SHARED, listFiles, filesEqual } = require("../scripts/sync-port");

test("skills/scanskillsafety/ has the same scanner files as the root (run `npm run sync:port`)", () => {
  const root = path.join(__dirname, "..");
  for (const entry of SHARED) {
    const rootFiles = listFiles(path.join(root, entry));
    const portFiles = listFiles(path.join(PORT_DIR, entry));
    assert.deepEqual(portFiles, rootFiles, `${entry}: file list differs`);
    for (const rel of rootFiles) {
      assert.ok(filesEqual(path.join(root, entry, rel), path.join(PORT_DIR, entry, rel)), `${path.join(entry, rel)} differs`);
    }
  }
});

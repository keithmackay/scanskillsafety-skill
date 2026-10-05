#!/usr/bin/env node
// ABOUTME: Copies the shared scanner files (CLI, src/, lib/, package.json, LICENSE, help.md) from
// ABOUTME: the root Claude Code copy into the Codex/Gemini/Antigravity copy at skills/scanskillsafety/.
// ABOUTME: SKILL.md and references/ are platform-specific and are never touched.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT_DIR = path.join(ROOT, "skills", "scanskillsafety");
const SHARED = ["cli.cjs", "src", "lib", "package.json", "LICENSE", "help.md"];

// Relative file paths under p (or [""] if p is a file), sorted.
function listFiles(p) {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [""];
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(p, "");
  return out.sort();
}

function filesEqual(a, b) {
  return fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
}

function sync() {
  for (const entry of SHARED) {
    const src = path.join(ROOT, entry);
    const dest = path.join(PORT_DIR, entry);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
  }
  console.log(`Synced ${SHARED.join(", ")} → ${path.relative(ROOT, PORT_DIR)}/`);
}

if (require.main === module) sync();

module.exports = { PORT_DIR, SHARED, listFiles, filesEqual };

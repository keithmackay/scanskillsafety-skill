#!/usr/bin/env node
// ABOUTME: CLI entry point for the scanskillsafety skill. Fully offline/local except for reading
// ABOUTME: the target repo's own files from its own host (GitHub's API/raw content, or a
// ABOUTME: Gitea/Forgejo API). Exit codes: 0 green, 1 yellow, 2 red, 3 could not scan.
"use strict";

const { scanTarget, formatText, exitCodeFor } = require("./src/scanTarget");

const USAGE = "Usage: scanskillsafety [--json] <local-path-or-repo-url>";

async function main(argv) {
  const json = argv.includes("--json");
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) {
    console.error(USAGE);
    return 3;
  }
  const result = await scanTarget(positional[0]);
  console.log(json ? JSON.stringify(result, null, 2) : formatText(result));
  return exitCodeFor(result);
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error(`scanskillsafety: unexpected error — ${err && err.stack ? err.stack : err}`);
    process.exitCode = 3;
  },
);

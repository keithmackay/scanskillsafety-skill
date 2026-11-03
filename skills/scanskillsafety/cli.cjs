#!/usr/bin/env node
// ABOUTME: CLI entry point for the scanskillsafety skill. Fully offline/local except for reading
// ABOUTME: the target repo's own files from its own host (GitHub's API/raw content, or a
// ABOUTME: Gitea/Forgejo API). Exit codes: 0 green, 1 yellow, 2 red, 3 could not scan.
"use strict";

const { scanTarget, formatText, exitCodeFor } = require("./src/scanTarget");

const { version } = require("./package.json");

const USAGE = "Usage: scanskillsafety [--json] <local-path-or-repo-url>";
const OPTIONS = ["--json", "--help", "-h", "--version", "-V"];

const HELP = `${USAGE}

Scans a skill, plugin, or MCP server's own files for prompt injection, exfiltration, hidden
text, leaked secrets, destructive commands and malicious code in bundled scripts, and rates it
red, yellow or green. Never runs the target's code; contacts only the target's own host.

Target:
  a local folder, or a repository URL on GitHub, Gitea or Forgejo

Options:
  --json         print the result as JSON instead of text
  -h, --help     print this help and exit
  -V, --version  print the version and exit

Examples:
  scanskillsafety https://github.com/someone/some-skill
  scanskillsafety ~/.claude/skills/some-skill
  scanskillsafety --json https://github.com/someone/some-plugin > result.json

Exit codes:
  0  green: no known pattern found
  1  yellow: warnings only
  2  red: at least one critical finding
  3  could not scan (bad arguments, bad target, nothing found, network error), not a clean result
`;

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(`scanskillsafety ${version}`);
    return 0;
  }
  const unknown = argv.find((a) => a.startsWith("-") && !OPTIONS.includes(a));
  if (unknown) {
    console.error(`scanskillsafety: unknown option ${unknown}\n${USAGE}`);
    return 3;
  }
  const json = argv.includes("--json");
  const positional = argv.filter((a) => !a.startsWith("-"));
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

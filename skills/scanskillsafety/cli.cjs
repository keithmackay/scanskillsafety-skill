#!/usr/bin/env node
// ABOUTME: CLI entry point for the scanskillsafety skill. Fully offline/local except for reading
// ABOUTME: the target repo's own files from its own host (GitHub's API/raw content, or a
// ABOUTME: Gitea/Forgejo API); --deep names any other service before contacting it.
// ABOUTME: Exit codes: 0 green, 1 yellow, 2 red, 3 could not scan, 4 Claude marked a file (--deep).
"use strict";

const { scanTarget, formatText, exitCodeFor } = require("./src/scanTarget");
const { parseCliArgs, DEFAULT_MODEL } = require("./src/deep/args");
const { runDeep } = require("./src/deep/runDeep");
const { formatDeep, formatServices } = require("./src/deep/formatDeep");

const { version } = require("./package.json");

const USAGE = "Usage: scanskillsafety [--json] [--deep [deep options]] <local-path-or-repo-url>";

const HELP = `${USAGE}

Scans a skill, plugin, or MCP server's own files for prompt injection, exfiltration, hidden
text, leaked secrets, destructive commands and malicious code in bundled scripts, and rates it
red, yellow or green. Never runs the target's code; contacts only the target's own host, and
with --deep the services it names before any request.

Target:
  a local folder, or a repository URL on GitHub, Gitea or Forgejo

Options:
  --json         print the result as JSON instead of text
  --deep         check the exact commit a person would install: every file, what runs at
                 install and start-up; names each service it will contact before any request
  -h, --help     print this help and exit
  -V, --version  print the version and exit

Deep options (only with --deep):
  --ref <ref>        the branch, tag or commit to check (default: the default branch)
  --no-site          do not ask findsafeskills.com about the repository
  --no-osv           do not ask api.osv.dev about the packages it uses
  --no-claude        do not have Claude read the files
  --claude-ok <id>   agree to Claude's reading of the plan with this id
  --budget <tokens>  stop Claude's reading at this many tokens
  --model <model>    the model Claude reads with (default: ${DEFAULT_MODEL})

Examples:
  scanskillsafety https://github.com/someone/some-skill
  scanskillsafety ~/.claude/skills/some-skill
  scanskillsafety --json https://github.com/someone/some-plugin > result.json
  scanskillsafety --deep --ref v1.2.0 https://github.com/someone/some-skill

Exit codes:
  0  green: no known pattern found
  1  yellow: warnings only
  2  red: at least one critical finding
  3  could not scan (bad arguments, bad target, nothing found, network error), not a clean result
  4  --deep: the rating is not red, but Claude marked a file suspicious or malicious
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
  const args = parseCliArgs(argv);
  if (!args.ok) {
    console.error(`scanskillsafety: ${args.error}\n${USAGE}`);
    return 3;
  }
  if (args.deep) {
    const onServices = args.json ? undefined : (services) => console.error(formatServices(services));
    const result = await runDeep(args.target, args.deep, { onServices });
    console.log(args.json ? JSON.stringify(result, null, 2) : formatDeep(result));
    return exitCodeFor(result);
  }
  const result = await scanTarget(args.target);
  console.log(args.json ? JSON.stringify(result, null, 2) : formatText(result));
  return exitCodeFor(result);
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error(`scanskillsafety: unexpected error — ${err && err.stack ? err.stack : err}`);
    process.exitCode = 3;
  },
);

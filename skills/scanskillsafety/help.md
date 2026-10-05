scanskillsafety — check a skill, plugin, or MCP server before you install it

WHAT IT DOES
  Reads the files an agent would load from the target (SKILL.md, plugin
  manifests, skills/*/SKILL.md, commands, agents, hooks/hooks.json,
  .mcp.json, package.json/server.json) and pattern-matches them for:
    - instruction-override / prompt-injection phrasing      (critical)
    - exfiltration-looking URLs                             (critical/warning)
    - obfuscation: base64 blobs, invisible chars, homoglyphs (warning)
    - hardcoded secrets, shown redacted                     (critical)
    - destructive shell command patterns                    (warning)
  Reports a red/yellow/green rating with the file, line, and quoted line
  for every hit. Never runs the target's code. Contacts only the target's
  own host (for GitHub: api.github.com and raw.githubusercontent.com).

  A green result means no known pattern was found, not that the target is
  safe. It does not catch runtime-only payloads, rug pulls, contextual
  attacks, novel phrasing, or anything outside the scanned files.

WHAT IT NEEDS
  - Node.js 18 or newer

USAGE
  Ask the agent, e.g.:
    "check https://github.com/someone/some-skill before I install it"
    "scan ./downloaded-plugin for prompt injection"

  Or run the scanner directly:
    node <install-dir>/cli.cjs <local-path-or-repo-url>
    node <install-dir>/cli.cjs --json <local-path-or-repo-url>

  Targets: a GitHub or Gitea/Forgejo repo URL, a link into a subdirectory
  (…/tree/<branch>/<path>) or to one file (…/blob/<branch>/<file>), a raw
  file URL, or a local folder or file.

FLAGS
  --help        Show this message and exit
  --version     Show installed version and check for updates
  --json        (CLI) Print the result as JSON

EXIT CODES (CLI)
  0  green: no known pattern found
  1  yellow: warnings only
  2  red: at least one critical finding
  3  could not scan (bad target, nothing found, network error), not a clean result

MORE
  https://github.com/keithmackay/scanskillsafety-skill

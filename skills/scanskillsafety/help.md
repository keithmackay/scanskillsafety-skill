scanskillsafety — check a skill, plugin, or MCP server before you install it

WHAT IT DOES
  Reads the files an agent would load from the target (SKILL.md, plugin
  manifests, skills/*/SKILL.md, commands, agents, hooks/hooks.json,
  .mcp.json, package.json/server.json) and the scripts its skills and
  plugins bundle, and pattern-matches them for:
    - instruction-override / prompt-injection phrasing      (critical)
    - exfiltration-looking URLs                             (critical/warning)
    - obfuscation: base64 blobs, invisible chars, homoglyphs,
      bidi overrides (warning); hidden Unicode Tag text      (critical)
    - hardcoded secrets, shown redacted; placeholders ignored (critical)
    - destructive shell commands, e.g. rm -rf ~             (warning)
      base64 decoded straight into a shell                  (critical)
    - install scripts piped from the network, e.g. curl | sh (note:
      listed for you to review, never changes the rating)
    - fake prerequisites: password-protected archives,
      paste-site links, download + chmod +x + run           (warning)
    - persistence (cron, launchd, systemd, startup, shell
      profile) that fetches from the network              (warning)
    - reverse shells                                        (critical)
    - instructions hidden from the user                     (warning)
    - known malware campaigns, e.g. ClawHavoc's fake
      "OpenClawCLI" prerequisite                            (critical)
  and, in bundled scripts only:
    - code that runs what it downloads                      (critical)
    - code that runs what it decodes from base64            (warning)
    - reverse shells in code                                (critical)
    - credentials or the whole environment sent out         (critical)
    - raw IP addresses and throwaway hosts                  (warning;
      critical beside chmod +x, a startup entry, or a relay)
    - cryptocurrency miners                                 (critical)
    - setuid and setgid                                     (warning)
    - ransom notes                                          (warning)
  Scripts are read up to 200 files, 200 KB each, 4,000 KB in all; a
  pattern only quoted as data in code is a note.
  Reports a red/yellow/green rating with the file, line, and quoted line
  for every hit, plus notes that don't affect the rating. Never runs the target's code. Contacts only the target's
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
  -h, --help    (CLI) Print the CLI's usage, options, examples and exit codes
  -V, --version (CLI) Print "scanskillsafety <version>" and exit

EXIT CODES (CLI)
  0  green: no known pattern found
  1  yellow: warnings only
  2  red: at least one critical finding
  3  could not scan (bad arguments, bad target, nothing found, network error), not a clean result

MORE
  https://github.com/keithmackay/scanskillsafety-skill

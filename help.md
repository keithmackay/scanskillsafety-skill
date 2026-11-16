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
    - setuid                                                (warning)
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
  - Node.js 18.3 or newer
  - for Claude's reading in --deep: the claude CLI (Claude Code)

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

DEEP SCAN
  Ask the agent for a deeper check, or run:
    node <install-dir>/cli.cjs --deep <local-folder-or-repo-url>

  Reads every file of the exact commit you would install (downloaded as
  one archive from the repository's own host), lists what runs at install
  and start-up, checks the packages it pulls in against OSV, compares the
  commit with what findsafeskills scanned, and, once you agree to its
  plan, has Claude read every file through your own claude CLI. Before
  any request it names each service it will contact and what each gets.
  Claude's findings are shown apart, are not checked by a person, and
  never change the rating; a file written to mislead a reviewer can pass.

  In a terminal it asks "Run Claude's reading? [y/N]". Run by an agent
  (no terminal, or --json) it prints the plan and its id and stops; the
  agent must ask you before rerunning with --claude-ok <plan id>.

  --ref <ref>        (CLI) the branch, tag or commit to check
                     (default: the default branch; repository URLs only)
  --no-site          (CLI) don't ask findsafeskills.com about the repository
  --no-osv           (CLI) don't ask api.osv.dev about the packages
  --no-claude        (CLI) don't have Claude read the files
  --claude-ok <id>   (CLI) agree to Claude's reading of the plan with this
                     id (it pins the commit, the exact files and the model)
  --budget <tokens>  (CLI) stop Claude's reading at this many tokens
  --model <model>    (CLI) the model Claude reads with (default: sonnet)

  Limits: 200 MB downloaded, 1 GB or 100,000 files unpacked (past them it
  exits 3, too large to check deeply); files over 5 MB are listed, not
  read. macOS and Linux are supported; Windows is best effort.

FLAGS
  --help        Show this message and exit
  --version     Show installed version and check for updates
  --json        (CLI) Print the result as JSON
  --deep        (CLI) Run the deep scan (see DEEP SCAN)
  -h, --help    (CLI) Print the CLI's usage, options, examples and exit codes
  -V, --version (CLI) Print "scanskillsafety <version>" and exit

EXIT CODES (CLI)
  0  green: no known pattern found
  1  yellow: warnings only
  2  red: at least one critical finding
  3  could not scan (bad arguments, bad target, nothing found, network error), not a clean result
  4  --deep: the rating is not red, but Claude marked a file suspicious or malicious

MORE
  https://github.com/keithmackay/scanskillsafety-skill

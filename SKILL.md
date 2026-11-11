---
name: scanskillsafety
description: Statically scans a Claude Code skill, plugin, or MCP server for known prompt-injection, exfiltration, obfuscation, secret, and destructive-command patterns before it's installed. Reads the target's own files (SKILL.md, plugin manifests, commands, agents, hooks, .mcp.json, and the scripts its skills and plugins bundle) from a GitHub/Gitea URL or a local path, fully offline apart from that host, and never runs the target's code. Use when the user is about to install a skill, plugin, or MCP server from an unfamiliar source, or asks to check, vet, audit, or scan one, or asks whether one is safe to install.
---

# scanskillsafety

## Flags

### `--help`

If the user invokes this skill with a `--help` flag (e.g. `/scanskillsafety --help`), don't run the scan. Instead, read `help.md` (in this skill's folder) and display it verbatim, then stop.

### `--version`

If the user invokes this skill with a `--version` flag (e.g. `/scanskillsafety --version`), don't run the scan. Instead:

1. Read the installed version from this skill's own manifest: `.claude-plugin/plugin.json` if present, else `.codex-plugin/plugin.json`, else `gemini-extension.json`, else `package.json` (this skill ships one at `${CLAUDE_SKILL_DIR}/package.json`). If none exist, read the topmost version heading in `CHANGELOG.md` instead.
2. Print: `scanskillsafety v<installed-version>`
3. Best-effort update check. Determine this skill's GitHub source repo:
   a. If `.git` exists here and `git remote get-url origin` resolves to a `github.com` URL, use that `owner/repo`.
   b. Otherwise, search this skill's own `README.md` for the first `https://github.com/<owner>/<repo>` URL and use that.
   c. If neither yields a repo, or the `gh` CLI isn't installed/authenticated, stop here. Print nothing further: no status line, no error.
4. If a repo was found, run `gh api repos/<owner>/<repo>/releases/latest -q .tag_name` (strip a leading `v`). Compare to the installed version:
   - Equal → append: `Status: up to date`
   - Installed is older → append: `Status: newer version available (v<latest>). To update: if you installed this via a Claude Code marketplace, run /plugin marketplace update <marketplace-name> then reinstall; otherwise, git pull in your install directory if it's a git checkout, or re-copy from https://github.com/<owner>/<repo> per this README's Installation section.`
   - Installed is newer → append: `Status: ahead of latest release (development checkout)`
   - If the API call fails for any reason (network, auth, rate limit, malformed tag), print nothing further: no status line, no error.
5. Stop. Don't run the scan.

## Run the scan

Run this with the user's target: a repo URL (including `…/tree/<branch>/<subdir>` links), a single-file URL, or a local path.

```bash
node "${CLAUDE_SKILL_DIR}/cli.cjs" --json <target>
```

If `${CLAUDE_SKILL_DIR}` didn't resolve to a real path, use `~/.claude/skills/scanskillsafety/cli.cjs`. If neither path exists, tell the user the scanner isn't installed where expected and stop. Don't fall back to reading the target yourself and calling it safe.

The JSON has `rating`, `scannedFiles`, `findings` (each with `file`, `line`, `excerpt`, `severity`, `category`, `detail`), `notices`, `errors`, and `nonGoals`. The exit code matches the rating.

## Report the result

Always name the files that were scanned and pass on any `notices` (for example, "GitHub API rate-limited; checked only well-known paths"). Then handle the exit code:

**0 (green).** Say the scan found no known patterns in the listed files. Then summarize, in one or two lines, what the scan does not cover (below). Don't call the target "safe", "clean", or "vetted": the scan only rules out a fixed list of patterns.

**1 (yellow).** List each finding as `file:line`, its detail, and the excerpt. Explain what each one means in plain terms (for example, a `curl … | bash` installer runs a remote script with your permissions). Suggest the user read those lines before installing.

**2 (red).** List every finding the same way. For each critical finding, say whether the excerpt reads like an instruction aimed at an agent or like documentation quoting the pattern, such as a security tool listing what it detects. Recommend not installing until the user has read the flagged lines. The decision is theirs, so give your assessment and leave it with them.

**Notes (`severity: "info"`).** Whatever the rating, list any notes separately after the findings (code that quotes a pattern as data, such as a guard's list of dangerous commands, shows up as a note), for example: "Note: the README pipes `install.sh` from its own repo into a shell (README.md:5). This scan didn't read that script, so read it before running it." Don't let a note change your verdict.

**3 (could not scan).** Say the scan did not run, quote the `errors`, and suggest a fix: check the URL, link the specific subdirectory, retry later if rate-limited, or clone the repo and scan the local path. Never present this as a clean result.

## What it checks

- **Instruction-override / prompt-injection phrasing**, including telling the agent to drop its earlier directives or safety guardrails or to output its system prompt (critical)
- **Requests for secrets**: telling the agent to read credential files or "all API keys" and send them out or hide it (critical)
- **Exfiltration-looking URLs** (critical for known relay domains and pentest callback catchers, and for images whose address carries data; warning for curl/wget to a raw IP, Discord or Telegram bots with their token written in, and DNS lookups of names built from data)
- **Obfuscation**: base64-looking blobs, invisible characters, homoglyphs, bidi overrides (warning); text hidden in Unicode Tag characters (critical, and the hidden text is shown in the finding)
- **Hardcoded secrets**: shown redacted, placeholders ignored (critical)
- **Destructive shell command patterns** (warning; critical when base64 is decoded straight into a shell)
- **Install scripts run straight from the network**: `curl | sh` and similar, running the target's own script, which this scan doesn't read. Reported with severity `info`, a note that never changes the rating
- **Fake prerequisites and suspicious downloads**: password-protected archives, paste-site links, download + chmod +x + run (warning)
- **Persistence that fetches from the network**: cron, launchd, systemd, startup entries or shell-profile lines that fetch code to run (warning)
- **Reverse shells** (critical)
- **Instructions hidden from the user**: "do not tell the user", `<IMPORTANT>`-style blocks, orders to the agent in an HTML comment (warning)
- **Code in code blocks**: the code-only checks below also run on each fenced code block of a SKILL.md or README (critical; a note when only quoted as data, below critical in a block introduced as an example)
- **Known malware campaigns**: names, hosts, addresses and accounts only a published campaign uses, such as ClawHavoc's fake "OpenClawCLI" prerequisite (critical; a note in security write-ups that list them)

It also reads the scripts, hooks and MCP configs in the folders holding a SKILL.md or plugin manifest (up to 200 files, 200 KB of each, 4,000 KB in all; dependencies skipped, and tests and evals too unless a file outside them runs them). Every check above runs on them, and a match quoted only as data in code (a guard's block list, a detection rule) is a note. These checks are made only on code:

- **Code that runs what it downloads** (critical)
- **Code that runs what it decodes**: eval of base64 or hex, exec of a decoded or decrypted name, PowerShell -EncodedCommand, obfuscator output (warning)
- **Reverse shells in code** (critical)
- **Credentials or the whole environment sent out** (critical; the whole environment copied in a file that sends data is a warning)
- **The machine's identity sent out** (warning)
- **Coding agents with permission prompts off**, beside credentials or wallets (critical; otherwise a note)
- **Links to a Windows program**: `.exe`, `.msi`, `.scr` and similar, outside GitHub releases (warning)
- **Raw IP addresses and throwaway hosts**: paste sites, request relays, Discord attachments, tunnels (warning; critical beside a chmod +x, a startup entry or a send to a relay)
- **Cryptocurrency miners** (critical)
- **setuid** (warning)
- **Programs set to start on their own**: shell start-up files, the Windows Startup folder, global git hooks, Python `.pth` files (warning)
- **Ransomware**: ransom notes, and files encrypted across folders with the originals removed (warning)

## What it does NOT check

Pass these limits on whenever the result could be read as reassurance:

- **Anything that requires actually running the code.** Runtime-only payloads are invisible to it.
- **Rug pulls (a tool's description changing after you already approved it).** It sees one snapshot.
- **Contextual or workflow-dependent attacks**, such as text that is dangerous only combined with other tools' output.
- **Novel phrasing not covered by the pattern list.**
- **Anything outside the scanned text itself**: the publisher's identity, an MCP server's own source, files past the limits above, and linked pages (links aren't followed).

---
name: scanskillsafety
description: Statically scans a Claude Code skill, plugin, or MCP server for known prompt-injection, exfiltration, obfuscation, secret, and destructive-command patterns before it's installed. Reads the target's own files (SKILL.md, plugin manifests, commands, agents, hooks, .mcp.json) from a GitHub/Gitea URL or a local path, fully offline apart from that host, and never runs the target's code. Use when the user is about to install a skill, plugin, or MCP server from an unfamiliar source, or asks to check, vet, audit, or scan one, or asks whether one is safe to install.
---

# scanskillsafety

## Flags

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

**3 (could not scan).** Say the scan did not run, quote the `errors`, and suggest a fix: check the URL, link the specific subdirectory, retry later if rate-limited, or clone the repo and scan the local path. Never present this as a clean result.

## What it checks

- **Instruction-override / prompt-injection phrasing** (critical)
- **Exfiltration-looking URLs** (critical for known relay domains; warning for curl/wget to a raw IP)
- **Obfuscation**: base64-looking blobs, invisible characters, homoglyphs (warning)
- **Hardcoded secrets**: shown redacted (critical)
- **Destructive shell command patterns** (warning, because legitimate installers use some of them)

## What it does NOT check

Pass these limits on whenever the result could be read as reassurance:

- **Anything that requires actually running the code.** Runtime-only payloads are invisible to it.
- **Rug pulls (a tool's description changing after you already approved it).** It sees one snapshot.
- **Contextual or workflow-dependent attacks**, such as text that is dangerous only combined with other tools' output.
- **Novel phrasing not covered by the pattern list.**
- **Anything outside the scanned text itself**: the publisher's identity, source code beyond the scanned files, and linked pages (links aren't followed).

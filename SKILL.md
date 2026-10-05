---
name: scanskillsafety
description: Statically scans a Claude Code skill, plugin, or MCP server for known prompt-injection, exfiltration, obfuscation, secret, and destructive-command patterns before it's installed. Reads the target's own files (SKILL.md, plugin manifests, commands, agents, hooks, .mcp.json) from a GitHub/Gitea URL or a local path, fully offline apart from that host, and never runs the target's code. Use when the user is about to install a skill, plugin, or MCP server from an unfamiliar source, or asks to check, vet, audit, or scan one, or asks whether one is safe to install.
---

# scanskillsafety

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

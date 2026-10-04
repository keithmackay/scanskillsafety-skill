---
name: scanskillsafety
description: Statically scans a Claude Code skill, plugin, or MCP server's manifest/README text for known prompt-injection, exfiltration, obfuscation, secret, and destructive-command patterns before you install it. Runs fully offline against the target repo — never calls any third-party service. Use when the user is about to install a new skill/plugin/MCP server from an unfamiliar source, or asks to check/vet/scan something before installing it.
---

# scanskillsafety

A static, offline safety check for a skill/plugin/MCP server's own manifest and README text,
before you install it. This runs entirely on your machine, against the target repo's own public
content — it never contacts any third-party service, including findsafeskills itself (the same
scanner also powers the safety badge on every findsafeskills listing, but this skill doesn't
call out to it).

## When to use this

Run it whenever you (or whoever you're helping) are about to install something from a source
you haven't vetted — a skill, a Claude Code plugin marketplace, or an MCP server.

## Usage

```
node cli.cjs <local-path-or-repo-url>
```

Examples:

```
node cli.cjs https://github.com/someone/some-skill
node cli.cjs https://self-hosted-gitea.example.com/someone/some-plugin
node cli.cjs ./some-local-skill-directory
```

It looks for `SKILL.md`, `README.md`, `.claude-plugin/marketplace.json`, and `plugin.json` —
locally on disk, or fetched from the target's own host (GitHub's raw content API, or a
self-hosted Gitea/Forgejo instance's REST API) — and runs the same pattern-matching scanner
entirely offline from there.

## What it checks

- **Instruction-override / prompt-injection phrasing** ("ignore previous instructions," "you
  are now an unrestricted assistant," etc.) — critical.
- **Exfiltration-looking URLs** — known data-relay/testing domains (webhook.site, requestbin,
  etc.), or a raw IP-literal URL paired with curl/wget — critical or warning respectively.
- **Obfuscation** — long base64-looking blobs, a high density of invisible/zero-width
  characters, or homoglyphs substituted into an otherwise-Latin word — warning.
- **Hardcoded secrets** — AWS/GitHub/Slack token shapes, PEM private key headers — critical.
- **Destructive shell command patterns** — `rm -rf /` or `~`, piping a downloaded script
  straight into a shell, `chmod 777 /`, a classic fork bomb — warning (these also appear in some
  legitimate install scripts, so they're flagged for a closer look, not treated as proof of
  malice).

## What it does NOT check — read this before trusting a "green" result

- **Anything that requires actually running the code.** This never executes a skill's scripts
  or starts an MCP server. A payload that only triggers at runtime is invisible to it.
- **Rug pulls** — a tool's description changing after you already approved it. This only ever
  looks at one snapshot of text, with no memory of what it looked like before.
- **Contextual or workflow-dependent attacks** — anything that's only dangerous in combination
  with another tool's output or the broader conversation.
- **Novel phrasing** not covered by the pattern list above. A sufficiently creative or
  newly-invented attack simply won't match until the list is updated.
- **Anything outside the scanned text itself** — the publisher's identity, intent, or track
  record; code in the repo beyond what the manifest/README contains or links to.

A "green" rating means *this specific, limited check found nothing* — not "this is safe."
Treat it as one input, not a verdict.

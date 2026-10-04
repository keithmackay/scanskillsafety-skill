# scanskillsafety

A static, fully offline safety scanner for AI agent skills, plugins, and MCP servers — run it
against a repo before you install it. Checks a target's manifest/README text for known
prompt-injection phrasing, exfiltration-looking URLs, obfuscation (base64 blobs, invisible/
homoglyph characters), hardcoded secrets, and destructive shell command patterns.

Makes zero network calls to any third party except the target repo's own host (to fetch its
public manifest/README text). Never executes any code.

This is the same scanner that powers the safety badge on every
[findsafeskills](https://skillfinder-neon.vercel.app) listing — this skill runs it locally and
independently, with no dependency on or calls back to findsafeskills itself.

## Usage

```
node cli.cjs <local-path-or-repo-url>
```

See `SKILL.md` for the full instructions Claude Code reads, including exactly what this does
and does not check — read that before trusting a "green" result.

## Regenerating `lib/`

`lib/` is compiled from the scanner source in the main findsafeskills repo
(`src/lib/safety/**`) via that repo's `npm run build:safety-skill`, which writes directly into
this directory (a sibling project, `../scanskillsafety-skill/lib`). Changes to the scanner logic
happen there, not here — this repo just distributes the compiled, dependency-free result plus
the CLI wrapper and `SKILL.md`.

## Status

Private. Distributed only via findsafeskills.com as a teaser — not independently publicized.

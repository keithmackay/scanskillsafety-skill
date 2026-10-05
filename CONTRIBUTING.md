# Contributing to scanskillsafety

Thanks for helping make skill installs safer. Bug reports, false-positive reports, new attack patterns, and pull requests are all welcome.

## Reporting a false positive or a missed attack

Open an issue with:

- the target you scanned (URL or a minimal copy of the text)
- the output, preferably `--json`
- what you expected: no finding, a different severity, or a finding that didn't appear

For a missed attack, include the smallest text that should have matched. Don't paste live secrets. Use a fake token in the same format.

## Reporting a bug

Include your Node.js version (`node --version`), the exact command, the full output, and the exit code.

## Suggesting a feature

Open an issue describing the problem first (for example, "it doesn't read X, which agents load from Y") before proposing a solution.

## Development setup

Requires Node.js 18 or newer. There are no dependencies to install.

```bash
git clone https://github.com/keithmackay/scanskillsafety-skill
cd scanskillsafety-skill
npm test
```

Tests use Node's built-in test runner. They build fixtures in a temp directory, so the repo's own scan never picks up malicious-looking test text. Keep new fixtures there too.

## Where changes go

| Change | Where |
|---|---|
| Detection logic (patterns, normalization, severities) | `src/lib/safety/**` in the findsafeskills repo, with vitest tests there. Commit it there, then run `npm run build:lib` here. Don't edit `lib/` by hand. |
| CLI, file discovery, fetching, output | `cli.cjs` and `src/` here |
| Agent instructions | `SKILL.md` (Claude Code) and `skills/scanskillsafety/SKILL.md` (Codex/Gemini/Antigravity). Keep them in step. |
| Anything in `cli.cjs`, `src/`, `lib/`, `package.json`, `LICENSE`, `help.md` | Run `npm run sync:port` afterwards to copy it into `skills/scanskillsafety/`. A test fails if the copies differ. |

`npm test` also fails if `README.md` or either `SKILL.md` stops naming a check or limitation the scanner defines, or (when `../findsafeskills` exists) if `lib/` is stale.

## Pull requests

`main` is protected and needs a reviewed pull request.

1. Fork the repo and create a branch (`fix/rm-rf-false-positive`, `feat/scan-mcp-manifest`).
2. Write a failing test first, then the change.
3. Run `npm test` and `npm run sync:port`.
4. Add a line under `## [Unreleased]` in `CHANGELOG.md`.
5. Open the PR with a short description of what changed and why. For detection changes, link the findsafeskills PR.

## Code style

Plain CommonJS, no dependencies, 2-space indentation, and an `ABOUTME:` header comment on each new file. Match the surrounding code.

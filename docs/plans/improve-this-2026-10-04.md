# scanskillsafety-skill — implementation plan (from improve-this review, 2026-10-04)

Source: `docs/reviews/2026-10-04-improve-this.md`. All 17 findings are in scope. Finding numbers (#N) refer to that report.

## Ground rules

- **Two repos.** Scanner logic (`lib/`) is compiled from `~/Projects/findsafeskills/src/lib/safety/**`. Findings tagged [upstream] (#4, #14, #15, and the location/all-matches half of #7) are fixed **there**, test-first with vitest (`npm test` in findsafeskills), then compiled into this repo with `npm run build:safety-skill`. Never hand-edit `lib/`.
- **CLI and docs** (`cli.cjs`, `SKILL.md`, `README.md`) are fixed **here**, test-first with Node's built-in `node:test`. The repo stays dependency-free at runtime.
- **Scanner changes move findsafeskills.com badges.** After Phase 2 ships, the site's existing listings need a rescan (Phase 2.6).
- **TDD per task:** write the failing test, watch it fail, make the smallest change that passes it, then commit. Commit after each task with its finding number in the message. Push `main` at the end of each phase (per CLAUDE.md).

## Phase 0 — Scaffolding (prerequisite for everything else)

0.1 **Test harness here (#10).** Add a minimal `package.json`: `"type": "commonjs"`, `"engines": {"node": ">=18"}`, no dependencies, and `"test": "node --test test/"`. Create `test/fixtures/` holding small plugin, skill, and monorepo directory trees.

0.2 **Make cli.cjs testable (#10).** Refactor into `lib-cli/` modules, or export functions from `cli.cjs` behind `if (require.main === module) main()`, so `parseTarget`, file discovery, and fetching can be unit-tested. Fetching takes an injectable `fetch` so tests never hit the network.

0.3 **LICENSE (#13).** Add a LICENSE file. **Decision needed from Keith:** MIT, the default in his `git-release` skill, unless he says otherwise.

## Phase 1 — CLI correctness (this repo)

1.1 **Target parsing (#3, #9).** Replace `parseOwnerRepo` with `parseTarget(input)`. It returns one of:
- `{kind: "local-dir"}`
- `{kind: "local-file"}`
- `{kind: "github", owner, repo, ref?, subpath?}`
- `{kind: "git-host", origin, owner, repo, ref?, subpath?}`
- `{kind: "raw-url"}`

Handle `github.com/o/r`, `…/r.git`, `…/tree/<ref>/<subpath>`, and `…/blob/<ref>/<file>`. Gitea/Forgejo use `…/src/branch/<ref>/<subpath>`. Tests cover each URL shape, including `anthropics/skills/tree/main/skills/pdf`.

1.2 **Default branch resolution (#3).** For GitHub without an explicit ref, read `default_branch` from `https://api.github.com/repos/{o}/{r}`. Fall back to main/master only if that call is rate-limited or fails, and say so in the output. Update the README/SKILL.md network-call wording to include `api.github.com` (#17).

1.3 **File discovery (#2).** Replace the 4-name root list with a layout-aware discovery list:
- `SKILL.md` and `README.md`
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
- `plugin.json`
- `skills/*/SKILL.md`, `commands/*.md`, `agents/*.md`
- `hooks/hooks.json` and `.mcp.json`
- for MCP servers, `package.json` (its `scripts`, `bin`, and `description` fields) and `server.json`

These paths are relative to the subpath when there is one. Local targets use a bounded directory walk (cap on file count and size). GitHub targets use one `git/trees/{ref}?recursive=1` call, filtered to the same patterns, then raw fetches. Gitea uses its contents API. A `local-file` target scans just that file (fixes #9's misleading error). Add a fixture test using the plugin layout from the report (#2 repro): it must come back RED and name `skills/x/SKILL.md`.

1.4 **Per-file scanning (#7, CLI half).** Call `scanText` once per file and attach `file` to each finding instead of joining the texts. Print findings grouped by file. Line numbers arrive in Phase 2.2.

1.5 **Exit codes and `--json` (#8).** Exit codes: `0` green, `1` yellow, `2` red, `3` couldn't scan (usage error, nothing found, network failure). `--json` prints `{target, rating, files: [...], findings: [...], disclaimer, nonGoals}`. Test each code.

1.6 **Robust fetching (#9).** Give every fetch an `AbortSignal.timeout(10_000)`. Distinguish 404 from network errors, timeouts, and rate limits (HTTP 403/429 from GitHub), and report which happened. Wrap `main()` in a `.catch` that prints the error and exits 3. Fetch independent files in parallel with a small concurrency cap.

1.7 **Disclaimer from the single source (#11, CLI half).** Build the printed disclaimer from `lib/nonGoals.js` (and `lib/checks.js` once Phase 2.5 ships it) instead of the hard-coded `DISCLAIMER`.

## Phase 2 — Scanner fixes (upstream: findsafeskills/src/lib/safety)

2.1 **Line-scoped matching (#4).** Keep newlines in `normalizeForScan`: collapse only horizontal whitespace, so the scanner still catches hard-wrapped phrases (role-override phrases may span a line break, so run role-override against a whitespace-flattened copy). Run the line-oriented patterns (curl|sh, IP-literal fetch, chmod, rm) one line at a time, and fix the chmod `$` anchor to mean end of line or end of command. Regression tests, each taken from the report's reproductions:
- a Markdown table after a curl line → no finding
- a curl line and an IP-literal URL on separate lines → no finding
- `chmod 777 /` mid-document → finding

2.2 **Locations and all matches (#7, #5).** Each pattern module returns every match, not just the first (deduped, capped at about 20 per category). Each finding gets `line` and a short `excerpt` with about 80 characters of context. These are optional fields on `Finding`, so the DB `safety_findings` JSON stays backward-compatible. Update the site's rendering only if it shows the extra fields; otherwise leave it.

2.3 **Secret formats (#14).** Add patterns for `github_pat_`, `gh[opsu]_`, `sk-ant-`, `sk-` / `sk-proj-` (OpenAI), and `AIza` (Google), with negative tests for near-miss prose. Make sure secrets are matched before the base64 heuristic so a `github_pat_` token isn't miscategorized as obfuscation.

2.4 **`rm -rf ~` precision (#15).** Match `~`, `~/`, `~/*`, `$HOME`, and `$HOME/` as whole targets, but not `~/.cache/x`. Tests cover both sides.

2.5 **Ship `checks.js` (#11).** `SAFETY_SCANNER_CHECKS` already exists upstream. Make sure the build emits it into `lib/`, and fix the "or links to" wording in `nonGoals.ts` (#17).

2.6 **Rebuild, verify, rescan.**
1. Run `npm test` upstream, then `npm run build:safety-skill`, which writes `lib/` here.
2. Run this repo's tests.
3. Rescan the site's listings with `npm run backfill:safety-scan`. **Check first** that the script rescans already-scanned listings (its name suggests it only picks up unscanned ones). If it doesn't, add a `--all` flag (test-first) before running it.
4. Compare the before/after counts of red, yellow, and green listings, and write them into the commit message.

## Phase 3 — Drift prevention (#11, #17)

3.1 **lib sync check.** Add `scripts/check-lib-sync.sh` here. It builds upstream to a temp dir with `--outDir` and diffs against `lib/`. Run it from `npm test` when `../findsafeskills` exists, and skip it with a notice otherwise. Remove the stale cross-repo path from the `scanText.ts` header comment upstream (#17).

3.2 **Docs-match-code test.** Add a `node:test` that asserts every `SAFETY_SCANNER_CHECKS[].title` and every `SAFETY_SCANNER_NON_GOALS[].title` appears (normalized) in `SKILL.md` and `README.md`. That way a new check or non-goal can't ship undocumented.

## Phase 4 — Docs (#1, #5, #6, #12, #13, #16, #17)

4.1 **README via `make-readme` (#12, #13, #16).** Use the `make-readme` skill to regenerate `README.md`. Inputs to give it:
- what this is and who it's for (first screen)
- Node ≥ 18 as a prerequisite
- install as a Claude Code skill: `git clone https://github.com/keithmackay/scanskillsafety-skill ~/.claude/skills/scanskillsafety`
- quick start
- real example output for green, yellow, and red (captured from fixtures)
- exit codes and `--json`
- what it checks and what it doesn't (the human-facing version moves here from SKILL.md)
- the link fixed to findsafeskills.com
- the license
- "Regenerating lib/" under a clearly labeled maintainer section; drop the `## Status` section

4.2 **SKILL.md via `plsfix` (#1, #5, #6, #16).** Use the `plsfix` skill on `SKILL.md`, with these requirements:
- **Invocation:** run `node "${CLAUDE_SKILL_DIR}/cli.cjs" --json <target>`, with a fallback of `~/.claude/skills/scanskillsafety/cli.cjs` if that variable is unset. Verify during implementation that `${CLAUDE_SKILL_DIR}` is substituted in SKILL.md bodies on the current Claude Code, using the `working-with-claude-code` docs.
- **Output contract by exit code:**
  - GREEN: report "no known patterns found" plus the limits, and never call the target "safe".
  - YELLOW: show each finding's file, line, and excerpt.
  - RED: show the findings and recommend not installing until the user has reviewed them. Explicitly assess whether a hit is quoted or explanatory text (as in #5) and say so, but leave the decision to the user.
  - Couldn't scan (exit 3): say the scan did not run. Never imply it's clean.
- **Keep:** the "What it does NOT check" list.
- **Remove:** the intro that duplicates the frontmatter, and the human-oriented example list.

4.3 **Self-scan note (#5).** Document in README and SKILL.md that this repo rates itself RED because its docs quote the patterns it detects, as a worked example of reading excerpts. Add a test asserting the self-scan output names `SKILL.md` and a line number for each hit.

## Phase 5 — End-to-end verification and release

5.1 Run `npm test` in both repos.
5.2 Manual runs:
- `node cli.cjs https://github.com/anthropics/skills/tree/main/skills/pdf` resolves the right repo and subpath
- a repo with a non-main default branch
- this repo (expect RED with file:line excerpts)
- a local plugin fixture
- a single-file target
- an unreachable host (fails in about 10 s with exit 3)

5.3 Invoke the skill from a different working directory in a fresh Claude Code session to confirm #1 is fixed.
5.4 Commit and push both repos. Update the findsafeskills `/safety` page copy if Phase 3.2's lists changed.

## Finding → task map

| # | Task(s) | # | Task(s) |
|---|---|---|---|
| 1 | 4.2, 5.3 | 10 | 0.1, 0.2 (+ tests in every task) |
| 2 | 1.3 | 11 | 1.7, 2.5, 3.1, 3.2 |
| 3 | 1.1, 1.2 | 12 | 4.1 |
| 4 | 2.1 | 13 | 0.3, 4.1 |
| 5 | 2.2, 4.2, 4.3 | 14 | 2.3 |
| 6 | 4.2 | 15 | 2.4 |
| 7 | 1.4, 2.2 | 16 | 4.1, 4.2 |
| 8 | 1.5 | 17 | 1.2, 2.5, 3.1 |
| 9 | 1.1, 1.3, 1.6 | | |

## Decisions (Keith, 2026-10-04)

1. License: **MIT**.
2. Exit codes: **0 green / 1 yellow / 2 red / 3 could-not-scan**.
3. Rescanning live badges is fine (site not launched yet). **Requirement:** the scan must return the full list of problems it found (category, severity, detail, and now file/line/excerpt) so the site can show that list when a yellow or red badge is clicked. Upstream `cb6b4b0` already renders type, severity and source on the badge. Phase 2.2 adds the new optional fields, and the site should show line/excerpt when they're present.

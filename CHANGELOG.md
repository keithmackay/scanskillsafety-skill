# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- New checks, built upstream in findsafeskills (scanner version `2026-10-05.2`):
  - **Fake prerequisites and suspicious downloads**: password-protected archives, paste-site links, download + `chmod +x` + run (warning).
  - **Reverse shells** (critical).
  - **Instructions hidden from the user**: "do not tell the user" phrasing, `<IMPORTANT>`/`<system>` blocks (warning).
  - Shell runners: `| sudo bash`, `bash <(curl …)`, PowerShell `iex` (warning); base64 decoded straight into a shell (critical).
  - Unicode Tag characters are decoded and scanned by every rule; 10 or more is critical. Bidi override characters are a warning.
- `npm run build:lib` rebuilds `lib/` from the scanner committed at findsafeskills `HEAD`, not its working tree.

- `--help` flag and `help.md` for the skill, on every platform copy.
- `npm run sync:port` and a test that keep the Codex/Gemini/Antigravity copy under `skills/scanskillsafety/` identical to the root scanner.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `.gitignore`.

### Changed

- Scanner version `2026-10-05.3`, tuned on 2,048 real manifests and READMEs (8 false reds → 0, yellows 5.7% → 3.6%):
  - Instruction-override phrasing that is quoted, in code, in a table, or named as an example is a warning instead of critical.
  - "Developer Mode enabled" only counts in an instruction form ("you are now in developer mode").
  - Official installers for well-known toolchains (uv, Docker, nvm, Bun, Rust, …) are no longer flagged.
- Scanner version `2026-10-05.4`: download-and-run installers (`curl | sh`, `| sudo bash`, `bash <(curl …)`, `iex`) are reported under their own **Install scripts run straight from the network** check (`install-script`) instead of destructive commands. Still a warning.

### Fixed

- Paste sites named in plain text, `password` parameters in API docs, `<secret>` placeholders, wallet addresses and hashes, emoji joiners, and "do not tell the user they are rate-limited" no longer produce findings.
- Documentation placeholder tokens (`ghp_XXXX…`, `xoxp-your-user-token`, `AKIA…EXAMPLE`) are no longer reported as hardcoded secrets.
- Base64 blobs inside any `scheme://` URL (such as `cursor://` deeplinks) are no longer reported as obfuscation.
- README: the Antigravity install and the Compatibility table claimed the root `SKILL.md` works there as-is. It needs `${CLAUDE_SKILL_DIR}`, which Antigravity doesn't set, so Antigravity now installs the `skills/scanskillsafety/` copy.

## [1.0.0] - 2026-10-05

### Added

- Reads the files an agent actually loads: `.claude-plugin/plugin.json`, `skills/*/SKILL.md`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, MCP `package.json`/`server.json`.
- GitHub `…/tree/<ref>/<path>` and `…/blob/<ref>/<file>` URLs, Gitea/Forgejo `…/src/branch/…` URLs, and single local files.
- Default branch resolved through the host's API instead of guessing `main`/`master`.
- Every finding reports its file, line, and the quoted line, with secret-shaped tokens redacted. Each check reports all matches instead of only the first.
- Exit codes 0/1/2/3 (green/yellow/red/could not scan) and `--json` output.
- Detection of GitHub fine-grained/OAuth/app tokens and Anthropic, OpenAI, and Google API keys.
- `--version` flag. Ports to Codex, Gemini CLI, and Antigravity.
- Test suite (`npm test`), including checks that `lib/` matches the upstream scanner build and that the docs name every check and limitation.
- MIT license.

### Changed

- Shell-command, IP-literal, relay-domain, and secret checks run line by line.
- `rm -rf ~` flags only the whole home directory, not subdirectories such as `~/.cache/x`.
- Fetching `127.x` addresses with curl is no longer an exfiltration warning.
- `SKILL.md` runs the CLI from the skill's own directory and tells the agent how to report each rating.

### Fixed

- The skill failed when run from the user's project directory (relative `cli.cjs` path).
- A GitHub link into a monorepo subdirectory scanned the wrong repo.
- A curl command and an unrelated later line (a Markdown table row, an IP address) combined into a false finding. The `chmod 777 /` check only fired at the very end of a document.
- Kebab-case names starting with `sk-` were reported as OpenAI keys. Prose naming `curl | sh` was reported as a pipe-to-shell command. IDs inside URLs were reported as base64 blobs.
- Fetches had no timeout, and network failures looked the same as "nothing found".
- The exit code was always 0.

# Platform Limitations

The following features from the original (Claude Code) skill are not supported on this platform:

| Feature | Reason |
|---------|--------|
| `${CLAUDE_SKILL_DIR}` environment variable | Claude Code-specific; not set on Codex or Gemini CLI. On this platform, resolve the scanner's path directly: use the path to this `skills/scanskillsafety/` directory (the one this file lives in) and run `node <that-path>/cli.cjs --json <target>`. If you don't know that path at runtime, check your platform's documented skill-install locations (e.g. a project-local `.agents/skills/scanskillsafety/` or a user-level extension directory) for `cli.cjs`. |
| `.claude-plugin/plugin.json` as a version source (`--version` step 1) | Claude Code-specific manifest path; not present on Codex or Gemini CLI installs. Use `.codex-plugin/plugin.json` or `gemini-extension.json` instead (already reflected in this platform's `SKILL.md`). |

This skill never executes the scanned target's code on any platform — that invariant is unaffected by the above.

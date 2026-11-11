# scanskillsafety

Statically scans a skill, plugin, or MCP server for known prompt-injection, exfiltration, obfuscation, secret, and destructive-command patterns before it's installed. It reads the target's own files (SKILL.md, plugin manifests, commands, agents, hooks, .mcp.json, and the scripts its skills and plugins bundle) from a GitHub/Gitea URL or a local path, fully offline apart from that host, and never runs the target's code. It triggers when you're about to install a skill, plugin, or MCP server from an unfamiliar source, or ask to check, vet, audit, or scan one. This folder is the copy for Codex, Gemini CLI and Antigravity; see `help.md` for usage.

```
Version 1.2.0 · MIT license
Source:  https://github.com/keithmackay/scanskillsafety-skill
Author:  Keith MacKay <technofacto@gmail.com>
Update:  re-copy this folder from a fresh clone of the source repo (or: gemini extensions update scanskillsafety)
Issues:  https://github.com/keithmackay/scanskillsafety-skill/issues
```

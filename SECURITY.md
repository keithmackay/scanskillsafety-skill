# Security policy

## Supported versions

Only the latest release gets fixes. Update with `git pull` in your install folder, `gemini extensions update scanskillsafety`, or a reinstall from the mackayi marketplace.

## Reporting a vulnerability

Report it privately through GitHub: [Report a vulnerability](https://github.com/keithmackay/scanskillsafety-skill/security/advisories/new) on the repository's Security tab. If you'd rather not use GitHub, email Keith MacKay at technofacto@gmail.com with "scanskillsafety security" in the subject. Please don't open a public issue for a vulnerability. Include the version (`node cli.cjs --version`), the target or input that shows the problem, and what happened. A confirmed fix ships in a new release.

## What counts

A vulnerability is a way the scanner itself can harm the person running it, for example:

- running, importing or evaluating any part of the target's code;
- reading or writing files outside the target folder, or following a link out of it;
- contacting any host other than the target's own;
- input that crashes or hangs the scanner, or makes it print secrets unredacted.

A malicious skill, plugin or MCP server that the scan rates green (a missed detection), or a harmless one it rates red, is not a vulnerability. The scanner is pattern matching and its limits are listed in the README. Please report those as a [regular issue](https://github.com/keithmackay/scanskillsafety-skill/issues) with the text that should (or shouldn't) have matched. If the sample is live malware, describe it and send it by email instead of pasting it.

Scanner rules are written in [findsafeskills](https://findsafeskills.com) and built into `lib/`, so a fix to a rule lands there first.

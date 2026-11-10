"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFETY_SCRIPT_CHECKS = exports.SAFETY_SCANNER_CHECKS = exports.SAFETY_SCANNER_NOTES = exports.SAFETY_ADVISORY_SIGNALS = exports.SAFETY_GITHUB_SIGNALS = void 0;
// Findings that do not come from the text scanner. The standalone scanner skill never produces
// these; they are recorded by the site's nightly GitHub check.
exports.SAFETY_GITHUB_SIGNALS = [
    {
        title: "Repository blocked by GitHub",
        severity: "critical",
        explanation: "GitHub has disabled access to the repository for a terms of service violation. We pick this " +
            "up in a nightly check of GitHub-hosted listings, so it can lag by a day or more, and a " +
            "listing stays visible, rated red, rather than being removed. If GitHub later restores " +
            "access, the finding is removed on the next check.",
    },
];
// Findings from advisories published in OSV (osv.dev) for the npm package a listing names. They
// concern that package only, not the listing's repository or its text.
exports.SAFETY_ADVISORY_SIGNALS = [
    {
        title: "Published package reported as malicious",
        severity: "critical",
        explanation: "The OpenSSF malicious-packages feed, published through OSV, lists the npm package the " +
            "listing names as malicious. We look up the latest published version of the package. This " +
            "says nothing about older versions or about the listing's own code, and a package with no " +
            "advisory is not thereby safe: absence means no advisory is known.",
    },
    {
        title: "Known vulnerability in the published package",
        severity: "warning",
        explanation: "OSV lists one or more security advisories (CVEs, GitHub advisories) for the latest " +
            "published version of the npm package the listing names. A vulnerability is a bug, not " +
            "malice, and says nothing about older versions or the listing's own code. A package with no " +
            "advisory is not thereby safe: absence means no advisory is known.",
    },
];
exports.SAFETY_SCANNER_NOTES = [
    {
        title: "Install scripts run straight from the network",
        explanation: "The listing pipes a script from its own repo or host straight into a shell (curl | sh, " +
            "| sudo bash, bash <(curl …), PowerShell iex). This is noted on the listing but does not " +
            "change the rating: the script is code this scan does not read, and the listing page shows " +
            "the repo's install steps as written so you can review them. Official installers for widely " +
            "used toolchains (uv, Docker, nvm, Bun, Rust, …) are not noted.",
    },
];
exports.SAFETY_SCANNER_CHECKS = [
    {
        title: "Instruction-override / prompt-injection phrasing",
        severity: "critical",
        explanation: '"Ignore previous instructions," "you are now an unrestricted assistant," and similar ' +
            "phrasing aimed at an agent reading a skill's own instructions rather than at a human reader. " +
            "When the phrase is quoted, in code, in a table, or named as an example (security tools and " +
            "test suites quote it constantly) it is a warning instead, never silent; inside a hidden HTML " +
            "comment or invisible text it stays critical. Text telling the agent to disregard or supersede its earlier " +
            "directives, to work with its safety guardrails switched off, or to output its system prompt is critical too, " +
            "and only a note when quoted or named as an example.",
    },
    {
        title: "Requests for secrets",
        severity: "critical",
        explanation: "Text telling the agent to read credential files (SSH keys, cloud logins, wallets, browser password stores) or " +
            "\"all API keys\" and to send them somewhere or keep it from the user. A bare instruction to read one is how setup " +
            "docs read and is not reported; quoted whole or shown in a table, it is a warning.",
    },
    {
        title: "Exfiltration-looking URLs",
        severity: "critical",
        explanation: "Known data-relay/testing domains (webhook.site, requestbin, etc.) linked to or sent data " +
            "to, which have no legitimate reason to appear in a skill's own instructions (a domain only " +
            "named in prose or a comparison is a warning), or a raw IP-literal URL " +
            "paired with curl/wget on the same line (flagged as a warning, since that case is " +
            "genuinely ambiguous; loopback addresses are ignored). Penetration testers' callback catchers (oastify, Burp " +
            "Collaborator, the oast.* hosts) count as relays. An image whose address carries the conversation or secrets when " +
            "it loads is critical; a Discord webhook or Telegram bot with its token written in, and a DNS lookup of a name " +
            "built from data, are warnings.",
    },
    {
        title: "Obfuscation",
        severity: "warning",
        explanation: "Long base64-looking blobs, invisible/zero-width characters (three or more touching letters, or a run of three " +
            "after visible text, which can spell out hidden text), homoglyphs substituted into " +
            "an otherwise-Latin word, and bidirectional-override characters — common tricks for hiding " +
            "text from a casual reader or a naive scanner. Text hidden in invisible Unicode Tag " +
            "characters is decoded and scanned like any other text; a run of 10 or more is critical.",
    },
    {
        title: "Hardcoded secrets",
        severity: "critical",
        explanation: "AWS, GitHub (classic, fine-grained, OAuth and app tokens), Slack, Anthropic, OpenAI and " +
            "Google API key shapes, and PEM private key headers — a skill's own manifest/README has no " +
            "legitimate reason to contain a real secret. Matched tokens are shown redacted, and " +
            "documentation placeholders (ghp_XXXX…, xoxp-your-user-token, AKIA…EXAMPLE) and keys published as public are " +
            "ignored. A Google key in a Firebase sign-in config, which ships to every browser, and a key in a test, fixture or " +
            "example file are warnings.",
    },
    {
        title: "Destructive shell command patterns",
        severity: "warning",
        explanation: "rm -rf of the whole root or home directory, chmod 777 /, a classic fork bomb — checked " +
            "line by line and flagged as warnings, since setup and uninstall docs genuinely mention some " +
            "of these. Decoding base64 straight into a shell is critical: no honest install step needs " +
            "to hide its commands.",
    },
    {
        title: "Fake prerequisites and suspicious downloads",
        severity: "warning",
        explanation: "A password-protected archive to download and run, commands or uploads staged on a paste " +
            "site (rentry, pastebin, glot.io, …), or a one-line download + chmod +x + run — the shape of " +
            "the ClawHavoc campaign's fake \"prerequisite\" installers. Downloads from anonymous file hosts, and a " +
            "downloaded script piped to a shell as a step the agent must take before the skill works, are warnings too.",
    },
    {
        title: "Persistence that fetches from the network",
        severity: "warning",
        explanation: "A cron job, launchd agent, systemd unit, Windows scheduled task or Run key, or a shell-profile " +
            "line that fetches something from the network: unlike a one-off install script, it keeps " +
            "pulling and running code on its own. Loopback addresses (local health checks) don't count.",
    },
    {
        title: "Reverse shells",
        severity: "critical",
        explanation: "Commands that hand control of the machine to a remote host (bash /dev/tcp, nc -e, " +
            "mkfifo + nc, socat exec, Python socket + subprocess). No skill needs one to install or run.",
    },
    {
        title: "Instructions hidden from the user",
        severity: "warning",
        explanation: '"Do not tell the user," "without informing the user," and <IMPORTANT>/<system>-style ' +
            "blocks, the usual wrapper for instructions smuggled into an MCP tool description, and orders to the agent in " +
            "an HTML comment, which the rendered page hides.",
    },
    {
        title: "Code in code blocks",
        severity: "critical",
        explanation: "The script checks below also run over each fenced code block of a SKILL.md or README, where a skill can carry its " +
            "payload without shipping a script. Hosts, addresses, links to programs, credential paths and global git hooks are " +
            "left to the checks above there, as docs show them as examples and install steps; a signature only quoted as data " +
            "is a note, and a block a doc introduces as an example stays below critical.",
    },
    {
        title: "Known malware campaigns",
        severity: "critical",
        explanation: "Names, download hosts, addresses and accounts used only by a published campaign against agent skills, such as " +
            "ClawHavoc's fake \"OpenClawCLI\" prerequisite (Koi Security, February 2026). Security docs that list them as " +
            "indicators get a note instead.",
    },
];
// Checks only the script scan makes, on the scripts, hooks and MCP configs a listing bundles (patterns/codeThreats.ts).
exports.SAFETY_SCRIPT_CHECKS = [
    {
        title: "Code that runs what it downloads",
        severity: "critical",
        explanation: "eval or exec of text fetched while the script runs (requests.get, urlopen, fetch), or Python's exec of a name set " +
            "from a download: what runs can change at any time.",
    },
    {
        title: "Code that runs what it decodes",
        severity: "warning",
        explanation: "eval of base64 (Buffer.from, atob), exec of b64decode or a decompressed blob, hex, character codes or reversed " +
            "text, exec of a name set from a decoding or decryption, PowerShell -EncodedCommand, and JavaScript obfuscator " +
            "output: it hides what runs from a reader. Long hex strings are decoded and checked like base64. Some honest tools " +
            "do it to ship a launcher, so it is a warning.",
    },
    {
        title: "Reverse shells in code",
        severity: "critical",
        explanation: "An interactive shell on a /dev/tcp connection, nc -e handing over a shell, or a connected socket wired to a shell. " +
            "Port checks on /dev/tcp and redirecting output to a log or /dev/null are not counted.",
    },
    {
        title: "Credentials or the whole environment sent out",
        severity: "critical",
        explanation: "A credential file (SSH private keys, cloud and registry logins, .netrc, wallets, the macOS keychain, browser " +
            "password and cookie stores) read in a file that sends data, critical when on one line; every environment variable " +
            "serialised or piped out in a file that sends data. The whole environment copied or iterated in such a file is a " +
            "warning. Handing the environment to a child process, or reading named variables, is not counted, and an attack " +
            "written whole inside a string the code never runs (a test case) is a warning.",
    },
    {
        title: "The machine's identity sent out",
        severity: "warning",
        explanation: "Two of the machine's name, its user name and its system details collected in a file that sends data: how stealers report a new victim.",
    },
    {
        title: "Coding agents with permission prompts off",
        severity: "critical",
        explanation: "Claude Code, Gemini CLI or Codex started with their permission prompts turned off, in a file that names credentials, " +
            "keys or wallets (how the s1ngularity attack stole them). Without that, autonomous-loop skills do it for ordinary " +
            "work, so it is a note.",
    },
    {
        title: "Links to a Windows program",
        severity: "warning",
        explanation: "A link to an .exe, .scr, .msi, .bat, .vbs, .hta, .dll or .jar in code, how droppers fetch their payload. A project's " +
            "GitHub release assets and a request posted to a server's .exe endpoint are not counted; some installers still do it.",
    },
    {
        title: "Raw IP addresses and throwaway hosts",
        severity: "warning",
        explanation: "Code that fetches from or sends to a public raw IP address, a paste site, a request relay, a Discord attachment link, " +
            "transfer.sh or a temporary tunnel, or fetches from a link shortener or anonymous file host. Critical in a file that also makes a download executable, sets a program to start " +
            "on its own, or sends data to a relay. Private, documentation and DNS-resolver addresses, placeholders, comments and " +
            "lists of hosts (as security tools keep) are not counted.",
    },
    {
        title: "Cryptocurrency miners",
        severity: "critical",
        explanation: "A miner such as xmrig started with its options, or a stratum mining-pool address with its port. A miner named alone is a warning.",
    },
    {
        title: "setuid",
        severity: "warning",
        explanation: "chmod 4755 or u+s, a stat.S_ISUID flag or a setuid mode passed to chmod, which runs a program with its owner's " +
            "rights, usually root. Some installers need it. setgid alone (2775, g+s) is how shared folders keep their group and " +
            "is not counted.",
    },
    {
        title: "Programs set to start on their own",
        severity: "warning",
        explanation: "A command (not a variable, alias, sourced file or condition) added to a shell start-up file, a file put in the " +
            "Windows Startup folder, a git template or hooks folder set for every repository, and an import line in a Python " +
            ".pth file, which runs every time Python starts.",
    },
    {
        title: "Ransomware",
        severity: "warning",
        explanation: '"Your files have been encrypted" and similar wording in code, and files encrypted across folders with the ' +
            "originals then removed or renamed.",
    },
];

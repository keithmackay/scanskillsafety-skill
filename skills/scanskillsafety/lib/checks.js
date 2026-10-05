"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFETY_SCANNER_CHECKS = exports.SAFETY_ADVISORY_SIGNALS = exports.SAFETY_GITHUB_SIGNALS = void 0;
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
exports.SAFETY_SCANNER_CHECKS = [
    {
        title: "Instruction-override / prompt-injection phrasing",
        severity: "critical",
        explanation: '"Ignore previous instructions," "you are now an unrestricted assistant," and similar ' +
            "phrasing aimed at an agent reading a skill's own instructions rather than at a human reader. " +
            "When the phrase is quoted, in code, in a table, or named as an example (security tools and " +
            "test suites quote it constantly) it is a warning instead, never silent; inside a hidden HTML " +
            "comment or invisible text it stays critical.",
    },
    {
        title: "Exfiltration-looking URLs",
        severity: "critical",
        explanation: "Known data-relay/testing domains (webhook.site, requestbin, etc.) that have no " +
            "legitimate reason to appear in a skill's own instructions, or a raw IP-literal URL " +
            "paired with curl/wget on the same line (flagged as a warning, since that case is " +
            "genuinely ambiguous; loopback addresses are ignored).",
    },
    {
        title: "Obfuscation",
        severity: "warning",
        explanation: "Long base64-looking blobs, invisible/zero-width characters, homoglyphs substituted into " +
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
            "documentation placeholders (ghp_XXXX…, xoxp-your-user-token, AKIA…EXAMPLE) are ignored.",
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
        title: "Install scripts run straight from the network",
        severity: "warning",
        explanation: "The listing pipes a script from its own repo or host straight into a shell (curl | sh, " +
            "| sudo bash, bash <(curl …), PowerShell iex). That script is code this scan does not read, " +
            "so it is worth reviewing before you run it. Official installers for widely used toolchains " +
            "(uv, Docker, nvm, Bun, Rust, …) are not flagged.",
    },
    {
        title: "Fake prerequisites and suspicious downloads",
        severity: "warning",
        explanation: "A password-protected archive to download and run, commands or uploads staged on a paste " +
            "site (rentry, pastebin, glot.io, …), or a one-line download + chmod +x + run — the shape of " +
            "the ClawHavoc campaign's fake \"prerequisite\" installers.",
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
            "blocks, the usual wrapper for instructions smuggled into an MCP tool description.",
    },
];

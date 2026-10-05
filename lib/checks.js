"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFETY_SCANNER_CHECKS = exports.SAFETY_GITHUB_SIGNALS = void 0;
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
exports.SAFETY_SCANNER_CHECKS = [
    {
        title: "Instruction-override / prompt-injection phrasing",
        severity: "critical",
        explanation: '"Ignore previous instructions," "you are now an unrestricted assistant," and similar ' +
            "phrasing aimed at an agent reading a skill's own instructions rather than at a human reader.",
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
        explanation: "Long base64-looking blobs, a high density of invisible/zero-width characters, or " +
            "homoglyphs substituted into an otherwise-Latin word — a common trick for hiding text " +
            "from a casual reader or a naive scanner.",
    },
    {
        title: "Hardcoded secrets",
        severity: "critical",
        explanation: "AWS, GitHub (classic, fine-grained, OAuth and app tokens), Slack, Anthropic, OpenAI and " +
            "Google API key shapes, and PEM private key headers — a skill's own manifest/README has no " +
            "legitimate reason to contain a real secret. Matched tokens are shown redacted.",
    },
    {
        title: "Destructive shell command patterns",
        severity: "warning",
        explanation: "rm -rf of the whole root or home directory, piping a downloaded script straight into a " +
            "shell, chmod 777 /, a classic fork bomb — checked line by line and flagged as warnings, " +
            "not critical, since legitimate install scripts genuinely use some of these.",
    },
];

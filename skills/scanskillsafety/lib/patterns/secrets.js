"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSecrets = scanSecrets;
// ABOUTME: Flags hardcoded-credential-shaped strings (cloud, GitHub, Slack, and AI-provider API
// ABOUTME: key formats, PEM private key headers) — a skill's own manifest/README has no legitimate
// ABOUTME: reason to contain a real secret, so a match is critical. Documentation placeholders
// ABOUTME: (ghp_XXXX…, xoxp-your-user-token, AKIA…EXAMPLE) are recognized and skipped.
const scanInput_1 = require("../scanInput");
const secretPatterns_1 = require("../secretPatterns");
function scanSecrets(input) {
    const findings = [];
    const lines = input.normalized.lines;
    lines.forEach(({ line, text }, i) => {
        const nextLine = lines[i + 1]?.text ?? "";
        for (const { name, pattern } of secretPatterns_1.SECRET_PATTERNS) {
            for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
                if ((0, secretPatterns_1.isPlaceholderSecret)(match[0], nextLine))
                    continue;
                findings.push((0, scanInput_1.findingAt)(input, line, { severity: "critical", category: "secrets", detail: `Contains what looks like a hardcoded ${name}` }));
                break;
            }
        }
    });
    return (0, scanInput_1.capFindings)(findings);
}

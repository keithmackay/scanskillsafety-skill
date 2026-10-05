"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSecrets = scanSecrets;
// ABOUTME: Flags hardcoded-credential-shaped strings (cloud, GitHub, Slack, and AI-provider API
// ABOUTME: key formats, PEM private key headers) — a skill's own manifest/README has no legitimate
// ABOUTME: reason to contain a real secret, so a match here is always critical, not just a warning.
const scanInput_1 = require("../scanInput");
const secretPatterns_1 = require("../secretPatterns");
function scanSecrets(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        for (const { name, pattern } of secretPatterns_1.SECRET_PATTERNS) {
            if (pattern.test(text)) {
                findings.push((0, scanInput_1.findingAt)(input, line, { severity: "critical", category: "secrets", detail: `Contains what looks like a hardcoded ${name}` }));
            }
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

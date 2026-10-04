"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSecrets = scanSecrets;
const SECRET_PATTERNS = [
    { name: "AWS access key ID", pattern: /akia[0-9a-z]{16}/i },
    { name: "GitHub personal access token", pattern: /ghp_[0-9a-z]{36}/i },
    { name: "Slack token", pattern: /xox[baprs]-[0-9a-z-]{10,}/i },
    { name: "PEM private key", pattern: /-----begin (rsa |openssh |ec |dsa )?private key-----/i },
];
function scanSecrets(text) {
    for (const { name, pattern } of SECRET_PATTERNS) {
        if (pattern.test(text)) {
            return [{ severity: "critical", category: "secrets", detail: `Contains what looks like a hardcoded ${name}` }];
        }
    }
    return [];
}

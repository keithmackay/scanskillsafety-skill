"use strict";
// ABOUTME: Credential formats the scanner recognizes, shared by the secrets check and by excerpt
// ABOUTME: redaction — every excerpt shown anywhere (the public badge included) masks any
// ABOUTME: secret-shaped token down to its first four characters.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECRET_PATTERNS = void 0;
exports.redactSecrets = redactSecrets;
// Patterns run on lowercased text (normalizeForScan) and on raw excerpts, so all are
// case-insensitive. \b keeps prose like "risk-assessment" from matching "sk-".
exports.SECRET_PATTERNS = [
    { name: "AWS access key ID", pattern: /\bakia[0-9a-z]{16}\b/i },
    { name: "GitHub fine-grained personal access token", pattern: /\bgithub_pat_[0-9a-z_]{22,}/i },
    { name: "GitHub token", pattern: /\bgh[pousr]_[0-9a-z]{36}\b/i },
    { name: "Slack token", pattern: /\bxox[baprs]-[0-9a-z-]{10,}/i },
    // Real key shapes only: kebab-case names like "sk-requirements-engineering" must not match.
    { name: "Anthropic API key", pattern: /\bsk-ant-(api|admin)\d{2}-[0-9a-z_-]{20,}/i },
    { name: "OpenAI API key", pattern: /\bsk-(?:(?:proj|svcacct|admin)-[0-9a-z_-]{40,}|[0-9a-z]{32,}\b)/i },
    { name: "Google API key", pattern: /\baiza[0-9a-z_-]{35}\b/i },
    { name: "PEM private key", pattern: /-----begin (rsa |openssh |ec |dsa )?private key-----/i },
];
function redactSecrets(text) {
    let out = text;
    for (const { pattern } of exports.SECRET_PATTERNS) {
        out = out.replace(new RegExp(pattern.source, "gi"), (token) => `${token.slice(0, 4)}…`);
    }
    return out;
}

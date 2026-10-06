"use strict";
// ABOUTME: Credential formats the scanner recognizes, shared by the secrets check and by excerpt
// ABOUTME: redaction — every excerpt shown anywhere (the public badge included) masks any
// ABOUTME: secret-shaped token down to its first four characters.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECRET_PATTERNS = void 0;
exports.isPlaceholderSecret = isPlaceholderSecret;
exports.redactSecrets = redactSecrets;
// Patterns run on lowercased text (normalizeForScan) and on raw excerpts, so all are
// case-insensitive. \b keeps prose like "risk-assessment" from matching "sk-".
exports.SECRET_PATTERNS = [
    { name: "AWS access key ID", pattern: /\bakia[0-9a-z]{16}\b/i },
    // Real fine-grained tokens are 93 characters; shorter matches are env-var names (GITHUB_PAT_<REPO>).
    { name: "GitHub fine-grained personal access token", pattern: /\bgithub_pat_[0-9a-z_]{70,}/i },
    { name: "GitHub token", pattern: /\bgh[pousr]_[0-9a-z]{36}\b/i },
    { name: "Slack token", pattern: /\bxox[baprs]-[0-9a-z-]{10,}/i },
    // Real key shapes only: kebab-case names like "sk-requirements-engineering" must not match.
    { name: "Anthropic API key", pattern: /\bsk-ant-(api|admin)\d{2}-[0-9a-z_-]{20,}/i },
    { name: "OpenAI API key", pattern: /\bsk-(?:(?:proj|svcacct|admin)-[0-9a-z_-]{40,}|[0-9a-z]{32,}\b)/i },
    { name: "Google API key", pattern: /\baiza[0-9a-z_-]{35}\b/i },
    { name: "PEM private key", pattern: /-----begin (rsa |openssh |ec |dsa )?private key-----/i },
];
const PROVIDER_PREFIX = /^(akia|github_pat_|gh[pousr]_|xox[baprs]-|sk-ant-(api|admin)\d{2}-|sk-(proj|svcacct|admin)-|sk-|aiza)/;
const PLACEHOLDER_WORD = /x{4,}|your|example|placeholder|dummy|fake|sample|redacted|changeme|replace|insert|token|here|\.\.\.|…|<|\*{3}/;
const SEQUENCE = /0123456789|1234567890|abcdefghij|qwerty/;
// A documentation placeholder rather than a live credential: ghp_XXXX…, xoxp-your-user-token,
// AKIAIOSFODNN7EXAMPLE, sk-000…, 1234567890abcdef… — words, sequences, or too few distinct
// characters for a random key. For a PEM header, the line after it decides (a real key body is a
// long base64 line, not "..." or "<your key>").
function isPlaceholderSecret(token, nextLine = "", restOfLine = "") {
    const t = token.toLowerCase();
    if (t.startsWith("-----begin")) {
        // The body may follow on the same line as literal "\n" escapes (JSON, .env, shell exports) or on
        // the next line. Either way, "...", "<your key>" or anything too short for a key is a placeholder.
        // A real key body starts with a long run of base64; header names listed in prose, "...", or
        // "my-pem-private-key…" templates don't.
        const inline = restOfLine.replace(/\\n/g, " ").replace(/^["'`,;\s]+/, "").trim();
        const firstToken = (inline || nextLine.trim()).replace(/^["'`]+/, "").split(/[\s"'`,;]/)[0];
        return !/^[a-z0-9+/=]{40,}$/i.test(firstToken);
    }
    if (PLACEHOLDER_WORD.test(t) || SEQUENCE.test(t))
        return true;
    const body = t.replace(PROVIDER_PREFIX, "");
    return new Set(body).size <= 6 || /(.)\1{5,}/.test(body) || longestAscendingLetterRun(body) >= 10;
}
// "aB3dE5fG7hI9…" style samples walk the alphabet; a random key essentially never does.
function longestAscendingLetterRun(body) {
    let best = 0, run = 0, prev = "";
    for (const ch of body.replace(/[^a-z]/g, "")) {
        run = prev && ch > prev ? run + 1 : 1;
        best = Math.max(best, run);
        prev = ch;
    }
    return best;
}
function redactSecrets(text) {
    let out = text;
    for (const { pattern } of exports.SECRET_PATTERNS) {
        out = out.replace(new RegExp(pattern.source, "gi"), (token) => `${token.slice(0, 4)}…`);
    }
    return out;
}

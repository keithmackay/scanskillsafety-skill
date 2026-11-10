"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECRET_PATTERNS = void 0;
exports.isPlaceholderSecret = isPlaceholderSecret;
exports.redactSecrets = redactSecrets;
// ABOUTME: Credential formats the scanner recognizes, shared by the secrets check and by excerpt
// ABOUTME: redaction — every excerpt shown anywhere (the public badge included) masks any
// ABOUTME: secret-shaped token down to its first four characters.
const node_crypto_1 = require("node:crypto");
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
// Keys published as public, kept as SHA-256 hashes of their lower-cased text: the Google keys gitleaks allowlists as public, the
// Chrome UX Report key Chrome DevTools ships, Google's documentation sample key, and GitHub's documentation sample token under
// its three prefixes. Secret scanners bundle these lists, so they show up in many skills.
const PUBLISHED_PUBLIC_KEYS = new Set([
    "22cced43a0335a25b3b400529524f8bdb3b00e48f438c3b3a8ebf26c1d7563f4",
    "278362331e534a7138cad49e07f9e7e77570fbcd34b153af389e1dd97af26679",
    "74b62fac30f9c68a7662d38be1c322d051227ae7f34bf4052102e6c0ba307ba6",
    "781906db7e1254559a6e6fa1969fff0bbcf4f99c9300350080e1df10a890a4e0",
    "5fbb5c0e2823d5646af7026c5b2b0d934acaba38471cc023dd775c55b02ca84b",
    "06cc18346f0da19caecb9ee054db0f49ab957a94589602a6d645bf62211d3f00",
    "ce9274b3c5a2a144f1c7e850e41b04c6d1d123f4f312618b63cf98e63e6bafe8",
    "a781039bdb9a507f0b1d7343095fa42364d5803ce1f6f94617f0d5a32f253914",
    "b140451510a1c48141429df3e18894bdee412d5f8cad4291d2651ebd91970dfc",
    "8bda1c099d51780bd64e4b469103b594b6d56cc02727ae024fe0475dd5fc13da",
    "9f9efefd0d697d09a2fc5b322f1a44d7924e2275764112acafe028a2bc3d7636",
    "03f6b35837ec59592f4144d113bf3839497152d601fc916f2d1e33fd5ae84ed8",
    "a97757487c3248a86d2b3b8caa5790bf38345b6583fa305086cb5198994602e2",
    "09ec54322f1d00b614d00501b2c4cedbc2262e9465a069c388dcb34f1c6ca9dd",
    "35d8c62739e49e67395dbd9badc6e614de4348a4bc26129a9c2e42ae4bff3070",
    "5411169f7cb3cfd87c6919d81b691340c51c0b6767cb9be03d15c6938fa8e93d",
    "c19875bd28468a9a3b1f9d6e406b918425d0c1c17201b520fabdef2fa844d007",
    "1dfdb406e87129bb1746b9f44a53ad9283550a1a06d5831624d37df4fbec48fd",
    "07a222d3cc4ff910e33c91b07a708728ca8c1aacd157f1216cfa9aeafb0f0cdc",
    "647b104619466bf62451cdd15386a67e7aa115633d41ddda32764a5f331e66bb",
    "24eb233e5b28950394ab2a05acbea699f1388ce8d96c224e74635a7d12a86aac",
]);
const PROVIDER_PREFIX = /^(akia|github_pat_|gh[pousr]_|xox[baprs]-|sk-ant-(api|admin)\d{2}-|sk-(proj|svcacct|admin)-|sk-|aiza)/;
const PLACEHOLDER_WORD = /x{4,}|your|example|placeholder|dummy|fake|sample|redacted|changeme|replace|insert|token|here|(^|[_-])(fixture|demo|probe)|notareal|not-a-real|\.\.\.|…|<|\*{3}|\d{20,}/;
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
    if (PUBLISHED_PUBLIC_KEYS.has((0, node_crypto_1.createHash)("sha256").update(t).digest("hex")))
        return true;
    if (PLACEHOLDER_WORD.test(t) || SEQUENCE.test(t) || /^(\.\.\.|…)/.test(restOfLine))
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

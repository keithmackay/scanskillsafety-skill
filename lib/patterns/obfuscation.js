"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanObfuscation = scanObfuscation;
const BASE64_CANDIDATE = /[A-Za-z0-9+/]{40,}={0,2}/g;
const INVISIBLE_CHAR_THRESHOLD = 3;
const HOMOGLYPH_THRESHOLD = 3;
// A candidate matching the base64 character set alone isn't enough — a long slash-separated
// word list (e.g. "BC/Alberta/Saskatchewan/...") matches that charset by coincidence but has
// none of real base64's character-distribution properties. Require a digit count and
// upper/lowercase mix typical of an actual encoded payload, rare in a chain of English words.
function looksLikeBase64(candidate) {
    const digitCount = (candidate.match(/[0-9]/g) ?? []).length;
    return digitCount >= 3 && /[A-Z]/.test(candidate) && /[a-z]/.test(candidate);
}
function scanObfuscation(text, normalizationStats) {
    const candidates = text.match(BASE64_CANDIDATE) ?? [];
    if (candidates.some(looksLikeBase64)) {
        return [
            { severity: "warning", category: "obfuscation", detail: "Contains a long base64-looking blob — not necessarily malicious, but worth inspecting what it decodes to" },
        ];
    }
    if (normalizationStats.invisibleCharCount >= INVISIBLE_CHAR_THRESHOLD) {
        return [
            { severity: "warning", category: "obfuscation", detail: `Contains ${normalizationStats.invisibleCharCount} invisible/zero-width characters — a common technique for evading substring-based scanners` },
        ];
    }
    if (normalizationStats.homoglyphCount >= HOMOGLYPH_THRESHOLD) {
        return [
            { severity: "warning", category: "obfuscation", detail: `Contains ${normalizationStats.homoglyphCount} non-Latin look-alike characters mixed into Latin text` },
        ];
    }
    return [];
}

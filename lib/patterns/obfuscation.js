"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanObfuscation = scanObfuscation;
// ABOUTME: Flags signs text may be hiding something from a casual reader — a long base64-looking
// ABOUTME: blob, or a high count of invisible/homoglyph characters (from normalizeForScan).
// ABOUTME: Always a warning, never critical — obfuscation alone isn't proof of malice (READMEs
// ABOUTME: legitimately contain base64 example payloads, badges, etc.) but is worth flagging.
const scanInput_1 = require("../scanInput");
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
// Runs on the raw lines (original casing) — the base64 heuristic relies on upper/lowercase mix
// to tell a real encoded payload from a lowercased false positive like a slash-separated word list.
function scanObfuscation(input) {
    const findings = [];
    input.rawLines.forEach((rawLine, index) => {
        // IDs inside URLs (Drive folders, Figma files, image paths) look like base64 but aren't payloads.
        const candidates = rawLine.replace(/\bhttps?:\/\/\S+/gi, " ").match(BASE64_CANDIDATE) ?? [];
        if (candidates.some(looksLikeBase64)) {
            findings.push((0, scanInput_1.findingAt)(input, index + 1, { severity: "warning", category: "obfuscation", detail: "Contains a long base64-looking blob — not necessarily malicious, but worth inspecting what it decodes to" }));
        }
    });
    // Document-level counts — no single line to point at.
    const { invisibleCharCount, homoglyphCount } = input.normalized;
    if (invisibleCharCount >= INVISIBLE_CHAR_THRESHOLD) {
        findings.push({ severity: "warning", category: "obfuscation", detail: `Contains ${invisibleCharCount} invisible/zero-width characters — a common technique for evading substring-based scanners` });
    }
    if (homoglyphCount >= HOMOGLYPH_THRESHOLD) {
        findings.push({ severity: "warning", category: "obfuscation", detail: `Contains ${homoglyphCount} non-Latin look-alike characters mixed into Latin text` });
    }
    return findings.slice(0, 20);
}

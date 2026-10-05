"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanObfuscation = scanObfuscation;
// ABOUTME: Flags signs text may be hiding something from a casual reader — a long base64-looking
// ABOUTME: blob, or a high count of invisible/homoglyph characters (from normalizeForScan).
// ABOUTME: Always a warning, never critical — obfuscation alone isn't proof of malice (READMEs
// ABOUTME: legitimately contain base64 example payloads, badges, etc.) but is worth flagging.
const scanInput_1 = require("../scanInput");
const normalizeForScan_1 = require("../normalizeForScan");
const secretPatterns_1 = require("../secretPatterns");
const BASE64_CANDIDATE = /[A-Za-z0-9+/]{40,}={0,2}/g;
const INVISIBLE_CHAR_THRESHOLD = 3;
const HOMOGLYPH_THRESHOLD = 3;
// A run this long of Unicode Tag characters is hidden text, not a stray emoji fragment.
const TAG_CRITICAL_THRESHOLD = 10;
const TAG_RUN = /[\u{E0000}-\u{E007F}]+/u;
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/;
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
        const candidates = rawLine.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ").match(BASE64_CANDIDATE) ?? [];
        if (candidates.some(looksLikeBase64)) {
            findings.push((0, scanInput_1.findingAt)(input, index + 1, { severity: "warning", category: "obfuscation", detail: "Contains a long base64-looking blob — not necessarily malicious, but worth inspecting what it decodes to" }));
        }
    });
    const { invisibleCharCount, homoglyphCount, tagCharCount, bidiControlCount } = input.normalized;
    if (tagCharCount > 0) {
        const index = input.rawLines.findIndex((l) => TAG_RUN.test(l.replace(/\u{1F3F4}[\u{E0020}-\u{E007E}]{1,10}\u{E007F}/gu, "")));
        const hidden = (0, secretPatterns_1.redactSecrets)((0, normalizeForScan_1.decodeTagChars)(input.rawLines[index]?.match(TAG_RUN)?.[0] ?? "")).slice(0, 120);
        const critical = tagCharCount >= TAG_CRITICAL_THRESHOLD;
        const finding = {
            severity: critical ? "critical" : "warning",
            category: "obfuscation",
            detail: critical
                ? `Contains ${tagCharCount} invisible Unicode Tag characters hiding text: "${hidden}"`
                : `Contains ${tagCharCount} stray Unicode Tag character(s), which render as nothing`,
        };
        findings.push(index >= 0 ? (0, scanInput_1.findingAt)(input, index + 1, finding) : finding);
    }
    if (bidiControlCount > 0) {
        const index = input.rawLines.findIndex((l) => BIDI_CONTROL.test(l));
        findings.push((0, scanInput_1.findingAt)(input, index + 1, {
            severity: "warning",
            category: "obfuscation",
            detail: `Contains ${bidiControlCount} bidirectional-override character(s), which make text display in a different order from how it's read`,
        }));
    }
    // Document-level counts — no single line to point at.
    if (invisibleCharCount >= INVISIBLE_CHAR_THRESHOLD) {
        findings.push({ severity: "warning", category: "obfuscation", detail: `Contains ${invisibleCharCount} invisible/zero-width characters — a common technique for evading substring-based scanners` });
    }
    if (homoglyphCount >= HOMOGLYPH_THRESHOLD) {
        findings.push({ severity: "warning", category: "obfuscation", detail: `Contains ${homoglyphCount} non-Latin look-alike characters mixed into Latin text` });
    }
    return findings.slice(0, 20);
}

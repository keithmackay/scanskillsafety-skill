"use strict";
// ABOUTME: Normalizes raw manifest/README text before pattern matching, so a scanner-evading
// ABOUTME: trick (zero-width characters splitting a phrase, homoglyphs, hard-wrapped line
// ABOUTME: breaks) doesn't let a malicious phrase slip past a naive substring/regex match.
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeTagChars = decodeTagChars;
exports.revealTagText = revealTagText;
exports.normalizeForScan = normalizeForScan;
// Characters with no visible glyph that attackers insert mid-word/mid-phrase specifically to
// break up a string a scanner would otherwise match verbatim.
const INVISIBLE_CHARS = /[​‌‍⁠﻿]/g;
// A small, common set of Cyrillic/Greek look-alikes for Latin letters — enough to catch the
// typical "аdmin" (Cyrillic а) trick without pulling in a full confusables table.
const HOMOGLYPH_MAP = {
    "а": "a", // а CYRILLIC SMALL LETTER A
    "е": "e", // е CYRILLIC SMALL LETTER IE
    "о": "o", // о CYRILLIC SMALL LETTER O
    "р": "p", // р CYRILLIC SMALL LETTER ER
    "с": "c", // с CYRILLIC SMALL LETTER ES
    "у": "y", // у CYRILLIC SMALL LETTER U
    "х": "x", // х CYRILLIC SMALL LETTER HA
    "і": "i", // і CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I
};
// Unicode Tag characters (U+E0000–E007F) render as nothing but map one-to-one onto ASCII, so they
// can carry a whole hidden instruction. Valid emoji tag sequences (the England/Scotland/Wales flags:
// 🏴 + tag letters + CANCEL TAG) are legitimate and are left out of counting and decoding.
const FLAG_TAG_SEQUENCE = /\u{1F3F4}[\u{E0020}-\u{E007E}]{1,10}\u{E007F}/gu;
const TAG_CHARS = /[\u{E0000}-\u{E007F}]+/gu;
// Bidirectional embedding/override/isolate controls, which make text display in a different order
// from how it's read. Plain LRM/RLM marks (U+200E/200F) are ordinary in RTL text and aren't included.
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
function decodeTagChars(run) {
    return [...run].map((ch) => {
        const cp = ch.codePointAt(0);
        return cp >= 0xe0020 && cp <= 0xe007e ? String.fromCharCode(cp - 0xe0000) : "";
    }).join("");
}
// Replaces each run of Tag characters (outside flag emoji) with its decoded ASCII, padded with
// spaces so it reads as separate words. Returns the text and how many Tag characters it decoded.
function revealTagText(input) {
    let tagCharCount = 0;
    const flagsMasked = input.replace(FLAG_TAG_SEQUENCE, "\u{1F3F4}");
    const text = flagsMasked.replace(TAG_CHARS, (run) => {
        tagCharCount += [...run].length;
        return ` ${decodeTagChars(run)} `;
    });
    return { text, tagCharCount };
}
const HOMOGLYPH_CHAR = /[аеорсухі]/;
const ASCII_LETTER = /[a-zA-Z]/;
// Only counts/replaces a homoglyph when it appears in the same whitespace-delimited token as an
// ASCII Latin letter — that mix is the actual evasion trick ("аdmin"). A token made entirely of
// non-Latin characters is just non-English text (e.g. a genuinely Russian description) and isn't
// touched — otherwise every listing written in Russian/Ukrainian/etc. would be flagged.
function normalizeToken(token) {
    if (!HOMOGLYPH_CHAR.test(token) || !ASCII_LETTER.test(token)) {
        return { text: token, homoglyphCount: 0 };
    }
    let homoglyphCount = 0;
    const text = token.replace(new RegExp(HOMOGLYPH_CHAR, "g"), (ch) => {
        homoglyphCount++;
        return HOMOGLYPH_MAP[ch];
    });
    return { text, homoglyphCount };
}
function normalizeForScan(input) {
    // Only invisible characters touching a letter count: that's the word-splitting trick. Emoji
    // joiners (👨‍👩) and stray zero-width spaces at line starts are formatting, not evasion.
    const invisibleCharCount = (input.match(/(?<=\p{L})[\u200B\u200C\u200D\u2060\uFEFF]|[\u200B\u200C\u200D\u2060\uFEFF](?=\p{L})/gu) ?? []).length;
    const bidiControlCount = (input.match(BIDI_CONTROLS) ?? []).length;
    const revealed = revealTagText(input);
    const stripped = revealed.text.replace(INVISIBLE_CHARS, "").replace(BIDI_CONTROLS, "");
    let homoglyphCount = 0;
    const lines = [];
    let offset = 0;
    stripped.split(/\r?\n/).forEach((rawLine, index) => {
        // Tokenize on any run of non-letter characters (whitespace, punctuation, hyphens) — not just
        // whitespace — so a hyphen-joined bilingual compound ("AI-слопа", common in Russian tech
        // writing) splits into separate same-script tokens instead of fusing into one "mixed" token.
        const tokens = rawLine.split(/([^\p{L}]+)/u).map((part) => {
            const { text, homoglyphCount: count } = normalizeToken(part);
            homoglyphCount += count;
            return text;
        });
        const text = tokens.join("").toLowerCase().replace(/\s+/g, " ").trim();
        if (text) {
            lines.push({ line: index + 1, start: offset, text });
            offset += text.length + 1;
        }
    });
    const text = lines.map((l) => l.text).join(" ");
    return { text, lines, invisibleCharCount, homoglyphCount, tagCharCount: revealed.tagCharCount, bidiControlCount };
}

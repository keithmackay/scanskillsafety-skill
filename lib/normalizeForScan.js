"use strict";
// ABOUTME: Normalizes raw manifest/README text before pattern matching, so a scanner-evading
// ABOUTME: trick (zero-width characters splitting a phrase, homoglyphs, hard-wrapped line
// ABOUTME: breaks) doesn't let a malicious phrase slip past a naive substring/regex match.
Object.defineProperty(exports, "__esModule", { value: true });
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
    const invisibleCharCount = (input.match(INVISIBLE_CHARS) ?? []).length;
    const stripped = input.replace(INVISIBLE_CHARS, "");
    let homoglyphCount = 0;
    // Tokenize on any run of non-letter characters (whitespace, punctuation, hyphens) — not just
    // whitespace — so a hyphen-joined bilingual compound ("AI-слопа", common in Russian tech
    // writing) splits into separate same-script tokens instead of fusing into one "mixed" token.
    const tokens = stripped.split(/([^\p{L}]+)/u).map((part) => {
        const { text, homoglyphCount: count } = normalizeToken(part);
        homoglyphCount += count;
        return text;
    });
    const text = tokens.join("").toLowerCase().replace(/\s+/g, " ").trim();
    return { text, invisibleCharCount, homoglyphCount };
}

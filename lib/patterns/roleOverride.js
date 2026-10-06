"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanRoleOverride = scanRoleOverride;
// ABOUTME: Detects instruction-override/jailbreak phrasing aimed at an agent reading a skill's
// ABOUTME: own instructions. Critical when written as an instruction; a warning when the phrase is
// ABOUTME: quoted, in code, in a table, or named as an example — security tools and test suites quote
// ABOUTME: it constantly. Quoting never silences it, and a hidden HTML comment or Tag text stays critical.
const scanInput_1 = require("../scanInput");
const PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
    /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
    /you\s+are\s+now\s+an?\s+.{0,40}(unrestricted|uncensored|without\s+rules|no\s+rules)/gi,
    /forget\s+(all\s+)?(your\s+)?(previous|prior)\s+instructions?/gi,
    /new\s+system\s+prompt\s*:/gi,
    // Developer-mode jailbreaks only in instruction form; "(Developer Mode enabled)" alone is
    // ordinary Windows setup advice.
    /you\s+are\s+(now\s+)?(in|running\s+in|operating\s+in)\s+developer\s+mode\b/gi,
    /\bact\s+as\s+.{0,40}\bwith\s+developer\s+mode\s+(enabled|activated|on)\b/gi,
    /\bdeveloper\s+mode\s+(is\s+)?now\s+(enabled|activated|on)\b/gi,
];
const EXAMPLE_CUE = /\b(detects?|detected|detecting|detection|detector|flags?|flagged|catches|blocks?|blocked|e\.g\.|i\.e\.|such as|phrases? like|for example|for instance|(?<![.\w-])examples?(?![.\w-])|attacks? like|patterns? like|injection attempts?|jailbreak attempts?|prompt[- ]injections?)\b/;
const TAG_CHAR = /[\u{E0000}-\u{E007F}]/u;
// True when the match sits inside quotes or inline code: an opening quote right before it, or an
// unbalanced quote/backtick earlier on the line.
function looksQuoted(prefix) {
    // Straight/curly/CJK quotes, fullwidth parens, backticks, and *emphasis* used as quotation.
    if (/["'`\u201C\u2018\u00AB\u300C\u300E\uFF08*_]\s*$/.test(prefix))
        return true;
    const count = (re) => (prefix.match(re) ?? []).length;
    return (count(/"/g) % 2 === 1 ||
        count(/`/g) % 2 === 1 ||
        count(/\u201C/g) > count(/\u201D/g) ||
        count(/\u300C/g) > count(/\u300D/g));
}
// "…even when the page says to ignore previous instructions", "phrases telling Claude to …".
const REPORTED_SPEECH = /\b(say|says|said|ask|asks|tell|tells|telling|told|instruct|instructs|instructing|instructions?\s+to)\b[^.]{0,60}$/;
// The same "such as / this kind of / detects" cues in Chinese and Japanese docs.
const CJK_CUE = /这类|这种|例如|比如|诸如|检测|識別|识别|扫描|例えば|検出/;
function isDocumentary(input, offset) {
    const entry = (0, scanInput_1.normalizedLineAt)(input, offset);
    if (!entry)
        return false;
    const rawLine = input.rawLines[entry.line - 1] ?? "";
    const prefix = entry.text.slice(0, Math.max(0, offset - entry.start));
    const fenced = input.fencedLines.has(entry.line);
    // Hidden from a human reader: never treated as documentation. A comment shown inside inline code
    // or a fenced block renders as visible text, so it isn't hidden.
    const inCode = fenced || (prefix.match(/`/g) ?? []).length % 2 === 1;
    if ((prefix.lastIndexOf("<!--") > prefix.lastIndexOf("-->") && !inCode) || TAG_CHAR.test(rawLine))
        return false;
    return (inCode ||
        /^\s*(\||>)/.test(rawLine) ||
        looksQuoted(prefix) ||
        REPORTED_SPEECH.test(prefix) ||
        EXAMPLE_CUE.test(entry.text) ||
        CJK_CUE.test(entry.text));
}
// Matched against the whole-document text (not line by line) so a phrase hard-wrapped across
// lines still matches; the finding points at the line where the phrase starts.
function scanRoleOverride(input) {
    const findings = [];
    for (const pattern of PATTERNS) {
        for (const match of input.normalized.text.matchAll(pattern)) {
            const offset = match.index ?? 0;
            const documentary = isDocumentary(input, offset);
            findings.push((0, scanInput_1.findingAt)(input, (0, scanInput_1.normalizedLineAt)(input, offset)?.line ?? 1, documentary
                ? { severity: "warning", category: "role-override", detail: `Quotes instruction-override phrasing (in quotes, code, a table or an example): "${match[0]}"` }
                : { severity: "critical", category: "role-override", detail: `Matched instruction-override phrasing: "${match[0]}"` }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

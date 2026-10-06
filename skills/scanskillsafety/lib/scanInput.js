"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareScanInput = prepareScanInput;
exports.normalizedLineAt = normalizedLineAt;
exports.lineAtOffset = lineAtOffset;
exports.describesDetection = describesDetection;
exports.documentaryContext = documentaryContext;
exports.excerptFor = excerptFor;
exports.findingAt = findingAt;
exports.capFindings = capFindings;
// ABOUTME: The prepared input every pattern module scans — raw text, its original lines, and the
// ABOUTME: normalized form — plus helpers that turn a match into a finding with a line number and
// ABOUTME: a redacted excerpt, and that cap how many findings one category can report.
const normalizeForScan_1 = require("./normalizeForScan");
const secretPatterns_1 = require("./secretPatterns");
function findFencedLines(rawLines) {
    const fencedLines = new Set();
    const fenceIntros = new Map();
    let inFence = false;
    let intro = "";
    let lastNonEmpty = "";
    rawLines.forEach((line, i) => {
        if (/^\s*(```|~~~)/.test(line)) {
            if (!inFence)
                intro = lastNonEmpty;
            fencedLines.add(i + 1);
            fenceIntros.set(i + 1, intro);
            inFence = !inFence;
        }
        else if (inFence) {
            fencedLines.add(i + 1);
            fenceIntros.set(i + 1, intro);
        }
        if (line.trim())
            lastNonEmpty = line.trim().toLowerCase();
    });
    return { fencedLines, fenceIntros };
}
const INVISIBLE_CHARS = /[\u200B\u200C\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]|[\u{E0000}-\u{E007F}]/gu;
const EXCERPT_MAX = 160;
const MAX_FINDINGS_PER_CATEGORY = 20;
function prepareScanInput(raw) {
    const rawLines = raw.split(/\r?\n/);
    return { raw, rawLines, normalized: (0, normalizeForScan_1.normalizeForScan)(raw), ...findFencedLines(rawLines) };
}
// The normalized line containing an offset into normalized.text.
function normalizedLineAt(input, offset) {
    let found = input.normalized.lines[0];
    for (const l of input.normalized.lines) {
        if (l.start > offset)
            break;
        found = l;
    }
    return found;
}
// Line number for an offset into normalized.text.
function lineAtOffset(input, offset) {
    return normalizedLineAt(input, offset)?.line ?? 1;
}
// Text describing what a tool detects or blocks ("scans for …", "detects …", "such as …") rather than
// doing it: security tools, detectors and their test suites name the very patterns we look for.
const DETECTION_CUE = /\b(scans?\s+for|scanning\s+for|detects?|detecting|detection|detector|looks?\s+for|flags?|flagged|checks?\s+for|hunts?\s+(for|down)|catches|blocks?|blocked|patterns?|such\s+as|e\.g\.|i\.e\.|for\s+example|for\s+instance|(?<![.\w-])examples?(?![.\w-]))\b/;
// The same cues in Chinese and Japanese docs (检测 = detection, 扫描 = scan, 例如 = e.g., …).
const CJK_DETECTION_CUE = /检测|檢測|扫描|掃描|识别|識別|例如|比如|诸如|这类|例えば|検出|スキャン/;
function describesDetection(text) {
    return DETECTION_CUE.test(text) || CJK_DETECTION_CUE.test(text);
}
// Broader than describesDetection, and used only to downgrade a critical finding to a warning, never
// to silence it: the line shows a tool's sample output or the input it inspects ("Raw result: AKIA…",
// "--check-url https://webhook.site/x"), or sits in a code block introduced as sample/expected output.
const SAMPLE_CUE = /\b(detected|raw\s+result|found\s+(un)?verified|expected\s+output|example\s+output|sample\s+output|sample|demo)\b|(^|\s)--(check|scan|detect|inspect|audit|validate|test)[\w-]*/;
function documentaryContext(input, line, text) {
    if (describesDetection(text) || SAMPLE_CUE.test(text))
        return true;
    // Blockquoted examples and table rows are how docs show an attack; downgrade only, never silence.
    if (/^\s*(>|\|)/.test(input.rawLines[line - 1] ?? ""))
        return true;
    const intro = input.fenceIntros.get(line);
    return intro !== undefined && (describesDetection(intro) || SAMPLE_CUE.test(intro) || /\boutput\b/.test(intro));
}
function excerptFor(input, line) {
    const text = (input.rawLines[line - 1] ?? "").replace(INVISIBLE_CHARS, "").trim();
    const redacted = (0, secretPatterns_1.redactSecrets)(text);
    return redacted.length > EXCERPT_MAX ? `${redacted.slice(0, EXCERPT_MAX - 1)}…` : redacted;
}
function findingAt(input, line, finding) {
    return { ...finding, line, excerpt: excerptFor(input, line) };
}
// One finding per (line, detail), at most MAX_FINDINGS_PER_CATEGORY per category.
function capFindings(findings) {
    const seen = new Set();
    const out = [];
    for (const f of findings) {
        const key = `${f.line ?? ""}|${f.detail}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(f);
        if (out.length >= MAX_FINDINGS_PER_CATEGORY)
            break;
    }
    return out;
}

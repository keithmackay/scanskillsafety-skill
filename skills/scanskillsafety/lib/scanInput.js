"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareScanInput = prepareScanInput;
exports.lineAtOffset = lineAtOffset;
exports.excerptFor = excerptFor;
exports.findingAt = findingAt;
exports.capFindings = capFindings;
// ABOUTME: The prepared input every pattern module scans — raw text, its original lines, and the
// ABOUTME: normalized form — plus helpers that turn a match into a finding with a line number and
// ABOUTME: a redacted excerpt, and that cap how many findings one category can report.
const normalizeForScan_1 = require("./normalizeForScan");
const secretPatterns_1 = require("./secretPatterns");
const INVISIBLE_CHARS = /[​‌‍⁠﻿]/g;
const EXCERPT_MAX = 160;
const MAX_FINDINGS_PER_CATEGORY = 20;
function prepareScanInput(raw) {
    return { raw, rawLines: raw.split(/\r?\n/), normalized: (0, normalizeForScan_1.normalizeForScan)(raw) };
}
// Line number for an offset into normalized.text.
function lineAtOffset(input, offset) {
    let line = input.normalized.lines[0]?.line ?? 1;
    for (const l of input.normalized.lines) {
        if (l.start > offset)
            break;
        line = l.line;
    }
    return line;
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

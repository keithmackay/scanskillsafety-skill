"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hexDecodedFindings = hexDecodedFindings;
exports.adjustForCode = adjustForCode;
exports.oneBase64BlobPerFile = oneBase64BlobPerFile;
// ABOUTME: Adjusts findings for code: a pattern or a code rule's signature only in a string, regex or comment is data (a block
// ABOUTME: list, a test payload) and becomes a note, as do emoji and translations; base64 and long hex strings are decoded and re-scanned.
const scanText_1 = require("./scanText");
const scanInput_1 = require("./scanInput");
const codeThreats_1 = require("./patterns/codeThreats");
const quotedSignatures_1 = require("./quotedSignatures");
// Secrets live in strings by nature; base64 is judged on its own terms below.
const DATA_DISCOUNT_EXEMPT = new Set(["secrets", "obfuscation"]);
const BASE64_BLOB_DETAIL = /base64-looking blob/;
const BASE64_CANDIDATE = /[A-Za-z0-9+/]{40,}={0,2}/g;
// PNG, GIF, WebP, SVG, JPEG, WOFF, TrueType and OpenType files, and DER-encoded keys and certificates.
const BINARY_MAGIC = /^(iVBOR|R0lGOD|UklGR|PHN2Zy|PD94bWwg|\/9j\/|d09G|AAEAAAA|T1RUTw|MFkwEwYHKoZIzj0|MIIB|MIIC|MIID|MIIE)/;
const HARMLESS_BASE64_LINE = /data:[\w/+.-]+;base64,|-----BEGIN (PUBLIC KEY|CERTIFICATE)|\bsha(256|384|512)-/;
const ALPHABET = /ABCDEFGHIJKLMNOPQRSTUVWXYZ|abcdefghijklmnopqrstuvwxyz/;
// Decoded bytes that are at least this share printable are text; images and compressed data are not.
const MIN_PRINTABLE_SHARE = 0.95;
const sameFinding = (a, b) => a.category === b.category;
function rescans(text) {
    return [...(0, scanText_1.scanText)(text, { codeBlocks: false }).findings, ...(0, codeThreats_1.scanCodeThreats)((0, scanInput_1.prepareScanInput)(text)).map((f) => ({ ...f, source: "scanner" }))];
}
function isData(path, finding, line) {
    if (finding.severity === "info" || DATA_DISCOUNT_EXEMPT.has(finding.category))
        return false;
    const code = (0, quotedSignatures_1.codeOutsideStringsAndComments)(path, line);
    if (quotedSignatures_1.RUNS_ITS_STRINGS.test(code))
        return false;
    return !rescans(code).some((f) => f.severity !== "info" && sameFinding(f, finding));
}
function decodedText(blob) {
    return readableText(Buffer.from(blob, "base64"));
}
function readableText(bytes) {
    if (bytes.length === 0)
        return null;
    let printable = 0;
    for (const b of bytes)
        if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128)
            printable++;
    if (printable / bytes.length < MIN_PRINTABLE_SHARE)
        return null;
    const text = bytes.toString("utf8");
    return text.includes("�") ? null : text;
}
// The base64 blob finding kept when a blob on the line decodes to readable text, plus what that text shows; nothing otherwise.
function judgeBase64(finding, line) {
    if (HARMLESS_BASE64_LINE.test(line))
        return [];
    const readable = (line.match(BASE64_CANDIDATE) ?? [])
        .filter((blob) => !BINARY_MAGIC.test(blob) && !ALPHABET.test(blob))
        .map(decodedText)
        .filter((text) => text !== null);
    if (readable.length === 0)
        return [];
    const inside = readable.flatMap(rescans).map((f) => ({ ...f, line: finding.line, excerpt: finding.excerpt, detail: `In base64-decoded text: ${f.detail}` }));
    return [finding, ...inside];
}
// A long run of hex digits, or of \x escapes, long enough to hold a command rather than a colour or a short id.
const HEX_RUN = /(?<![0-9a-f])((?:[0-9a-f]{2}){32,})(?![0-9a-f])|((?:\\x[0-9a-f]{2}){16,})/gi;
// What long hex strings in a file decode to, when it is readable text: each finding the rules raise on it, at the string's line.
// Hashes and keys decode to bytes that are not text, and are passed over.
function hexDecodedFindings(text) {
    const input = (0, scanInput_1.prepareScanInput)(text);
    return input.rawLines.flatMap((line, i) => [...line.matchAll(HEX_RUN)]
        .map((m) => readableText(Buffer.from((m[1] ?? m[2]).replace(/\\x/gi, ""), "hex")))
        .filter((decoded) => decoded !== null)
        .flatMap(rescans)
        .filter((f) => f.severity !== "info")
        .map((f) => ({ ...f, line: i + 1, excerpt: (0, scanInput_1.excerptFor)(input, i + 1), detail: `In hex-decoded text: ${f.detail}` })));
}
// Code is full of emoji joiners and translated strings, so these counts are only notes there. A bidirectional override
// (which can make code read differently from how it runs) keeps its weight.
const USUAL_IN_CODE_UNICODE = /invisible\/zero-width characters|non-Latin look-alike characters/;
// A sanitizer lists the bidirectional overrides it strips, inside a regex character class or one to a string. Overrides anywhere
// else (a comment or string that reads differently from how it runs) keep their weight.
const BIDI = /[\u202A-\u202E\u2066-\u2069]/;
const BIDI_AS_DATA = /\[[^\]\n]*\]|(['"])[\u202A-\u202E\u2066-\u2069]\1/g;
const BIDI_DETAIL = /bidirectional-override character/;
const bidiOnlyAsData = (lines) => lines.every((l) => !BIDI.test(l.replace(BIDI_AS_DATA, "")));
// Code names tags like <system> in paths, patterns and docstrings; a tag wrapping hidden instructions is a tool-description threat.
const USUAL_IN_CODE_TAG = /block, a common wrapper for instructions/;
// Findings from the prose rules, adjusted for a script's code. `lines` are the file's lines.
function adjustForCode(path, findings, lines) {
    return findings.flatMap((finding) => {
        if (finding.category === "obfuscation" && USUAL_IN_CODE_UNICODE.test(finding.detail)) {
            return [{ ...finding, severity: "info", detail: `Usual in code (emoji, translations): ${finding.detail}` }];
        }
        if (finding.category === "obfuscation" && BIDI_DETAIL.test(finding.detail) && bidiOnlyAsData(lines)) {
            return [{ ...finding, severity: "info", detail: `Usual in code (characters a sanitizer strips): ${finding.detail}` }];
        }
        if (finding.category === "concealment" && USUAL_IN_CODE_TAG.test(finding.detail)) {
            return [{ ...finding, severity: "info", detail: `Usual in code (tag names in paths and patterns): ${finding.detail}` }];
        }
        const line = finding.line === undefined ? undefined : lines[finding.line - 1];
        if (line === undefined)
            return [finding];
        if (finding.category === "obfuscation" && BASE64_BLOB_DETAIL.test(finding.detail))
            return judgeBase64(finding, line);
        if (isData(path, finding, line))
            return [{ ...finding, severity: "info", detail: `Quoted as data in code: ${finding.detail}` }];
        return [finding];
    });
}
const RUNS_DECODED_DETAIL = /^Runs code it decodes/;
// Readable base64 is a property of the file, so it is reported once, and not at all on a line already reported for running
// what it decodes.
function oneBase64BlobPerFile(findings) {
    const decodeLines = new Set(findings.filter((f) => RUNS_DECODED_DETAIL.test(f.detail)).map((f) => f.line));
    let reported = false;
    return findings.filter((f) => {
        if (f.category !== "obfuscation" || !BASE64_BLOB_DETAIL.test(f.detail) || f.severity === "info")
            return true;
        if (decodeLines.has(f.line) || reported)
            return false;
        reported = true;
        return true;
    });
}

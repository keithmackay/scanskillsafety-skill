"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeOutsideStringsAndComments = codeOutsideStringsAndComments;
exports.adjustCodeThreats = adjustCodeThreats;
exports.adjustForCode = adjustForCode;
exports.oneBase64BlobPerFile = oneBase64BlobPerFile;
// ABOUTME: Adjusts findings for code: a pattern or a code rule's signature only in a string, regex or comment is data (a block
// ABOUTME: list, a test payload) and becomes a note, as do emoji and translations; base64 is decoded or dropped, and reported once a file.
const scanText_1 = require("./scanText");
const scanInput_1 = require("./scanInput");
const codeThreats_1 = require("./patterns/codeThreats");
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
// A JavaScript regex literal, where a value can start: a pattern a guard or scanner matches, data like a string.
const REGEX_LITERAL = /(^\s*|[=(,:[!&|?{};]\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuyv]*/g;
const HASH_COMMENT_FILE = /\.(sh|bash|zsh|py|rb|ps1)$/i;
const BATCH_FILE = /\.(bat|cmd)$/i;
// A line that hands its strings to a shell or interpreter runs them, so its quoted text is not data.
const RUNS_ITS_STRINGS = /\b(eval|exec|execsync|execfile|spawn|spawnsync|system|popen)\s*\(|\bsubprocess\.|\bchild_process\b|\binvoke-expression\b|\biex\b|\b(ba|z)?sh\s+-c\b|\b(node|deno|bun|python[\d.]*|ruby|perl|php)\s+(-\w+\s+)*-[ec]\b|\bxargs\b|^\s*(eval|exec)\s/i;
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
// The line with its strings and comments removed: what the code itself does.
function codeOutsideStringsAndComments(path, line) {
    const trimmed = line.trim();
    if (BATCH_FILE.test(path) && /^(rem\b|::)/i.test(trimmed))
        return "";
    if (!HASH_COMMENT_FILE.test(path) && /^(\*|\/\*)/.test(trimmed))
        return "";
    const code = line.replace(STRING_LITERAL, '""');
    if (HASH_COMMENT_FILE.test(path))
        return code.replace(/(^|\s)#.*$/, "$1");
    return code.replace(REGEX_LITERAL, "$1/x/").replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
}
const sameFinding = (a, b) => a.category === b.category;
function rescans(text) {
    return [...(0, scanText_1.scanText)(text).findings, ...(0, codeThreats_1.scanCodeThreats)((0, scanInput_1.prepareScanInput)(text)).map((f) => ({ ...f, source: "scanner" }))];
}
function isData(path, finding, line) {
    if (finding.severity === "info" || DATA_DISCOUNT_EXEMPT.has(finding.category))
        return false;
    const code = codeOutsideStringsAndComments(path, line);
    if (RUNS_ITS_STRINGS.test(code))
        return false;
    return !rescans(code).some((f) => f.severity !== "info" && sameFinding(f, finding));
}
// The code rules that match a behaviour's own wording (a reverse shell, a miner, setuid, a ransom note, decoded code run). A
// security tool quotes them as data; malware hands them to a shell, so a file that runs any of its strings keeps them all.
const SIGNATURE_CATEGORIES = new Set(["remote-access", "crypto-mining", "privilege-escalation", "destructive-commands"]);
const RUNS_DECODED_DETAIL_START = /^Runs code it decodes/;
const isSignature = (f) => SIGNATURE_CATEGORIES.has(f.category) || (f.category === "obfuscation" && RUNS_DECODED_DETAIL_START.test(f.detail));
// Findings from the code-only rules, adjusted for a script: a signature quoted only as data, in a file that hands no string to
// a shell or interpreter, becomes a note. Hosts, addresses and what a file sends keep their weight, as code keeps them in strings.
function adjustCodeThreats(path, findings, lines) {
    if (lines.some((line) => RUNS_ITS_STRINGS.test(codeOutsideStringsAndComments(path, line))))
        return findings;
    return findings.map((finding) => {
        const line = finding.line === undefined ? undefined : lines[finding.line - 1];
        if (line === undefined || finding.severity === "info" || !isSignature(finding))
            return finding;
        const stillFires = rescans(codeOutsideStringsAndComments(path, line)).some((f) => f.severity !== "info" && sameFinding(f, finding));
        return stillFires ? finding : { ...finding, severity: "info", detail: `Quoted as data in code: ${finding.detail}` };
    });
}
function decodedText(blob) {
    const bytes = Buffer.from(blob, "base64");
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

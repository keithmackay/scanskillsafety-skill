"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNS_ITS_STRINGS = void 0;
exports.codeOutsideStringsAndComments = codeOutsideStringsAndComments;
exports.adjustCodeThreats = adjustCodeThreats;
// ABOUTME: Tells a code rule's signature (a reverse shell, a miner, setuid, decoded code run) that code only quotes as data, in a
// ABOUTME: string, regex or comment of a file that runs none of its strings, from one it runs; quoted ones become notes.
const scanInput_1 = require("./scanInput");
const codeThreats_1 = require("./patterns/codeThreats");
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
// A JavaScript regex literal, where a value can start: a pattern a guard or scanner matches, data like a string.
const REGEX_LITERAL = /(^\s*|[=(,:[!&|?{};]\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuyv]*/g;
const HASH_COMMENT_FILE = /\.(sh|bash|zsh|py|rb|ps1)$/i;
const BATCH_FILE = /\.(bat|cmd)$/i;
// A line that hands its strings to a shell or interpreter runs them, so its quoted text is not data.
exports.RUNS_ITS_STRINGS = /\b(eval|exec|execsync|execfile|spawn|spawnsync|system|popen)\s*\(|\bsubprocess\.|\bchild_process\b|\binvoke-expression\b|\biex\b|\b(ba|z)?sh\s+-c\b|\b(node|deno|bun|python[\d.]*|ruby|perl|php)\s+(-\w+\s+)*-[ec]\b|\bxargs\b|^\s*(eval|exec)\s/i;
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
// The code rules that match a behaviour's own wording (a reverse shell, a miner, setuid, a ransom note, decoded code run). A
// security tool quotes them as data; malware hands them to a shell, so a file that runs any of its strings keeps them all.
const SIGNATURE_CATEGORIES = new Set(["remote-access", "crypto-mining", "privilege-escalation", "destructive-commands"]);
const RUNS_DECODED_DETAIL_START = /^Runs code it decodes/;
const isSignature = (f) => SIGNATURE_CATEGORIES.has(f.category) || (f.category === "obfuscation" && RUNS_DECODED_DETAIL_START.test(f.detail));
// Findings from the code-only rules, adjusted for a script: a signature quoted only as data, in a file that hands no string to
// a shell or interpreter, becomes a note. Hosts, addresses and what a file sends keep their weight, as code keeps them in strings.
// The whole file is rescanned without its strings and comments, so a rule that needs another line of the file still sees it.
function adjustCodeThreats(path, findings, lines) {
    const code = lines.map((line) => codeOutsideStringsAndComments(path, line));
    if (code.some((line) => exports.RUNS_ITS_STRINGS.test(line)))
        return findings;
    if (!findings.some((f) => f.severity !== "info" && isSignature(f)))
        return findings;
    const firesInCode = (0, codeThreats_1.scanCodeThreats)((0, scanInput_1.prepareScanInput)(code.join("\n"))).filter((f) => f.severity !== "info");
    return findings.map((finding) => {
        if (finding.line === undefined || finding.severity === "info" || !isSignature(finding))
            return finding;
        const stillFires = firesInCode.some((f) => f.line === finding.line && f.category === finding.category);
        return stillFires ? finding : { ...finding, severity: "info", detail: `Quoted as data in code: ${finding.detail}` };
    });
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNS_ITS_STRINGS = void 0;
exports.codeOutsideStringsAndComments = codeOutsideStringsAndComments;
exports.codeLinesOf = codeLinesOf;
exports.linesInsideStrings = linesInsideStrings;
exports.fileRunsStrings = fileRunsStrings;
exports.adjustCodeThreats = adjustCodeThreats;
exports.quotedExfiltrationAsWarnings = quotedExfiltrationAsWarnings;
// ABOUTME: Tells code that only quotes a rule's signature (a reverse shell, a miner, setuid, decoded code run, an exfiltration) as
// ABOUTME: data, in a comment or a string no code runs, from code that runs it; quoted signatures become notes, exfiltration warnings.
const scanInput_1 = require("./scanInput");
const codeThreats_1 = require("./patterns/codeThreats");
const credentialFiles_1 = require("./patterns/credentialFiles");
const sendsData_1 = require("./patterns/sendsData");
const spanningText_1 = require("./spanningText");
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
// A JavaScript regex literal, where a value can start: a pattern a guard or scanner matches, data like a string.
const REGEX_LITERAL = /(^\s*|[=(,:[!&|?{};]\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuyv]*/g;
const HASH_COMMENT_FILE = /\.(sh|bash|zsh|py|rb|ps1)$/i;
const BATCH_FILE = /\.(bat|cmd)$/i;
// A line that hands its strings to a shell or interpreter runs them, so its quoted text is not data. A method named exec (a
// regex's, a database cursor's) is not the language's own.
exports.RUNS_ITS_STRINGS = /(?<![\w.])(eval|exec)\s*\(|\b(execsync|execfile|spawn|spawnsync|system|popen)\s*\(|\bsubprocess\.|\bchild_process\b|\binvoke-expression\b|\biex\b|\b(ba|z)?sh\s+-c\b|\b(node|deno|bun|python[\d.]*|ruby|perl|php)\s+(-\w+\s+)*-[ec]\b|\bxargs\b|^\s*(eval|exec)\s/i;
// child_process brought in under any name: its exec then runs strings, and the module's own name is itself a string.
const IMPORTS_CHILD_PROCESS = /\brequire\s*\(\s*['"](node:)?child_process['"]|\bfrom\s+['"](node:)?child_process['"]/;
// The line with its comments removed and its strings kept, for a file whose strings may run.
function codeOutsideComments(path, line) {
    const kept = [];
    const keep = (text) => `\u0000${kept.push(text) - 1}\u0000`;
    const masked = line.replace(STRING_LITERAL, keep);
    const code = codeOutsideStringsAndCommentsOf(path, masked, (l) => l.replace(REGEX_LITERAL, keep));
    return code.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}
// The line with its strings and comments removed: what the code itself does.
function codeOutsideStringsAndComments(path, line) {
    return codeOutsideStringsAndCommentsOf(path, line.replace(STRING_LITERAL, '""'), (l) => l.replace(REGEX_LITERAL, "$1/x/"));
}
// Each line's code, as codeOutsideStringsAndComments gives it (or with strings kept), also leaving out the strings and comments
// that span lines; a string that span hands to a shell or interpreter stays, as code.
function codeLinesOf(path, lines, keepStrings = false) {
    const ranges = (0, spanningText_1.spanningRanges)(path, lines, (prefix) => exports.RUNS_ITS_STRINGS.test(codeOutsideStringsAndComments(path, prefix)));
    const perLine = keepStrings ? codeOutsideComments : codeOutsideStringsAndComments;
    return lines.map((line, i) => {
        const here = ranges.get(i);
        if (!here)
            return perLine(path, line);
        if (here.length === 1 && here[0].start === 0 && here[0].end === line.length && here[0].runs)
            return line;
        let code = "";
        let pos = 0;
        for (const range of here) {
            code += line.slice(pos, range.start);
            if (range.kind === "string" && (keepStrings || range.runs))
                code += line.slice(range.start, range.end);
            pos = range.end;
        }
        return perLine(path, code + line.slice(pos));
    });
}
// The lines (by index) wholly inside a string that spans lines and does not run: text a file only holds.
function linesInsideStrings(path, lines) {
    const ranges = (0, spanningText_1.spanningRanges)(path, lines, (prefix) => exports.RUNS_ITS_STRINGS.test(codeOutsideStringsAndComments(path, prefix)));
    return new Set([...ranges].filter(([i, [range]]) => range.kind === "string" && !range.runs && range.start === 0 && range.end === lines[i].length).map(([i]) => i));
}
// Comments removed from a line whose strings are already masked; `maskRegexes` masks JavaScript regex literals first.
function codeOutsideStringsAndCommentsOf(path, code, maskRegexes) {
    const trimmed = code.trim();
    if (BATCH_FILE.test(path) && /^(rem\b|::)/i.test(trimmed))
        return "";
    if (!HASH_COMMENT_FILE.test(path) && /^(\*|\/\*)/.test(trimmed))
        return "";
    if (HASH_COMMENT_FILE.test(path))
        return code.replace(/(^|\s)#.*$/, "$1");
    return maskRegexes(code).replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
}
// The code rules that match a behaviour's own wording (a reverse shell, a miner, setuid, a ransom note, decoded code run). A
// security tool quotes them as data; malware hands them to a shell, so a file that runs any of its strings keeps them all.
const SIGNATURE_CATEGORIES = new Set(["remote-access", "crypto-mining", "privilege-escalation", "destructive-commands"]);
const RUNS_DECODED_DETAIL_START = /^Runs code it decodes/;
const isSignature = (f) => SIGNATURE_CATEGORIES.has(f.category) || (f.category === "obfuscation" && RUNS_DECODED_DETAIL_START.test(f.detail));
// Findings from the code-only rules, adjusted for a script: a signature only in a comment, or only quoted as data in a file that
// hands no string to a shell or interpreter, becomes a note. Hosts, addresses and what a file sends keep their weight, as code
// keeps them in strings. The whole file is rescanned without its comments (and its strings, when none run), so a rule that needs
// another line of the file still sees it.
// Whether any line of the file hands strings to a shell or interpreter, or brings in child_process, which runs them.
function fileRunsStrings(path, lines) {
    return codeLinesOf(path, lines).some((line) => exports.RUNS_ITS_STRINGS.test(line)) || lines.some((line) => IMPORTS_CHILD_PROCESS.test(line));
}
function adjustCodeThreats(path, findings, lines) {
    if (!findings.some((f) => f.severity !== "info" && isSignature(f)))
        return findings;
    // A file that runs its strings keeps them; its comments are still only words.
    const judged = codeLinesOf(path, lines, fileRunsStrings(path, lines));
    const firesInCode = (0, codeThreats_1.scanCodeThreats)((0, scanInput_1.prepareScanInput)(judged.join("\n"))).filter((f) => f.severity !== "info");
    return findings.map((finding) => {
        if (finding.line === undefined || finding.severity === "info" || !isSignature(finding))
            return finding;
        const stillFires = firesInCode.some((f) => f.line === finding.line && f.category === finding.category);
        return stillFires ? finding : { ...finding, severity: "info", detail: `Quoted as data in code: ${finding.detail}` };
    });
}
// An exfiltration written whole inside one string (a credential file read and sent, or the whole environment dumped) is a test
// case or a detector's example; it becomes a warning in a file that runs none of its strings. Shell and batch files keep it:
// their commands sit in quotes as they run.
const RUNS_QUOTED_COMMANDS = /\.(sh|bash|zsh|ps1|bat|cmd)$/i;
const QUOTED_EXFILTRATION = [
    { detail: /^Reads a credential file and sends it/, whole: (quoted) => credentialFiles_1.CREDENTIAL_FILE.test(quoted) && sendsData_1.SENDS_DATA.test(quoted) },
    { detail: /^Sends out every environment variable/, whole: (quoted) => codeThreats_1.WHOLE_ENVIRONMENT.test(quoted) },
];
function quotedExfiltrationAsWarnings(path, findings, lines) {
    if (RUNS_QUOTED_COMMANDS.test(path) || !findings.some((f) => f.severity === "critical" && f.category === "exfiltration"))
        return findings;
    if (fileRunsStrings(path, lines))
        return findings;
    const inside = linesInsideStrings(path, lines);
    return findings.map((finding) => {
        if (finding.severity !== "critical" || finding.category !== "exfiltration" || finding.line === undefined)
            return finding;
        const rule = QUOTED_EXFILTRATION.find((r) => r.detail.test(finding.detail));
        const i = finding.line - 1;
        if (!rule)
            return finding;
        const text = (lines[i] ?? "").toLowerCase();
        const quoted = inside.has(i) ? [text] : (text.match(STRING_LITERAL) ?? []);
        return quoted.some(rule.whole) ? { ...finding, severity: "warning", detail: `Quoted as data in code: ${finding.detail}` } : finding;
    });
}

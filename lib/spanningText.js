"use strict";
// ABOUTME: Finds strings and comments that span lines in code (Python triple-quoted strings, JavaScript template literals and
// ABOUTME: block comments, shell heredocs) and, for each line, the stretches of it they hold and whether that text runs.
Object.defineProperty(exports, "__esModule", { value: true });
exports.spanningRanges = spanningRanges;
const PYTHON_FILE = /\.py$/i;
const JS_FILE = /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/i;
const SHELL_FILE = /\.(sh|bash|zsh)$/i;
const never = () => false;
// The index just past the next unescaped `mark` from `from`, or -1.
function closingAfter(line, mark, from) {
    for (let i = line.indexOf(mark, from); i >= 0; i = line.indexOf(mark, i + 1)) {
        let backslashes = 0;
        for (let j = i - 1; j >= from && line[j] === "\\"; j--)
            backslashes++;
        if (backslashes % 2 === 0)
            return i + mark.length;
    }
    return -1;
}
// An f-string's {expression} runs; {{ and }} are literal braces.
const PYTHON_INTERPOLATION = /\{[^{}]*\}/;
const interpolatesPython = (line) => PYTHON_INTERPOLATION.test(line.replace(/\{\{|\}\}/g, ""));
// Python, read left to right: a one-line string or a comment is skipped whole, so a triple quote inside one opens nothing.
function pythonOpening(line, from, runs) {
    for (let i = from; i < line.length; i++) {
        const c = line[i];
        if (c === "#")
            return undefined;
        if (c !== '"' && c !== "'")
            continue;
        const triple = line.startsWith(c.repeat(3), i);
        const mark = triple ? c.repeat(3) : c;
        const close = closingAfter(line, mark, i + mark.length);
        if (close >= 0) {
            i = close - 1;
            continue;
        }
        if (!triple)
            return undefined;
        const prefix = line.slice(0, i).match(/(?<!\w)[rbuf]{1,2}$/i)?.[0] ?? "";
        return {
            col: i - prefix.length,
            kind: "string",
            runs: runs(line.slice(0, i - prefix.length)),
            closeIn: (l, f) => closingAfter(l, mark, f),
            lineRuns: /f/i.test(prefix) ? interpolatesPython : never,
        };
    }
    return undefined;
}
// Where a "/" starts a regex literal rather than a division: after an operator, an opening bracket or a keyword.
const REGEX_CAN_START = /(^|[=(,:[!&|?{};+\-*%<>~^]|\breturn|\btypeof|\bcase|\bin|\bof)\s*$/;
// The index just past a JavaScript regex literal starting at `start`, or -1 when it does not close on the line.
function regexEnd(line, start) {
    let inClass = false;
    for (let i = start + 1; i < line.length; i++) {
        const c = line[i];
        if (c === "\\")
            i++;
        else if (c === "[")
            inClass = true;
        else if (c === "]")
            inClass = false;
        else if (c === "/" && !inClass)
            return i + 1;
    }
    return -1;
}
const blockCommentEnd = (l, f) => (l.indexOf("*/", f) < 0 ? -1 : l.indexOf("*/", f) + 2);
// JavaScript, read left to right: one-line strings, regex literals and line comments are skipped whole.
function javascriptOpening(line, from, runs) {
    for (let i = from; i < line.length; i++) {
        const c = line[i];
        if (c === "/" && line[i + 1] === "/")
            return undefined;
        if (c === "/" && line[i + 1] === "*") {
            const close = blockCommentEnd(line, i + 2);
            if (close < 0)
                return { col: i, kind: "comment", runs: false, closeIn: blockCommentEnd, lineRuns: never };
            i = close - 1;
            continue;
        }
        if (c === "/" && REGEX_CAN_START.test(line.slice(0, i))) {
            const end = regexEnd(line, i);
            if (end < 0)
                return undefined;
            i = end - 1;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            const close = closingAfter(line, c, i + 1);
            if (close >= 0) {
                i = close - 1;
                continue;
            }
            if (c !== "`")
                return undefined;
            return { col: i, kind: "string", runs: runs(line.slice(0, i)), closeIn: (l, f) => closingAfter(l, "`", f), lineRuns: (l) => l.includes("${") };
        }
    }
    return undefined;
}
const HEREDOC = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/;
// Single-line strings blanked out to the same length, so "<<" inside one is not taken for a heredoc.
const blankQuotes = (line) => line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => " ".repeat(m.length));
// A heredoc fed to a shell or interpreter, directly or through a pipe, runs as code.
const HEREDOC_RUNS = /\b((ba|z|da)?sh|python[\d.]*|node|perl|ruby|php|eval|source|ssh|xargs)\b[^<|]*<<|<<.*\|\s*((ba|z|da)?sh|python[\d.]*|node|perl|ruby)\b/;
// A heredoc written into a file plants what it holds (a script, a cron line, a ransom note), as running it would.
const HEREDOC_WRITES_FILE = /(?<![\d&])>>?\s*(?!&|\/dev\/null\b)\S|\btee\b|\bcrontab\b|\bdd\b[^<]*\bof=/;
// Command substitution expands inside an unquoted heredoc.
const COMMAND_SUBSTITUTION = /\$\(|`/;
function heredocOpening(line, from) {
    if (from > 0 || /^\s*#/.test(line))
        return undefined;
    const m = line.match(HEREDOC);
    const at = m?.index ?? -1;
    // "<<" inside a quoted string is text, and inside (( )) it is a shift.
    if (!m || blankQuotes(line).slice(at, at + 2) !== "<<" || line.slice(0, at).includes("(("))
        return undefined;
    const [, , quote, word] = m;
    return {
        col: line.length,
        kind: "string",
        runs: HEREDOC_RUNS.test(line) || HEREDOC_WRITES_FILE.test(line),
        closeIn: (l, f) => (f === 0 && l.trim() === word ? l.length : -1),
        lineRuns: (l) => quote === "" && COMMAND_SUBSTITUTION.test(l),
    };
}
// For each line (by index) the stretches of it inside a string or comment that spans lines; lines with none are absent.
// `runs` tells whether code before an opening mark hands the string to a shell or interpreter.
function spanningRanges(path, lines, runs) {
    const opening = PYTHON_FILE.test(path)
        ? (line, from) => pythonOpening(line, from, runs)
        : JS_FILE.test(path)
            ? (line, from) => javascriptOpening(line, from, runs)
            : SHELL_FILE.test(path)
                ? heredocOpening
                : undefined;
    const ranges = new Map();
    if (!opening)
        return ranges;
    let open;
    let openRanges = [];
    const add = (i, start, end, line) => {
        if (end <= start || !open)
            return;
        const range = { start, end, kind: open.kind, runs: open.runs || open.lineRuns(line) };
        openRanges.push(range);
        ranges.set(i, [...(ranges.get(i) ?? []), range]);
    };
    lines.forEach((line, i) => {
        let pos = 0;
        for (;;) {
            if (open) {
                const end = open.closeIn(line, pos);
                if (end < 0) {
                    add(i, pos, line.length, line);
                    return;
                }
                add(i, pos, end, line);
                open = undefined;
                openRanges = [];
                pos = end;
                continue;
            }
            open = opening(line, pos);
            if (!open)
                return;
            // The opening mark belongs to the span; a heredoc's opening line is the command itself, so its span starts on the next.
            add(i, open.col, line.length, line);
            return;
        }
    });
    // A span still open at the end of the file was never a string or comment.
    for (const range of openRanges)
        range.runs = true;
    return ranges;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanCodeBlocks = scanCodeBlocks;
// ABOUTME: Runs the code rules over each fenced code block of a Markdown file (a SKILL.md or README), where a skill can carry
// ABOUTME: its payload without shipping a script; signatures only quoted as data are notes, and install steps are left to the prose rules.
const scanInput_1 = require("../scanInput");
const codeThreats_1 = require("./codeThreats");
const quotedSignatures_1 = require("../quotedSignatures");
const HASH_COMMENT_LANGUAGE = /^(bash|sh|shell|zsh|console|python|py|python3|ruby|rb|powershell|ps1|pwsh)$/;
function codeBlocks(input) {
    const blocks = [];
    let current = null;
    input.rawLines.forEach((raw, i) => {
        const line = i + 1;
        if (!input.fencedLines.has(line))
            return;
        const fence = raw.match(/^\s*(```|~~~)\s*([\w+-]*)/);
        if (fence) {
            if (current)
                blocks.push(current);
            const language = fence[2].toLowerCase();
            current = current ? null : { path: HASH_COMMENT_LANGUAGE.test(language) ? "block.sh" : "block.js", lines: [] };
        }
        else
            current?.lines.push(line);
    });
    if (current)
        blocks.push(current);
    return blocks;
}
function scanCodeBlocks(input) {
    return codeBlocks(input).flatMap(({ path, lines: block }) => {
        const lines = block.map((line) => input.rawLines[line - 1]);
        const findings = (0, codeThreats_1.scanCodeThreats)((0, scanInput_1.prepareScanInput)(lines.join("\n")), { inDocs: true });
        return (0, quotedSignatures_1.adjustCodeThreats)(path, findings, lines).map((f) => {
            const line = block[(f.line ?? 1) - 1];
            // A block a doc introduces as an example or a detector's input stays on record, below critical.
            const documentary = (0, scanInput_1.documentaryContext)(input, line, input.rawLines[line - 1].toLowerCase());
            return (0, scanInput_1.findingAt)(input, line, documentary && f.severity === "critical" ? { ...f, severity: "warning" } : f);
        });
    });
}

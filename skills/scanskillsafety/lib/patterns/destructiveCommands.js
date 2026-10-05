"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanDestructiveCommands = scanDestructiveCommands;
// ABOUTME: Flags destructive or concealed shell commands, one line at a time: rm -rf of root/home,
// ABOUTME: chmod 777 /, fork bombs (warnings), and base64 decoded straight into a shell (critical: no
// ABOUTME: honest step needs to hide its commands). Download-and-run installers live in installScript.ts.
const scanInput_1 = require("../scanInput");
// End of a shell word: end of line, whitespace, a shell separator, or a closing quote/backtick.
const WORD_END = "(?=$|[\\s;&|`'\")])";
// rm with a recursive flag whose target is the filesystem root or the whole home directory
// (~, ~/, ~/*, $HOME) — not a subdirectory such as ~/.cache/x, which uninstall steps use.
const RM_ROOT_OR_HOME = new RegExp(`\\brm\\s+((?:-{1,2}[a-z-]+\\s+)+)(\\/|~\\/?\\*?|\\$\\{?home\\}?\\/?\\*?)${WORD_END}`, "i");
const RECURSIVE_FLAG = /(^|\s)(-[a-z]*r|--recursive)/i;
const SHELL = "(sudo\\s+(-[a-z]+\\s+)*)?(sh|bash|zsh)\\b";
const PATTERNS = [
    {
        detail: "Runs `rm -rf` against a root or home-directory path",
        matches: (line) => {
            const m = line.match(RM_ROOT_OR_HOME);
            return !!m && RECURSIVE_FLAG.test(m[1]);
        },
    },
    {
        // No legitimate install step needs to hide its commands from the reader.
        detail: "Decodes base64 and runs the result in a shell",
        severity: "critical",
        matches: (line) => new RegExp(`\\bbase64\\s+(-d|--decode)\\b[^|]*\\|\\s*${SHELL}`, "i").test(line) ||
            /\beval\s*["']?\$\(.*\bbase64\s+(-d|--decode)\b/i.test(line),
    },
    {
        detail: "Sets world-writable permissions on a root path (chmod 777 /)",
        matches: (line) => new RegExp(`\\bchmod\\s+(-r\\s+)?777\\s+\\/${WORD_END}`, "i").test(line),
    },
    {
        detail: "Matches a classic shell fork-bomb pattern",
        matches: (line) => /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/.test(line),
    },
];
function scanDestructiveCommands(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        for (const { detail, severity = "warning", matches } of PATTERNS) {
            if (matches(text))
                findings.push((0, scanInput_1.findingAt)(input, line, { severity, category: "destructive-commands", detail }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

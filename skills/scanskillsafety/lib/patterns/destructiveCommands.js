"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanDestructiveCommands = scanDestructiveCommands;
// ABOUTME: Flags shell snippets with destructive or install-script-trust-chain patterns, one line
// ABOUTME: at a time. Mostly warnings — legitimate install scripts genuinely use some of these (curl |
// ABOUTME: sh is a common, if risky, installer pattern) — except decoding base64 straight into a
// ABOUTME: shell, which hides the command from the reader and is critical.
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
        detail: "Pipes a downloaded script directly into a shell (curl | sh / wget | bash)",
        // Requires something to fetch (a URL or host/path) so prose naming "curl | bash" doesn't match.
        matches: (line) => /\b(curl|wget)\s[^|]*(https?:\/\/|\b[\w-]+(\.[\w-]+)+\/)[^|]*\|\s*(sudo\s+(-[a-z]+\s+)*)?(sh|bash|zsh)\b/i.test(line),
    },
    {
        detail: "Runs a downloaded script through process substitution (bash <(curl …))",
        matches: (line) => /\b(bash|sh|zsh|source)\s+<\(\s*(curl|wget)\b/i.test(line),
    },
    {
        detail: "Runs a downloaded PowerShell script (iex / Invoke-Expression)",
        matches: (line) => /\b(iex|invoke-expression)\s*\(?\s*\(?\s*(iwr|irm|invoke-webrequest|invoke-restmethod|new-object\s+(system\.)?net\.webclient)\b/i.test(line) ||
            /\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]*\|\s*(iex|invoke-expression)\b/i.test(line),
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

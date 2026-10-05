"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanDestructiveCommands = scanDestructiveCommands;
// ABOUTME: Flags shell snippets with destructive or install-script-trust-chain patterns, one line
// ABOUTME: at a time. Always a warning, never critical — legitimate install scripts genuinely use
// ABOUTME: some of these (curl | sh is a common, if risky, installer pattern), so this flags for a
// ABOUTME: closer look rather than asserting malice.
const scanInput_1 = require("../scanInput");
// End of a shell word: end of line, whitespace, a shell separator, or a closing quote/backtick.
const WORD_END = "(?=$|[\\s;&|`'\")])";
// rm with a recursive flag whose target is the filesystem root or the whole home directory
// (~, ~/, ~/*, $HOME) — not a subdirectory such as ~/.cache/x, which uninstall steps use.
const RM_ROOT_OR_HOME = new RegExp(`\\brm\\s+((?:-{1,2}[a-z-]+\\s+)+)(\\/|~\\/?\\*?|\\$\\{?home\\}?\\/?\\*?)${WORD_END}`, "i");
const RECURSIVE_FLAG = /(^|\s)(-[a-z]*r|--recursive)/i;
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
        for (const { detail, matches } of PATTERNS) {
            if (matches(text))
                findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "destructive-commands", detail }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

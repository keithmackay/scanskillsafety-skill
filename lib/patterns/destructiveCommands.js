"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanDestructiveCommands = scanDestructiveCommands;
// ABOUTME: Flags destructive or concealed shell commands, one line at a time: rm -rf of root/home,
// ABOUTME: chmod 777 /, fork bombs (warnings), and base64 decoded straight into a shell (critical: no
// ABOUTME: honest step needs to hide its commands). Download-and-run installers live in installScript.ts.
const scanInput_1 = require("../scanInput");
const secretPatterns_1 = require("../secretPatterns");
// End of a shell word: end of line, whitespace, a shell separator, or a closing quote/backtick.
const WORD_END = "(?=$|[\\s;&|`'\")])";
// rm with a recursive flag whose target is the filesystem root or the whole home directory
// (~, ~/, ~/*, $HOME) — not a subdirectory such as ~/.cache/x, which uninstall steps use.
const RM_ROOT_OR_HOME = new RegExp(`\\brm\\s+((?:-{1,2}[a-z-]+\\s+)+)(\\/|~\\/?\\*?|\\$\\{?home\\}?\\/?\\*?)${WORD_END}`, "i");
const RECURSIVE_FLAG = /(^|\s)(-[a-z]*r|--recursive)/i;
const NEGATION = /(?<![-\w])(no|never|without|avoid|don'?t|doesn'?t|does\s+not|won'?t)\b/i;
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
        detail: "Sets world-writable permissions on a root path (chmod 777 /)",
        matches: (line) => new RegExp(`\\bchmod\\s+(-r\\s+)?777\\s+\\/${WORD_END}`, "i").test(line),
    },
    {
        detail: "Matches a classic shell fork-bomb pattern",
        matches: (line) => /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/.test(line),
    },
];
// base64 decoded and run in a shell. Within one command: no inline-code boundary (`) or escaped
// Markdown pipe (\|) between the decode and the pipe.
const BASE64_TO_SHELL = new RegExp(`\\bbase64\\s+(-d|--decode)\\b[^|\`\\\\]*(?<!\\\\)\\|\\s*${SHELL}`, "i");
const EVAL_BASE64 = /\beval\s*["']?\$\(.*\bbase64\s+(-d|--decode)\b/i;
// Something actually being decoded, fed straight into base64 within the same command: piped from
// echo/printf/cat/curl/wget, a here-string, or a file argument. A bare "`base64 -d | bash`" in a list
// of attack techniques has none, and neither does a `curl | sh` elsewhere on the line.
const PAYLOAD_SOURCE = /\b(echo|printf|cat|curl|wget)\b[^|`]*\|\s*base64\s+(-d|--decode)\b|\bbase64\s+(-d|--decode)\s+(<<<\s*)?[^\s|`'"-][^\s|`'"]*|<<<\s*\S+\s*\|\s*base64/i;
// Template payloads: echo "...", echo <base64>, <<< …
const PLACEHOLDER_PAYLOAD = /\b(echo|printf)\s+(-n\s+)?["']?(\.\.\.|…|<[^>]*>)|<<<\s*(\.\.\.|…|<[^>]*>)/i;
// GitHub's contents API returns files base64-encoded; decoding it into a shell is an install script.
const GH_CONTENTS_API = /\bgh\s+api\b.*\/contents\//i;
const INLINE_PAYLOAD = /(?:echo|printf)\s+(?:-n\s+)?["']?([A-Za-z0-9+/]{8,}={0,2})["']?/;
function decodedPreview(rawLine) {
    const payload = rawLine.match(INLINE_PAYLOAD)?.[1];
    if (!payload)
        return null;
    try {
        const decoded = atob(payload).replace(/[^\x20-\x7e]+/g, " ").trim();
        return decoded ? (0, secretPatterns_1.redactSecrets)(decoded).slice(0, 80) : null;
    }
    catch {
        return null;
    }
}
function scanBase64ToShell(input, line, text) {
    if (!(BASE64_TO_SHELL.test(text) || EVAL_BASE64.test(text)) || GH_CONTENTS_API.test(text))
        return null;
    if (!PAYLOAD_SOURCE.test(text) || PLACEHOLDER_PAYLOAD.test(text)) {
        return (0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "destructive-commands", detail: "Mentions decoding base64 into a shell (no payload shown)" });
    }
    const preview = decodedPreview(input.rawLines[line - 1] ?? "");
    // Named as something to avoid ("never run …") or in a scanner's docs: a warning, not critical.
    const downgrade = NEGATION.test(text) || (0, scanInput_1.documentaryContext)(input, line, text);
    return (0, scanInput_1.findingAt)(input, line, {
        severity: downgrade ? "warning" : "critical",
        category: "destructive-commands",
        detail: `Decodes base64 and runs the result in a shell${preview ? ` (decodes to: ${preview})` : ""}`,
    });
}
function scanDestructiveCommands(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        const base64Finding = scanBase64ToShell(input, line, text);
        if (base64Finding)
            findings.push(base64Finding);
        for (const { detail, matches } of PATTERNS) {
            if (matches(text))
                findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "destructive-commands", detail }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

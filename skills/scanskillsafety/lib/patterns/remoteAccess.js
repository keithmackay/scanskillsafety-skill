"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanRemoteAccess = scanRemoteAccess;
// ABOUTME: Flags reverse-shell one-liners (bash /dev/tcp, nc -e, mkfifo + nc, socat exec, Python
// ABOUTME: socket + subprocess) — commands that hand control of the machine to a remote host.
// ABOUTME: Critical: there is no install or setup reason for a skill to contain one. A warning when
// ABOUTME: the line describes what a tool detects.
const scanInput_1 = require("../scanInput");
const REVERSE_SHELL = [
    /\/dev\/(tcp|udp)\/[^\s/]+\/\d+/,
    /\b(nc|ncat|netcat)\b[^|;&]*\s-(e|c)\s+\S*\b(sh|bash|cmd)\b/,
    /\bmkfifo\s+\S+.*\|\s*(nc|ncat|netcat)\b/,
    /\bsocat\b.*\bexec:\s*['"]?\S*\b(sh|bash)\b/,
    /socket\.socket\(.*\b(subprocess|pty\.spawn|os\.dup2)\b/,
];
function scanRemoteAccess(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        if (!REVERSE_SHELL.some((re) => re.test(text)))
            continue;
        // A detector describing what it catches still names the command, so this stays a warning
        // rather than silence; as an instruction it's critical.
        findings.push((0, scanInput_1.findingAt)(input, line, (0, scanInput_1.describesDetection)(text)
            ? { severity: "warning", category: "remote-access", detail: "Names a reverse-shell command (in text describing what a tool detects)" }
            : { severity: "critical", category: "remote-access", detail: "Contains a reverse-shell command, which hands control of this machine to a remote host" }));
    }
    return (0, scanInput_1.capFindings)(findings);
}

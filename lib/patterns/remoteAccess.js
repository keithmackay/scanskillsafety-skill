"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanRemoteAccess = scanRemoteAccess;
// ABOUTME: Flags reverse-shell one-liners (bash /dev/tcp, nc -e, mkfifo + nc, socat exec, Python
// ABOUTME: socket + subprocess) — commands that hand control of the machine to a remote host.
// ABOUTME: Critical: there is no install or setup reason for a skill to contain one. A warning when
// ABOUTME: the line describes what a tool detects.
const scanInput_1 = require("../scanInput");
const REVERSE_SHELL = [
    // An interactive shell wired to /dev/tcp, not a port probe like "</dev/tcp/localhost/6507".
    /\b(ba|z|k)?sh\b[^|;]*(\s|\+)-[a-z]*i\b[^|;]*\/dev\/(tcp|udp)\//,
    /\/dev\/(tcp|udp)\/\S+\s*0>&1/,
    /\b(nc|ncat|netcat)\b[^|;&]*\s-(e|c)\s+\S*\b(sh|bash|cmd)\b/,
    /\bmkfifo\s+\S+.*\|\s*(nc|ncat|netcat)\b/,
    /\bsocat\b.*\bexec:\s*['"]?\S*\b(sh|bash)\b/,
    /socket\.socket\(.*\b(subprocess|pty\.spawn|os\.dup2)\b/,
];
// A template rather than a working shell: a placeholder destination, or none at all.
const PLACEHOLDER_TARGET = /\b(attacker|evil|lhost|rhost)\b|attacker_ip|target_ip|your[_-]?(ip|host|server)|<[^>]*(ip|host|vps|server)[^>]*>|\b1\.3\.3\.7\b|\$\{?(lhost|ip|host|target|attacker)\w*\}?|\.\.\./;
const DESTINATION = /\b\d{1,3}(\.\d{1,3}){3}\b|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|ru|cn|xyz|top|info|biz|me|cc|tk|sh|dev|app|co)\b/;
function scanRemoteAccess(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        if (!REVERSE_SHELL.some((re) => re.test(text)))
            continue;
        // A detector describing what it catches still names the command, so this stays a warning
        // rather than silence; as an instruction it's critical.
        const template = PLACEHOLDER_TARGET.test(text) || !DESTINATION.test(text);
        findings.push((0, scanInput_1.findingAt)(input, line, (0, scanInput_1.documentaryContext)(input, line, text)
            ? { severity: "warning", category: "remote-access", detail: "Names a reverse-shell command (in text describing what a tool detects)" }
            : template
                ? { severity: "warning", category: "remote-access", detail: "Shows a reverse-shell command template (placeholder or no destination)" }
                : { severity: "critical", category: "remote-access", detail: "Contains a reverse-shell command, which hands control of this machine to a remote host" }));
    }
    return (0, scanInput_1.capFindings)(findings);
}

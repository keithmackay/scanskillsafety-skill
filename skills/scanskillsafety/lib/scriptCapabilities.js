"use strict";
// ABOUTME: What a bundled script can do, for choosing which listings Claude reviews: reach the network, run code, read secrets or
// ABOUTME: credentials, or set up startup entries. Detectors only: they never raise a finding or change a rating.
Object.defineProperty(exports, "__esModule", { value: true });
exports.scriptCapabilities = scriptCapabilities;
exports.isRisky = isRisky;
exports.riskyLineNumbers = riskyLineNumbers;
const ORDER = ["network", "exec", "secrets", "startup"];
const SECRET_NAME = String.raw `\w*(key|token|secret|passw|cred|auth|private)\w*`;
const DETECTORS = {
    network: [
        /\b(curl|wget|ncat|nc)\s|['"](curl|wget|ncat|nc)['"]/i,
        /\b(requests|httpx|aiohttp|axios|urllib\d?|http\.client|urllib\.request)\b/i,
        /\bfetch\s*\(/i,
        /\bsocket\.socket\s*\(|\bnet\.(connect|createconnection)\s*\(/i,
        /\bhttps?\.(get|request)\s*\(/i,
        /\binvoke-(webrequest|restmethod)\b|\bnet\.webclient\b/i,
        /\/dev\/tcp\//i,
    ],
    exec: [
        /\bsubprocess\b|\bos\.(system|popen|exec\w*|spawn\w*)\s*\(/i,
        /\bchild_process\b|\b(execsync|spawnsync|execfile)\s*\(/i,
        /\b(eval|exec)\s*\(/i,
        /\b(ba|z)?sh\s+-c\b/i,
        /\bstart-process\b|\binvoke-expression\b|\biex\b/i,
        /\bchmod\s+(\+x|[0-7]*[1357]\b)|\bos\.chmod\s*\(/i,
    ],
    secrets: [
        new RegExp(String.raw `\bos\.(environ(\.get)?\s*[\[(]|getenv\s*\()\s*['"]${SECRET_NAME}['"]`, "i"),
        new RegExp(String.raw `\bprocess\.env(\.|\[\s*['"])${SECRET_NAME}`, "i"),
        new RegExp(String.raw `\$(env:|\{)?${SECRET_NAME}`, "i"),
        /\bdict\s*\(\s*os\.environ\s*\)|\bos\.environ\.copy\s*\(|json\.dumps\s*\(\s*(dict\s*\(\s*)?os\.environ|json\.stringify\s*\(\s*process\.env\s*\)/i,
        /\bprintenv\b|\benv\s*\|/i,
        /~\/\.ssh\b|\.ssh\/id_|\.aws\/credentials|\.netrc\b|\.git-credentials|\.docker\/config\.json|\.kube\/config\b|\.config\/gh\b/i,
        /\bfind-(generic|internet)-password\b|\bkeychain\b|login data|cookies\.sqlite/i,
    ],
    startup: [
        /\.(bashrc|bash_profile|zshrc|zprofile|profile)\b/i,
        /\bcrontab\b|\/etc\/cron/i,
        /launchagents|launchdaemons/i,
        /\/etc\/systemd|\.config\/systemd|systemctl\s+(enable|--user)/i,
        /currentversion\\+run\b|start menu\\+programs\\+startup/i,
    ],
};
function scriptCapabilities(text) {
    return ORDER.filter((capability) => DETECTORS[capability].some((pattern) => pattern.test(text)));
}
// Reaching the network matters together with something that can do harm with it.
function isRisky(capabilities) {
    return capabilities.includes("network") && capabilities.some((c) => c !== "network");
}
// The numbers (from 1) of the lines on which any detector matches.
function riskyLineNumbers(text) {
    const patterns = ORDER.flatMap((capability) => DETECTORS[capability]);
    return text.split("\n").flatMap((line, i) => (patterns.some((pattern) => pattern.test(line)) ? [i + 1] : []));
}

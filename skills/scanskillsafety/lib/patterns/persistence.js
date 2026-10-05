"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanPersistence = scanPersistence;
// ABOUTME: Flags persistence that pulls from the network: a cron job, launchd agent, systemd unit,
// ABOUTME: Windows scheduled task / Run key, or shell-profile line that fetches something to run.
// ABOUTME: A warning: unlike a one-off install script, this keeps re-fetching code on its own.
const scanInput_1 = require("../scanInput");
// Mechanisms that make something run again later without the user asking.
const SCHEDULED = [
    /\bcrontab\b/,
    /\/etc\/cron/,
    /@reboot\b/,
    /\blaunchctl\s+(load|bootstrap|enable)\b/,
    /\blibrary\/launch(agents|daemons)\b/,
    /\bsystemctl\s+(--user\s+)?enable\b/,
    /\/etc\/systemd\/system\//,
    /\bschtasks\s+\/create\b/,
    /\\currentversion\\run(once)?\b/,
    /\bshell:startup\b|\\start menu\\programs\\startup\\/,
];
// Appending to a shell profile only counts when the appended line itself fetches something: install
// docs routinely add a PATH line right after a curl installer.
const SHELL_PROFILE_APPEND = /(>>|\btee\s+-a)\s*["']?(~|\$home|\$\{home\})?\/?\.(bashrc|zshrc|profile|bash_profile|zprofile|zshenv)\b/;
// A network fetch, ignoring loopback (a local health check can't pull anything in): a remaining
// non-loopback URL, or a fetch command on a line that names no loopback address at all.
const FETCH_COMMAND = /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b/;
const LOOPBACK_URL = /https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0)\b\S*/g;
function fetches(text) {
    if (!text)
        return false;
    const withoutLoopback = text.replace(LOOPBACK_URL, "");
    return /https?:\/\//.test(withoutLoopback) || (withoutLoopback === text && FETCH_COMMAND.test(text));
}
function scanPersistence(input) {
    const findings = [];
    const lines = input.normalized.lines;
    let previousFlagged = false;
    lines.forEach(({ line, text }, i) => {
        const scheduled = SCHEDULED.some((re) => re.test(text)) && (fetches(text) || fetches(lines[i - 1]?.text) || fetches(lines[i + 1]?.text));
        const profile = SHELL_PROFILE_APPEND.test(text) && fetches(text);
        const flagged = scheduled || profile;
        // One finding per run of adjacent lines (e.g. download the plist, then launchctl load it).
        if (flagged && !previousFlagged) {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "persistence",
                detail: "Sets up something that runs again on its own (cron, launchd, systemd, startup entry or shell profile) and fetches from the network",
            }));
        }
        previousFlagged = flagged;
    });
    return (0, scanInput_1.capFindings)(findings);
}

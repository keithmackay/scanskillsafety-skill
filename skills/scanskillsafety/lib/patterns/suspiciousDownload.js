"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSuspiciousDownload = scanSuspiciousDownload;
// ABOUTME: Flags the "fake prerequisite" shape behind the ClawHavoc campaign and similar droppers:
// ABOUTME: a password-protected archive to download and run, commands staged on a paste site, or a
// ABOUTME: one-line download + chmod +x + execute. Warnings — each has rare legitimate uses.
const scanInput_1 = require("../scanInput");
const PASTE_SITES = [
    "rentry.co", "rentry.org", "glot.io", "pastebin.com", "paste.c-net.org", "hastebin.com", "ghostbin",
    "termbin.com", "paste.ee", "dpaste.org", "dpaste.com", "controlc.com", "justpaste.it", "privatebin", "paste.rs", "0bin.net",
];
const ARCHIVE = /\b(zip|rar|7z|archive|extract|unzip|unpack)\b|\.(zip|rar|7z)\b/;
// A password with an actual value ("password: infected", "extract with pass `openclaw`"), not a
// parameter named password in API docs.
const ARCHIVE_PASSWORD = /\b(password|passphrase|pwd)\s*(:|=|\bis\b)\s*[`'"]?(?!\(|string\b|str\b|optional\b)[^\s`'"]+|\b(with|using|use)\s+(the\s+)?(pass|password|passphrase)\s+[`'"]?[^\s`'"]+/;
// Downloads a file, makes it executable, and runs that same path, all in one command line.
const DOWNLOAD_CHMOD_RUN = /\b(curl|wget)\b.*&&\s*chmod\s+(\+x|u\+x|[0-7]?7[0-7]{2})\s+(\S+).*&&\s*(sudo\s+)?\3(\s|$)/;
function scanSuspiciousDownload(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        // Detectors and security docs name these patterns; that's documentation, not the thing itself.
        if ((0, scanInput_1.describesDetection)(text))
            continue;
        // Only as a link (https://rentry.co/…, rentry.co/abc), not a paste site named in a list.
        const pasteSite = PASTE_SITES.find((domain) => new RegExp(`(//|\\bwww\\.)${domain.replace(/\./g, "\\.")}|\\b${domain.replace(/\./g, "\\.")}/`).test(text));
        if (pasteSite) {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "suspicious-download",
                detail: `Links to a paste site (${pasteSite}), a common place to stage installer commands or send stolen data`,
            }));
        }
        if (ARCHIVE.test(text) && ARCHIVE_PASSWORD.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "suspicious-download",
                detail: "Asks you to extract a password-protected archive, the usual way malware droppers get past scanners",
            }));
        }
        if (DOWNLOAD_CHMOD_RUN.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "suspicious-download",
                detail: "Downloads a file, makes it executable and runs it in one step",
            }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

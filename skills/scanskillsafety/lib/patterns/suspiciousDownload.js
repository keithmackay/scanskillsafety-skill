"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_DROPS = exports.LINK_SHORTENERS = exports.PASTE_SITES = void 0;
exports.scanSuspiciousDownload = scanSuspiciousDownload;
// ABOUTME: Flags the "fake prerequisite" shape behind the ClawHavoc campaign and similar droppers:
// ABOUTME: a password-protected archive to download and run, commands staged on a paste site, a download from an anonymous
// ABOUTME: file host, or a one-line download + chmod +x + execute. Warnings — each has rare legitimate uses.
const scanInput_1 = require("../scanInput");
const sendsData_1 = require("./sendsData");
exports.PASTE_SITES = [
    "rentry.co", "rentry.org", "glot.io", "pastebin.com", "paste.c-net.org", "hastebin.com", "ghostbin",
    "termbin.com", "paste.ee", "dpaste.org", "dpaste.com", "controlc.com", "justpaste.it", "privatebin", "paste.rs", "0bin.net",
];
// Links that hide where they lead, and anonymous file drops: what they serve can change without the skill changing.
exports.LINK_SHORTENERS = ["bit.ly", "tinyurl.com", "is.gd", "cutt.ly", "t.ly", "rb.gy", "shorturl.at", "rebrand.ly", "ow.ly", "tiny.cc", "goo.su"];
exports.FILE_DROPS = [
    "transfer.sh", "catbox.moe", "0x0.st", "file.io", "gofile.io", "temp.sh", "bashupload.com", "oshi.at", "pixeldrain.com", "filebin.net",
    "uguu.se", "tmpfiles.org",
];
const FETCH_COMMAND = /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b/;
const hostOn = (hosts, text) => hosts.find((host) => new RegExp(`(//|\\bwww\\.)([\\w-]+\\.)*${host.replace(/\./g, "\\.")}(?![\\w-])`).test(text));
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
        const pasteSite = exports.PASTE_SITES.find((domain) => new RegExp(`(//|\\bwww\\.)${domain.replace(/\./g, "\\.")}|\\b${domain.replace(/\./g, "\\.")}/`).test(text));
        if (pasteSite) {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "suspicious-download",
                detail: `Links to a paste site (${pasteSite}), a common place to stage installer commands or send stolen data`,
            }));
        }
        // Vendors' install docs do use shortened links; an anonymous file drop is no vendor's home.
        const fileDrop = FETCH_COMMAND.test(text) && !sendsData_1.SENDS_DATA.test(text) ? hostOn(exports.FILE_DROPS, text) : undefined;
        if (fileDrop) {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "suspicious-download",
                detail: `Downloads from an anonymous file host (${fileDrop}), so what it fetches can change unseen`,
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

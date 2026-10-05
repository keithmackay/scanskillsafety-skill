"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanExfiltration = scanExfiltration;
// ABOUTME: Flags data-exfiltration destinations: known webhook-relay testing services (critical as a
// ABOUTME: URL or a send aimed at them; a warning when only named in prose or a comparison, e.g. a
// ABOUTME: webhook tool listing its competitors) and raw IP-literal URLs fetched with curl/wget on the
// ABOUTME: same line (warning, since those are genuinely ambiguous — plenty of internal-tooling use).
const scanInput_1 = require("../scanInput");
const KNOWN_RELAY_DOMAINS = ["webhook.site", "requestbin.com", "pipedream.net", "hookbin.com", "beeceptor.com"];
// A relay domain named as a point of comparison ("without webhook.site", "an alternative to …").
const COMPARISON = /\b(without|instead\s+of|unlike|alternatives?\s+to|vs\.?|versus|compared\s+(to|with)|replaces?|replacement\s+for|no\s+need\s+for)\b/;
const IP_LITERAL_WITH_FETCH = /\b(curl|wget)\b.*https?:\/\/((\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3})/i;
function scanExfiltration(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        for (const domain of KNOWN_RELAY_DOMAINS) {
            if (!text.includes(domain))
                continue;
            const d = domain.replace(/\./g, "\\.");
            const isUrl = new RegExp(`(//|\\bwww\\.)([\\w-]+\\.)*${d}|\\b${d}/`).test(text);
            // A send aimed at the domain itself ("post … to webhook.site", curl/wget naming it), not just
            // a send verb somewhere on the line ("forward webhooks — without … webhook.site").
            const sendsThere = new RegExp(`\\b(post|send|upload|forward|exfiltrat|pipe|report|deliver)\\w*\\b[^.]*\\b(to|at|into)\\s+\\S*${d}`).test(text) ||
                new RegExp(`\\b(curl|wget|fetch|invoke-webrequest|iwr|requests\\.\\w+|axios\\.\\w+)\\b.*${d}`).test(text);
            const critical = sendsThere || (isUrl && !COMPARISON.test(text));
            findings.push((0, scanInput_1.findingAt)(input, line, critical
                ? {
                    severity: "critical",
                    category: "exfiltration",
                    detail: `References a known data-relay/testing domain (${domain}), which has no legitimate reason to appear in a skill's own instructions`,
                }
                : {
                    severity: "warning",
                    category: "exfiltration",
                    detail: `Mentions a known data-relay/testing domain (${domain}) without linking or sending anything to it`,
                }));
        }
    }
    for (const { line, text } of input.normalized.lines) {
        const match = text.match(IP_LITERAL_WITH_FETCH);
        // Loopback (127.x) can't send data off the machine — it's a local health check, not exfiltration.
        if (match && match[3] !== "127") {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "exfiltration",
                detail: "Fetches a raw IP-literal URL — ambiguous (could be legitimate internal tooling) but worth a second look",
            }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

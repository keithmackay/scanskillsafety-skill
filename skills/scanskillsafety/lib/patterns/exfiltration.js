"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanExfiltration = scanExfiltration;
// ABOUTME: Flags URLs that look like a data-exfiltration destination — known webhook-relay
// ABOUTME: testing services (critical, since they have no legitimate reason to appear in a
// ABOUTME: skill's own instructions) and raw IP-literal URLs paired with curl/wget on the same
// ABOUTME: line (warning, since those are genuinely ambiguous — plenty of internal-tooling use).
const scanInput_1 = require("../scanInput");
const KNOWN_RELAY_DOMAINS = ["webhook.site", "requestbin.com", "pipedream.net", "hookbin.com", "beeceptor.com"];
const IP_LITERAL_WITH_FETCH = /\b(curl|wget)\b.*https?:\/\/((\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3})/i;
function scanExfiltration(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        for (const domain of KNOWN_RELAY_DOMAINS) {
            if (text.includes(domain)) {
                findings.push((0, scanInput_1.findingAt)(input, line, {
                    severity: "critical",
                    category: "exfiltration",
                    detail: `References a known data-relay/testing domain (${domain}), which has no legitimate reason to appear in a skill's own instructions`,
                }));
            }
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

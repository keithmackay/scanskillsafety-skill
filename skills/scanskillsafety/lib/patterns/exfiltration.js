"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanExfiltration = scanExfiltration;
// ABOUTME: Flags data-exfiltration destinations: known webhook-relay testing services (critical when
// ABOUTME: data is sent to them; a warning when only linked or named, as webhook-testing docs and tool
// ABOUTME: lists do) and raw IP-literal URLs fetched with curl/wget on the
// ABOUTME: same line (warning, since those are genuinely ambiguous — plenty of internal-tooling use).
const scanInput_1 = require("../scanInput");
// Pipedream's request bins live on *.m.pipedream.net; other pipedream.net hosts (mcp.pipedream.net)
// are its ordinary integration service.
const KNOWN_RELAY_DOMAINS = ["webhook.site", "requestbin.com", "m.pipedream.net", "hookbin.com", "beeceptor.com"];
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
            // The domain itself (or a subdomain), not a longer name ending in it (device-webhook.site).
            if (!new RegExp(`(?<![\\w-])${d}`).test(text))
                continue;
            const isUrl = new RegExp(`(//|\\bwww\\.)([\\w-]+\\.)*${d}|\\b${d}/`).test(text);
            // A send aimed at the domain itself ("post … to webhook.site", curl/wget naming it), not just
            // a send verb somewhere on the line ("forward webhooks — without … webhook.site").
            const sendsThere = 
            // Within one sentence: a period only ends it when followed by a space (not ~/.ssh, file.txt).
            new RegExp(`\\b(post|send|upload|forward|exfiltrat|pipe|report|deliver)\\w*\\b(?:[^.]|\\.(?=\\S))*\\b(to|at|into)\\s+\\S*${d}`).test(text) ||
                new RegExp(`\\b(curl|wget|fetch|invoke-webrequest|iwr|requests\\.\\w+|axios\\.\\w+)\\b.*${d}`).test(text);
            // Critical only when data is sent there. A link alone is how webhook-testing docs, debug settings
            // and tool lists use these services; a checker's docs pass the URL in as the thing to inspect.
            const critical = sendsThere && !(0, scanInput_1.documentaryContext)(input, line, text);
            findings.push((0, scanInput_1.findingAt)(input, line, critical
                ? {
                    severity: "critical",
                    category: "exfiltration",
                    detail: `References a known data-relay/testing domain (${domain}), which has no legitimate reason to appear in a skill's own instructions`,
                }
                : {
                    severity: "warning",
                    category: "exfiltration",
                    detail: isUrl && !COMPARISON.test(text)
                        ? `Links to a known data-relay/testing domain (${domain}) without sending anything to it`
                        : `Mentions a known data-relay/testing domain (${domain}) without linking or sending anything to it`,
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

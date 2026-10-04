"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanExfiltration = scanExfiltration;
const KNOWN_RELAY_DOMAINS = ["webhook.site", "requestbin.com", "pipedream.net", "hookbin.com", "beeceptor.com"];
const IP_LITERAL_WITH_FETCH = /(curl|wget)\s+.*https?:\/\/(\d{1,3}\.){3}\d{1,3}/i;
function scanExfiltration(text) {
    for (const domain of KNOWN_RELAY_DOMAINS) {
        if (text.toLowerCase().includes(domain)) {
            return [
                {
                    severity: "critical",
                    category: "exfiltration",
                    detail: `References a known data-relay/testing domain (${domain}), which has no legitimate reason to appear in a skill's own instructions`,
                },
            ];
        }
    }
    if (IP_LITERAL_WITH_FETCH.test(text)) {
        return [
            {
                severity: "warning",
                category: "exfiltration",
                detail: "Fetches a raw IP-literal URL — ambiguous (could be legitimate internal tooling) but worth a second look",
            },
        ];
    }
    return [];
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_RELAY_DOMAINS = void 0;
exports.scanExfiltration = scanExfiltration;
// ABOUTME: Flags data-exfiltration destinations: known webhook-relay testing services (critical when data is sent to them; a warning
// ABOUTME: when only linked or named), fixed Discord webhooks and Telegram bots, images whose address carries the conversation or
// ABOUTME: secrets, and raw IP-literal URLs fetched with curl/wget (a warning: plenty of internal tooling does it).
const scanInput_1 = require("../scanInput");
// Pipedream's request bins live on *.m.pipedream.net; other pipedream.net hosts (mcp.pipedream.net)
// are its ordinary integration service.
exports.KNOWN_RELAY_DOMAINS = [
    "webhook.site",
    "requestbin.com",
    "m.pipedream.net",
    "hookbin.com",
    "beeceptor.com",
    // Out-of-band callback catchers from penetration testing: each subdomain reports every request and DNS lookup to its maker.
    // interactsh's own servers are the oast.* domains; interact.sh is also a common script name.
    "oastify.com",
    "burpcollaborator.net",
    "oast.fun",
    "oast.pro",
    "oast.live",
    "oast.site",
    "oast.online",
    "oast.me",
    "dnslog.cn",
    "ceye.io",
    "requestrepo.com",
];
// A relay domain named as a point of comparison ("without webhook.site", "an alternative to …").
const COMPARISON = /\b(without|instead\s+of|unlike|alternatives?\s+to|vs\.?|versus|compared\s+(to|with)|replaces?|replacement\s+for|no\s+need\s+for)\b/;
// A Discord webhook or Telegram bot with its real token: whatever is sent there reaches whoever made it.
const FIXED_CHANNEL = /discord(app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{50,}|api\.telegram\.org\/bot\d{6,12}:[\w-]{30,}|\b\d{8,10}:aa[\w-]{33}\b/;
// An image that loads by itself when the reply is shown, with its query filled in at run time ({…}, $…, <…>).
const FILLED_IMAGE_QUERY = /!\[[^\]]*\]\(\s*https?:\/\/[^)\s]*\?([^)\s]*)|<img\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"'\s]*\?([^"'\s]*)/;
const FILLED_IN = /\{([^}]*)\}|\$\{?([a-z_][\w]*)|<([^>]+)>|%7b([^%]*)%7d/g;
// What a poisoned skill has an image carry off: the conversation, the agent's memory, or secrets. Not a value the user fills in.
const SENSITIVE_FILL = /^(?!your|my)\w*(conversation|history|chat|messages?|memory|secrets?|passwords?|credentials?|environ|\benv\b|ssh|private)/;
function imageCarriesSensitiveData(text) {
    const match = text.match(FILLED_IMAGE_QUERY);
    if (!match)
        return false;
    const query = match[1] ?? match[2] ?? "";
    return [...query.matchAll(FILLED_IN)].some((m) => SENSITIVE_FILL.test((m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim()));
}
const IP_LITERAL_WITH_FETCH = /\b(curl|wget)\b.*https?:\/\/((\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3})/i;
function scanExfiltration(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        for (const domain of exports.KNOWN_RELAY_DOMAINS) {
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
        if (FIXED_CHANNEL.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "exfiltration",
                detail: "Has a Discord webhook or Telegram bot written in, which delivers whatever is sent to whoever made it",
            }));
        }
        if (imageCarriesSensitiveData(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, (0, scanInput_1.documentaryContext)(input, line, text)
                ? { severity: "warning", category: "exfiltration", detail: "Shows an image whose address carries the conversation or secrets" }
                : { severity: "critical", category: "exfiltration", detail: "Has the agent show an image whose address carries the conversation or secrets, sent out as it loads" }));
        }
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

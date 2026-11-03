"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanKnownCampaigns = scanKnownCampaigns;
// ABOUTME: Flags indicators of published malware campaigns against agent skills (names, hosts, addresses and accounts that only
// ABOUTME: the campaign uses): critical, or a note where the line documents detection, as security tools list them.
const scanInput_1 = require("../scanInput");
// Only indicators no ordinary skill uses: "openclaw-core" and "AuthTool" also appear in the campaign but are common names.
const CAMPAIGNS = [
    {
        name: "ClawHavoc",
        source: "Koi Security, February 2026; samples in the openclaw/skills archive",
        indicators: /\bopenclawcli\b|\bdownload\.setup-service\.com\b|\binstall\.app-distribution\.net\b|\brentry\.co\/openclaw|\b91\.92\.242\.30\b|\bgithub\.com\/(ddoy233|denboss99)\b/,
    },
];
// A line that calls the indicator what it is (a C2 address, an IOC, malware, the campaign by name) is a security write-up: the
// campaign's own skills present it as an ordinary prerequisite.
const NAMES_THE_THREAT = /\b(c2|c&c|iocs?|indicators?|malicious|malware|campaign|campanha|campaña|clawhavoc)\b/;
function scanKnownCampaigns(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        for (const campaign of CAMPAIGNS) {
            if (!campaign.indicators.test(text))
                continue;
            findings.push((0, scanInput_1.findingAt)(input, line, (0, scanInput_1.documentaryContext)(input, line, text) || NAMES_THE_THREAT.test(text)
                ? { severity: "info", category: "known-campaign", detail: `Names an indicator of the ${campaign.name} malware campaign in text about detecting it (${campaign.source})` }
                : { severity: "critical", category: "known-campaign", detail: `Matches the ${campaign.name} malware campaign against agent skills (${campaign.source})` }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanConcealment = scanConcealment;
// ABOUTME: Flags text telling the agent to hide what it does from the user ("do not tell the
// ABOUTME: user") and <IMPORTANT>/<system>-style blocks, the usual wrapper for instructions
// ABOUTME: smuggled into an MCP tool description. Warnings: measure before treating as critical.
const scanInput_1 = require("../scanInput");
const NEG = "(do\\s+not|don'?t|never)";
const HIDE_FROM_USER = [
    new RegExp(`\\b${NEG}\\s+(tell|inform|notify|alert|warn)\\s+the\\s+user\\b`),
    new RegExp(`\\b${NEG}\\s+(mention|reveal|disclose)\\s+(this|it|that)\\s+(to|with)\\s+the\\s+user\\b`),
    new RegExp(`\\b${NEG}\\s+(mention|reveal|disclose|say)\\s+that\\s+you\\b`),
    /\bwithout\s+(telling|informing|notifying|alerting)\s+the\s+user\b/,
    /\b(hide|conceal|keep)\s+(this|it|that)\s+(hidden\s+|secret\s+)?from\s+the\s+user\b/,
    /\bthe\s+user\s+(must|should|need)\s*(not|n't)\s+(know|see|notice|be\s+told|find\s+out)\b/,
];
const HIDDEN_BLOCK = /<\s*(important|system|secret|hidden|admin)\s*>/;
function scanConcealment(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        if (HIDE_FROM_USER.some((re) => re.test(text))) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "concealment", detail: "Tells the agent to keep something from the user" }));
        }
        const block = text.match(HIDDEN_BLOCK);
        if (block) {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "concealment",
                detail: `Contains a <${block[1]}> block, a common wrapper for instructions hidden in a tool description`,
            }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

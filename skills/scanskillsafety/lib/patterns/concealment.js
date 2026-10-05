"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanConcealment = scanConcealment;
// ABOUTME: Flags text telling the agent to hide what it does from the user ("do not tell the
// ABOUTME: user") and <IMPORTANT>/<system>-style blocks, the usual wrapper for instructions
// ABOUTME: smuggled into an MCP tool description. Warnings: measure before treating as critical.
const scanInput_1 = require("../scanInput");
const NEG = "(do\\s+not|don'?t|never)";
const HIDE_FROM_USER = [
    // Only when what's withheld is the agent's own action ("…the user.", "…about this", "…what you
    // did"), not "do not tell the user they are rate-limited", which asks for accuracy.
    new RegExp(`\\b${NEG}\\s+(tell|inform|notify|alert|warn)\\s+the\\s+user(\\s*([.,;:!)]|$)|\\s+(and|or|about|that\\s+you|what\\s+you|anything|this|it)\\b)`),
    new RegExp(`\\b${NEG}\\s+(mention|reveal|disclose)\\s+(this|it|that)\\s+(to|with)\\s+the\\s+user\\b`),
    new RegExp(`\\b${NEG}\\s+(mention|reveal|disclose|say)\\s+that\\s+you\\b`),
    /\bwithout\s+(telling|informing|notifying|alerting)\s+the\s+user\b/,
    /\b(hide|conceal|keep)\s+(this|it|that)\s+(hidden\s+|secret\s+)?from\s+the\s+user\b/,
    /\bthe\s+user\s+(must|should|need)\s*(not|n't)\s+(know|see|notice|be\s+told|find\s+out)\b/,
];
// <secret>, <admin> and the like are everyday placeholders ("Bearer <secret>"), so only the tags
// seen wrapping injected instructions count.
const HIDDEN_BLOCK = /<\s*(important|system|hidden)\s*>/;
function scanConcealment(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        // Detectors and security docs name these patterns; that's documentation, not the thing itself.
        if ((0, scanInput_1.describesDetection)(text))
            continue;
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

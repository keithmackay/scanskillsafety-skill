"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HIDDEN_BLOCK = exports.HIDE_FROM_USER = void 0;
exports.scanConcealment = scanConcealment;
// ABOUTME: Flags text telling the agent to hide what it does from the user ("do not tell the
// ABOUTME: user") and <IMPORTANT>/<system>-style blocks, the usual wrapper for instructions
// ABOUTME: smuggled into an MCP tool description, and orders to the agent in an HTML comment. Warnings: measure before treating as critical.
const scanInput_1 = require("../scanInput");
const NEG = "(do\\s+not|don'?t|never)";
exports.HIDE_FROM_USER = [
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
exports.HIDDEN_BLOCK = /<\s*(important|system|hidden)\s*>/;
// An HTML comment is not shown when the Markdown renders, but the agent reads it. Orders to the agent there, or a new identity
// for it, are hidden from the person installing the skill; notes to maintainers ("you must update the badge") are not.
const HTML_COMMENT = /<!--([\s\S]*?)-->/g;
const ORDERS_AGENT = /\b(the\s+(agent|assistant|model)|claude)\s+(must|should|shall)\b|\byou\s+are\s+now\b|\bpersona\b|\bdisregard\b|\bignore\s+(all|previous|prior)\b|\bsystem\s+prompt\b|\bunrestricted\b/;
function hiddenCommentOrders(input) {
    const findings = [];
    for (const match of input.normalized.text.matchAll(HTML_COMMENT)) {
        const offset = match.index ?? 0;
        const entry = (0, scanInput_1.normalizedLineAt)(input, offset);
        if (!entry || !ORDERS_AGENT.test(match[1]))
            continue;
        // Inside a code block or inline code, the comment renders as visible text.
        const inInlineCode = (entry.text.slice(0, offset - entry.start).match(/`/g) ?? []).length % 2 === 1;
        if (input.fencedLines.has(entry.line) || inInlineCode)
            continue;
        findings.push((0, scanInput_1.findingAt)(input, entry.line, { severity: "warning", category: "concealment", detail: "Gives the agent orders in an HTML comment, which the rendered page hides from a reader" }));
    }
    return findings;
}
function scanConcealment(input) {
    const findings = hiddenCommentOrders(input);
    for (const { line, text } of input.normalized.lines) {
        // Detectors and security docs name these patterns; that's documentation, not the thing itself.
        if ((0, scanInput_1.describesDetection)(text))
            continue;
        if (exports.HIDE_FROM_USER.some((re) => re.test(text))) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "concealment", detail: "Tells the agent to keep something from the user" }));
        }
        const block = text.match(exports.HIDDEN_BLOCK);
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

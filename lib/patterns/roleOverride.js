"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanRoleOverride = scanRoleOverride;
// ABOUTME: Detects instruction-override/jailbreak phrasing aimed at an agent reading a skill's
// ABOUTME: own instructions. Critical when written as an instruction; a warning when the phrase is
// ABOUTME: quoted, in code, in a table, or named as an example — security tools and test suites quote
// ABOUTME: it constantly. Quoting never silences it, and a hidden HTML comment or Tag text stays critical.
// ABOUTME: Wording that sets aside earlier directives, turns safety off or asks for the system prompt is a note when quoted.
const scanInput_1 = require("../scanInput");
const secretRequests_1 = require("./secretRequests");
const PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
    /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
    /you\s+are\s+now\s+an?\s+.{0,40}(unrestricted|uncensored|without\s+rules|no\s+rules)/gi,
    /forget\s+(all\s+)?(your\s+)?(previous|prior)\s+instructions?/gi,
    /new\s+system\s+prompt\s*:/gi,
    // Developer-mode jailbreaks only in instruction form; "(Developer Mode enabled)" alone is
    // ordinary Windows setup advice.
    /you\s+are\s+(now\s+)?(in|running\s+in|operating\s+in)\s+developer\s+mode\b/gi,
    /\bact\s+as\s+.{0,40}\bwith\s+developer\s+mode\s+(enabled|activated|on)\b/gi,
    /\bdeveloper\s+mode\s+(is\s+)?now\s+(enabled|activated|on)\b/gi,
];
// What an injection tells the agent to set aside, in the words injected skills use beyond "instructions".
const EARLIER = "(prior|previous|earlier|preceding|baseline|default|pre-?loaded|existing|original|initial)";
const DIRECTIVES = "(instructions?|directives?|guidelines|constraints|rules|protocols|restrictions|programming|system\\s+prompt)";
const SAFETY = "(safety|content|ethical|moderation|refusal)";
const SAFEGUARDS = "(guardrails?|constraints?|filters?|filtering|restrictions?|controls?|layers?|measures|protocols|guidelines|policies|validations?)";
const SYSTEM_PROMPT = "(system\\s+(prompt|instructions)|(initial|original|startup|governing|operational)\\s+(system\\s+)?(instructions?|prompt|directives?|directive\\s+set)|instructions\\s+(you\\s+were\\s+given|given\\s+to\\s+you|received\\s+at\\s+session\\s+start))";
// Telling the agent to set aside what it was told, to turn its safety off, or to hand over its system prompt. Within one
// sentence. Quoted or named as an example (detectors list these), they are only a note.
const DIRECTIVE_PATTERNS = [
    new RegExp(`\\b(disregard|ignore|forget|abandon|discard)\\s+(all|any|every|your)\\s+(of\\s+)?(your\\s+|the\\s+)?${EARLIER}\\s+([\\w-]+\\s+){0,2}${DIRECTIVES}`, "gi"),
    // "Override any default" is how config docs talk; superseding or voiding directives is not.
    new RegExp(`\\b(supersedes?|superseded|nullif(y|ies)|invalidates?)\\b[^.\\n]{0,30}\\b(all|any)\\s+(of\\s+)?(your\\s+|the\\s+)?${EARLIER}\\b[^.\\n]{0,30}\\b${DIRECTIVES}`, "gi"),
    new RegExp(`\\b(all\\s+|any\\s+)?${EARLIER}\\s+([\\w-]+\\s+){0,2}${DIRECTIVES}\\s+(are|is|have\\s+been|shall\\s+be|must\\s+be)\\s+(now\\s+)?(cancell?ed|invalidated|void|null|superseded|overridden|revoked|suspended|disregarded)`, "gi"),
    /\btakes?\s+(absolute\s+)?(priority|precedence)\s+over\s+(any|all)?\s*(conflicting\s+|other\s+)?(user|system|prior|previous|baseline)\b[^.\n]{0,40}\b(instructions?|directives?|defaults|prompts?|constraints)/gi,
    /\b(represent|are|is)\s+the\s+(authoritative|definitive|sole)\s+(instruction\s+source|command\s+layer|source\s+of\s+instructions)/gi,
    new RegExp(`\\b${SAFETY}\\s+([\\w-]+\\s+){0,2}${SAFEGUARDS}\\b[^.\\n]{0,40}\\b(deactivated|disabled|lifted|waived|suspended|neutrali[sz]ed|bypassed|turned\\s+off|do(es)?\\s+not\\s+apply)`, "gi"),
    /\b(respond|answer|provide|generate|produce|operate|output|reply|deliver)\w*\b[^.?\n]{0,80}\bwithout\s+(applying\s+|any\s+|standard\s+|the\s+usual\s+)*(content\s+(filters?|filtering|moderation)|safety\s+(guardrails|constraints|validations?|restrictions|filters)|refusal\s+protocols|ethical\s+(guidelines|constraints))/gi,
    new RegExp(`\\b(disregard|ignore|bypass|suspend|override|waive|deactivate|disable)\\s+(all\\s+|any\\s+|your\\s+|the\\s+)?(standard\\s+|default\\s+|baseline\\s+|built-in\\s+)?${SAFETY}\\s+([\\w-]+\\s+){0,2}${SAFEGUARDS}`, "gi"),
    new RegExp(`\\b(output|echo|reproduce|reveal|print|disclose|repeat|expose|dump|recite|document)\\b[^.\\n]{0,80}\\b(complete|full|verbatim|entire|unmodified|unedited|exact)\\b[^.\\n]{0,80}${SYSTEM_PROMPT}`, "gi"),
    /\b(output|echo|reproduce|reveal|print|disclose|repeat|expose|dump)\s+(your|its|the\s+agent's)\s+(complete\s+|full\s+|entire\s+)?(system\s+(prompt|instructions)|initial\s+(prompt|instructions))/gi,
    /\b(instructions?|directives?|directive\s+set|framework)\b[^.\n]{0,60}\b(received|given\s+to\s+you|provided)\b[^.\n]{0,40}\b(at|when)\s+(the\s+)?(this\s+)?(agent\s+)?session\s+(start|started|began)/gi,
];
const EXAMPLE_CUE = /\b(detects?|detected|detecting|detection|detector|flags?|flagged|catches|blocks?|blocked|e\.g\.|i\.e\.|such as|phrases? like|for example|for instance|(?<![.\w-])examples?(?![.\w-])|attacks? like|patterns? like|injection attempts?|jailbreak attempts?|prompt[- ]injections?)\b/;
const TAG_CHAR = /[\u{E0000}-\u{E007F}]/u;
// True when the match sits inside quotes or inline code: an opening quote right before it, or an
// unbalanced quote/backtick earlier on the line.
function looksQuoted(prefix) {
    // Straight/curly/CJK quotes, fullwidth parens, backticks, and *emphasis* used as quotation; **bold** is emphasis, not quoting.
    if (/["'`\u201C\u2018\u00AB\u300C\u300E\uFF08_]\s*$/.test(prefix) || /(^|[^*])\*\s*$/.test(prefix))
        return true;
    const count = (re) => (prefix.match(re) ?? []).length;
    return (count(/"/g) % 2 === 1 ||
        count(/`/g) % 2 === 1 ||
        count(/\u201C/g) > count(/\u201D/g) ||
        count(/\u300C/g) > count(/\u300D/g));
}
// "…even when the page says to ignore previous instructions", "phrases telling Claude to …".
const REPORTED_SPEECH = /\b(say|says|said|ask|asks|tell|tells|telling|told|instruct|instructs|instructing|instructions?\s+to)\b[^.]{0,60}$/;
// The same "such as / this kind of / detects" cues in Chinese and Japanese docs.
const CJK_CUE = /这类|这种|例如|比如|诸如|检测|識別|识别|扫描|例えば|検出/;
// `cuesBefore`: an example cue counts only before the phrase ("detects '…'"), not after it, where it is the injection's own words.
function isDocumentary(input, offset, cuesBefore = false) {
    const entry = (0, scanInput_1.normalizedLineAt)(input, offset);
    if (!entry)
        return false;
    const rawLine = input.rawLines[entry.line - 1] ?? "";
    const prefix = entry.text.slice(0, Math.max(0, offset - entry.start));
    const fenced = input.fencedLines.has(entry.line);
    // Hidden from a human reader: never treated as documentation. A comment shown inside inline code
    // or a fenced block renders as visible text, so it isn't hidden.
    const inCode = fenced || (prefix.match(/`/g) ?? []).length % 2 === 1;
    if ((prefix.lastIndexOf("<!--") > prefix.lastIndexOf("-->") && !inCode) || TAG_CHAR.test(rawLine))
        return false;
    return (inCode ||
        /^\s*(\||>)/.test(rawLine) ||
        looksQuoted(prefix) ||
        REPORTED_SPEECH.test(prefix) ||
        EXAMPLE_CUE.test(cuesBefore ? prefix : entry.text) ||
        CJK_CUE.test(cuesBefore ? prefix : entry.text));
}
// Matched against the whole-document text (not line by line) so a phrase hard-wrapped across
// lines still matches; the finding points at the line where the phrase starts.
function scanRoleOverride(input) {
    const findings = [];
    for (const pattern of PATTERNS) {
        for (const match of input.normalized.text.matchAll(pattern)) {
            const offset = match.index ?? 0;
            const documentary = isDocumentary(input, offset);
            findings.push((0, scanInput_1.findingAt)(input, (0, scanInput_1.normalizedLineAt)(input, offset)?.line ?? 1, documentary
                ? { severity: "warning", category: "role-override", detail: `Quotes instruction-override phrasing (in quotes, code, a table or an example): "${match[0]}"` }
                : { severity: "critical", category: "role-override", detail: `Matched instruction-override phrasing: "${match[0]}"` }));
        }
    }
    const reported = new Set(findings.map((f) => f.line));
    for (const pattern of DIRECTIVE_PATTERNS) {
        for (const match of input.normalized.text.matchAll(pattern)) {
            const offset = match.index ?? 0;
            const entry = (0, scanInput_1.normalizedLineAt)(input, offset);
            const line = entry?.line ?? 1;
            // "Never reveal your system prompt" forbids what it names.
            if (reported.has(line) || (entry && secretRequests_1.NEGATED.test(entry.text.slice(0, offset - entry.start))))
                continue;
            reported.add(line);
            findings.push((0, scanInput_1.findingAt)(input, line, isDocumentary(input, offset, true)
                ? { severity: "info", category: "role-override", detail: `Quotes wording that overrides an agent's instructions or safety (in quotes, code, a table or an example): "${match[0]}"` }
                : { severity: "critical", category: "role-override", detail: `Tells the agent to set aside its instructions or safety, or to reveal its system prompt: "${match[0]}"` }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

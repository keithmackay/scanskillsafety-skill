"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSecretRequest = exports.NEGATED = void 0;
exports.scanSecretRequests = scanSecretRequests;
// ABOUTME: Flags text asking the agent to read, collect or send credentials (key files, cloud and registry logins, "all API keys"):
// ABOUTME: critical when it names somewhere to send them or keeps it from the user, as poisoned tool descriptions do.
const scanInput_1 = require("../scanInput");
const credentialFiles_1 = require("./credentialFiles");
const concealment_1 = require("./concealment");
// A credential file, a private key by name, a .env file in the home folder, or credentials in bulk ("tokens" alone is as often
// a cryptocurrency).
const CREDENTIALS = new RegExp([
    credentialFiles_1.CREDENTIAL_FILE.source,
    "\\bid_(rsa|dsa|ecdsa|ed25519)\\b(?![\\w.]*\\.pub)",
    "~\\/[\\w./-]*\\.env\\b",
    "\\b(all|every|any)\\s+(of\\s+the\\s+|the\\s+)?(environment\\s+variables|env\\s+vars|api\\s+keys?|access\\s+tokens|secrets|credentials|passwords|private\\s+keys)\\b",
    "\\bvariables?\\s+(named|containing|matching|like)\\b[^.]{0,40}\\b(token|key|secret|password)",
].join("|"));
// What the agent is told to do, in the imperative: "reads credentials from …" describes a tool, "read …" instructs.
const TAKES = /\b(read|cat|open|collect|gather|harvest|grab|extract|dump|list|print|output|include|copy|upload|send|exfiltrate|retrieve|look\s+for|search\s+for|find)\b/g;
// "Do **not** directly read …", "does not persist, upload, or transmit …".
exports.NEGATED = /\b(never|not|n't|no|without)\b[^.;!?]{0,40}$/;
// Somewhere for them to go: sent to a place, or slipped into a tool call's argument ("pass its content as 'sidenote'").
const SENDS = /\b(send|post|upload|forward|transmit|exfiltrat\w*|deliver|report)\w*\b[^.]{0,80}?\b(to|into)\b|\b(pass|put|include|add|append|attach)\b[^.]{0,60}\b(as|in|into)\b|https?:\/\//;
const NEAR = 3;
const CRITICAL_DETAIL = "Tells the agent to read credentials and send them somewhere or keep it from the user";
const WARNING_DETAIL = "Shows text telling the agent to read credentials and send them somewhere";
// A finding of this rule. Code that reads a credential file is judged by the code rules, so the script scan leaves these out.
const isSecretRequest = (finding) => finding.detail === CRITICAL_DETAIL || finding.detail === WARNING_DETAIL;
exports.isSecretRequest = isSecretRequest;
const QUOTED = /`[^`]*`|"[^"]*"/g;
// The request for credentials on a line, if any: an imperative verb, not negated, followed by credentials in the same sentence;
// and whether the verb sits inside quotes or a code span, as an example an article or detector quotes does.
function credentialRequest(text) {
    const quotes = [...text.matchAll(QUOTED)].map((m) => [m.index, m.index + m[0].length]);
    let offset = 0;
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        const start = text.indexOf(sentence, offset);
        offset = start + sentence.length;
        for (const verb of sentence.matchAll(TAKES)) {
            if (exports.NEGATED.test(sentence.slice(0, verb.index)))
                continue;
            const request = sentence.slice(verb.index);
            if (!CREDENTIALS.test(request))
                continue;
            const at = start + verb.index;
            return { request, quoted: quotes.some(([from, to]) => at > from && at < to) };
        }
    }
    return null;
}
function scanSecretRequests(input) {
    const lines = input.normalized.lines;
    const concealing = (i) => lines.slice(Math.max(0, i - NEAR), i + NEAR + 1).some(({ text }) => concealment_1.HIDDEN_BLOCK.test(text) || concealment_1.HIDE_FROM_USER.some((re) => re.test(text)));
    const findings = [];
    lines.forEach(({ line, text }, i) => {
        if ((0, scanInput_1.describesDetection)(text))
            return;
        const found = credentialRequest(text);
        if (found === null)
            return;
        const { request, quoted } = found;
        // Reading credentials alone is what setup docs show ("cat ~/.x/.env", "list all secrets in the vault"); sending them on, or
        // keeping it from the user, is what a poisoned tool description asks.
        if (!SENDS.test(request) && !concealing(i))
            return;
        // Quotes, tables, blockquotes and sample output show an attack rather than make one.
        findings.push((0, scanInput_1.findingAt)(input, line, quoted || (0, scanInput_1.documentaryContext)(input, line, text)
            ? { severity: "warning", category: "exfiltration", detail: WARNING_DETAIL }
            : { severity: "critical", category: "exfiltration", detail: CRITICAL_DETAIL }));
    });
    return (0, scanInput_1.capFindings)(findings);
}

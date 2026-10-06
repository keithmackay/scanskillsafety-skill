"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSecrets = scanSecrets;
// ABOUTME: Flags hardcoded-credential-shaped strings (cloud, GitHub, Slack, and AI-provider API
// ABOUTME: key formats, PEM private key headers) — a skill's own manifest/README has no legitimate
// ABOUTME: reason to contain a real secret, so a match is critical. Documentation placeholders
// ABOUTME: (ghp_XXXX…, xoxp-your-user-token, AKIA…EXAMPLE) are recognized and skipped.
const scanInput_1 = require("../scanInput");
const secretPatterns_1 = require("../secretPatterns");
const AWS_SECRET_NEARBY = /secret[_ -]?(access[_ -]?)?key/;
function scanSecrets(input) {
    const findings = [];
    const lines = input.normalized.lines;
    lines.forEach(({ line, text }, i) => {
        const nextLine = lines[i + 1]?.text ?? "";
        for (const { name, pattern } of secretPatterns_1.SECRET_PATTERNS) {
            for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
                const restOfLine = text.slice((match.index ?? 0) + match[0].length);
                if ((0, secretPatterns_1.isPlaceholderSecret)(match[0], nextLine, restOfLine))
                    continue;
                // An AWS access key ID alone (e.g. in a presigned S3 URL) isn't a usable credential; it's
                // critical only with a secret access key on the same or a neighbouring line.
                const lonelyAwsKeyId = name === "AWS access key ID" && !AWS_SECRET_NEARBY.test([lines[i - 1]?.text, text, nextLine].join(" "));
                findings.push((0, scanInput_1.findingAt)(input, line, (0, scanInput_1.documentaryContext)(input, line, text)
                    ? { severity: "warning", category: "secrets", detail: `Shows what looks like a ${name} as sample output or input to a scanner` }
                    : lonelyAwsKeyId
                        ? { severity: "warning", category: "secrets", detail: "Contains what looks like an AWS access key ID (no secret access key next to it)" }
                        : { severity: "critical", category: "secrets", detail: `Contains what looks like a hardcoded ${name}` }));
                break;
            }
        }
    });
    return (0, scanInput_1.capFindings)(findings);
}

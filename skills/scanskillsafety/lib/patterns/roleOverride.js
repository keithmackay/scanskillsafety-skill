"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanRoleOverride = scanRoleOverride;
// ABOUTME: Detects instruction-override/jailbreak phrasing aimed at an agent reading a skill's
// ABOUTME: own instructions rather than at a human reader — the clearest static signal of a
// ABOUTME: prompt-injection attempt embedded in a skill's manifest or README.
const scanInput_1 = require("../scanInput");
const PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
    /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
    /you\s+are\s+now\s+an?\s+.{0,40}(unrestricted|uncensored|without\s+rules|no\s+rules)/gi,
    /forget\s+(all\s+)?(your\s+)?(previous|prior)\s+instructions?/gi,
    /new\s+system\s+prompt\s*:/gi,
    /developer\s+mode\s+(enabled|activated)/gi,
];
// Matched against the whole-document text (not line by line) so a phrase hard-wrapped across
// lines still matches; the finding points at the line where the phrase starts.
function scanRoleOverride(input) {
    const findings = [];
    for (const pattern of PATTERNS) {
        for (const match of input.normalized.text.matchAll(pattern)) {
            findings.push((0, scanInput_1.findingAt)(input, (0, scanInput_1.lineAtOffset)(input, match.index ?? 0), {
                severity: "critical",
                category: "role-override",
                detail: `Matched instruction-override phrasing: "${match[0]}"`,
            }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

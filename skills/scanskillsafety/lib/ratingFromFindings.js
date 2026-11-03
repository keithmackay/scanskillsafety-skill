"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ratingFromFindings = ratingFromFindings;
// ABOUTME: Derives the red/yellow/green rating from a listing's current findings: any critical
// ABOUTME: finding is red, any warning is yellow, otherwise green. Notes and dismissed findings do not count.
const applyVerdicts_1 = require("./applyVerdicts");
// A finding judged less severe after review counts at the severity the review gave it.
function ratingFromFindings(findings) {
    const severities = findings.map(applyVerdicts_1.effectiveSeverity);
    if (severities.includes("critical"))
        return "red";
    return severities.includes("warning") ? "yellow" : "green";
}

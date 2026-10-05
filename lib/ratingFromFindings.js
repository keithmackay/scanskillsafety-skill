"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ratingFromFindings = ratingFromFindings;
function ratingFromFindings(findings, dismissedCategories = []) {
    const counted = findings.filter((f) => !dismissedCategories.includes(f.category));
    if (counted.some((f) => f.severity === "critical"))
        return "red";
    return counted.length > 0 ? "yellow" : "green";
}

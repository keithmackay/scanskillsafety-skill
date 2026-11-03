"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findingKey = exports.verdictKey = void 0;
exports.applyVerdicts = applyVerdicts;
exports.effectiveSeverity = effectiveSeverity;
exports.disputableCategories = disputableCategories;
const REVIEWED_SOURCES = ["scanner", "scripts"];
const verdictKey = (v) => JSON.stringify([v.source, v.file, v.category, v.excerpt]);
exports.verdictKey = verdictKey;
const findingKey = (f) => (0, exports.verdictKey)({ source: f.source, file: f.file ?? "", category: f.category, excerpt: f.excerpt ?? "" });
exports.findingKey = findingKey;
const REVIEW_VERDICT = { dismiss: "dismissed", warning: "warning", info: "info" };
function applyVerdicts(findings, verdicts, currentHash) {
    const byKey = new Map();
    for (const v of verdicts)
        byKey.set((0, exports.verdictKey)(v), [...(byKey.get((0, exports.verdictKey)(v)) ?? []), v]);
    return findings.map((carried) => {
        const finding = { ...carried };
        delete finding.review;
        if (!REVIEWED_SOURCES.includes(finding.source))
            return finding;
        const hash = currentHash(finding.source, finding.file ?? "");
        const holding = (byKey.get((0, exports.findingKey)(finding)) ?? []).find((v) => v.contentHash === hash);
        if (!holding || holding.effect === "stands")
            return finding;
        return { ...finding, review: { verdict: REVIEW_VERDICT[holding.effect], reason: holding.reason, reviewedAt: holding.decidedAt.slice(0, 10) } };
    });
}
const RANK = { critical: 0, warning: 1, info: 2 };
// The severity a finding counts at: its own, none once dismissed, or the review's when that is lower.
function effectiveSeverity(finding) {
    const review = finding.review?.verdict;
    if (review === undefined)
        return finding.severity;
    if (review === "dismissed")
        return null;
    return RANK[review] > RANK[finding.severity] ? review : finding.severity;
}
// The categories a visitor can still appeal: every one with a finding not already dismissed after review.
function disputableCategories(findings) {
    return [...new Set((findings ?? []).filter((f) => f.review?.verdict !== "dismissed").map((f) => f.category))];
}

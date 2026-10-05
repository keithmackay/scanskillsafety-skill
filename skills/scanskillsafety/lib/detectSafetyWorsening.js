"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSafetyWorsening = detectSafetyWorsening;
const RATING_RANK = { green: 0, yellow: 1, red: 2 };
const categoriesOf = (findings) => new Set(findings.map((f) => f.category));
const criticalCategoriesOf = (findings) => categoriesOf(findings.filter((f) => f.severity === "critical"));
function detectSafetyWorsening(before, after) {
    if (before.rating === null || after.rating === null)
        return null;
    const ratingWorsened = RATING_RANK[after.rating] > RATING_RANK[before.rating];
    const criticalBefore = criticalCategoriesOf(before.findings);
    const newCritical = [...criticalCategoriesOf(after.findings)].some((category) => !criticalBefore.has(category));
    if (!ratingWorsened && !newCritical)
        return null;
    const categoriesBefore = categoriesOf(before.findings);
    return { addedCategories: [...categoriesOf(after.findings)].filter((category) => !categoriesBefore.has(category)) };
}

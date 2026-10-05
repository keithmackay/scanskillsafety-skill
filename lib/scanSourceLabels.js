"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCAN_SOURCE_LABEL = void 0;
exports.scanSourceFor = scanSourceFor;
exports.greenBadgeLabel = greenBadgeLabel;
exports.SCAN_SOURCE_LABEL = {
    description: "description only",
    manifest: "manifest only",
    readme: "README only",
    "manifest+readme": "manifest and README",
};
function scanSourceFor(available) {
    if (available.manifest && available.readme)
        return "manifest+readme";
    if (available.manifest)
        return "manifest";
    if (available.readme)
        return "readme";
    return "description";
}
// A scanned listing with no recorded source predates receipts, and every such scan was of the
// description only.
function greenBadgeLabel(source) {
    switch (source ?? "description") {
        case "manifest+readme":
            return "No issues found";
        case "manifest":
            return "No issues found in manifest — README not scanned";
        case "readme":
            return "No issues found in README — no manifest scanned";
        default:
            return "No issues found in description — full text not yet scanned";
    }
}

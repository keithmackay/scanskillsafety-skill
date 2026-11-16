"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNSCANNED_LABEL = exports.AGENT_TOOL_GREEN_LABEL = exports.RATING_LABEL = void 0;
exports.compactRatingLabel = compactRatingLabel;
exports.RATING_LABEL = {
    yellow: "Review suggested",
    red: "Flagged",
};
const GREEN_LABEL = {
    description: "No issues in description",
    manifest: "No issues in manifest",
    readme: "No issues in README",
    "manifest+readme": "No issues found",
};
// An agent tool's README is read for its install steps; the software itself is not reviewed.
exports.AGENT_TOOL_GREEN_LABEL = "No issues in install steps";
exports.UNSCANNED_LABEL = "Not yet scanned";
// A scan with no recorded source predates receipts, and every such scan was of the description only.
function compactRatingLabel(rating, source, agentTool) {
    if (rating === null)
        return exports.UNSCANNED_LABEL;
    if (rating !== "green")
        return exports.RATING_LABEL[rating];
    const read = source ?? "description";
    return agentTool && read === "readme" ? exports.AGENT_TOOL_GREEN_LABEL : GREEN_LABEL[read];
}

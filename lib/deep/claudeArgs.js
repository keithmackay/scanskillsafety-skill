"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claudeReviewArgs = claudeReviewArgs;
function claudeReviewArgs({ model, systemPrompt, schema }) {
    return [
        "-p", "--model", model, "--safe-mode", "--tools", "", "--strict-mcp-config", "--no-session-persistence",
        "--system-prompt", systemPrompt, "--output-format", "json", "--json-schema", JSON.stringify(schema),
    ];
}

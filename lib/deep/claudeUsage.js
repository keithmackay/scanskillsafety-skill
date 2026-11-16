"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyClaudeUsage = void 0;
exports.addClaudeReply = addClaudeReply;
exports.formatClaudeUsage = formatClaudeUsage;
const emptyClaudeUsage = () => ({
    calls: 0, unreported: 0, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, listPriceUsd: 0,
});
exports.emptyClaudeUsage = emptyClaudeUsage;
function addClaudeReply(tally, stdout) {
    tally.calls++;
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        tally.unreported++;
        return;
    }
    const usage = parsed.usage;
    if (!usage) {
        tally.unreported++;
        return;
    }
    tally.inputTokens += usage.input_tokens ?? 0;
    tally.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
    tally.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    tally.outputTokens += usage.output_tokens ?? 0;
    tally.listPriceUsd += parsed.total_cost_usd ?? 0;
}
function formatClaudeUsage(u) {
    const n = (x) => x.toLocaleString("en-US");
    const input = u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens;
    return (`Claude tokens: ${n(input)} input (${n(u.inputTokens)} uncached, ${n(u.cacheWriteTokens)} cache writes, ${n(u.cacheReadTokens)} cache reads) ` +
        `and ${n(u.outputTokens)} output in ${n(u.calls)} calls${u.unreported ? ` (${n(u.unreported)} reported none)` : ""}; ` +
        `$${u.listPriceUsd.toFixed(2)} at API list prices.`);
}

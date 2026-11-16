"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.excerpt = void 0;
exports.readCliReply = readCliReply;
const excerpt = (text) => text.trim().slice(0, 200);
exports.excerpt = excerpt;
function readCliReply(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return { ok: false, error: `not JSON: ${(0, exports.excerpt)(stdout)}` };
    }
    if (parsed.stop_reason === "refusal")
        return { ok: false, refused: true, error: (0, exports.excerpt)(parsed.result ?? "the model refused") };
    if (parsed.is_error)
        return { ok: false, error: (0, exports.excerpt)(parsed.result ?? `the CLI reported an error (${parsed.subtype ?? "no kind given"})`) };
    if (!parsed.structured_output || typeof parsed.structured_output !== "object") {
        return { ok: false, error: `no structured output: ${(0, exports.excerpt)(parsed.result ?? "")}` };
    }
    return { ok: true, output: parsed.structured_output };
}

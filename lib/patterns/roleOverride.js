"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanRoleOverride = scanRoleOverride;
const PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
    /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
    /you\s+are\s+now\s+an?\s+.{0,40}(unrestricted|uncensored|without\s+rules|no\s+rules)/i,
    /forget\s+(all\s+)?(your\s+)?(previous|prior)\s+instructions?/i,
    /new\s+system\s+prompt\s*:/i,
    /developer\s+mode\s+(enabled|activated)/i,
];
function scanRoleOverride(text) {
    for (const pattern of PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            return [{ severity: "critical", category: "role-override", detail: `Matched instruction-override phrasing: "${match[0]}"` }];
        }
    }
    return [];
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanDestructiveCommands = scanDestructiveCommands;
const PATTERNS = [
    { detail: "Runs `rm -rf` against a root or home-directory path", pattern: /rm\s+-rf\s+(\/(?=[^a-z0-9._-])|\/$|~)/i },
    { detail: "Pipes a downloaded script directly into a shell (curl | sh / wget | bash)", pattern: /(curl|wget)\s+.*\|\s*(sh|bash|zsh)\b/i },
    { detail: "Sets world-writable permissions on a root path (chmod 777 /)", pattern: /chmod\s+(-r\s+)?777\s+\/\s*$/i },
    { detail: "Matches a classic shell fork-bomb pattern", pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/ },
];
function scanDestructiveCommands(text) {
    for (const { detail, pattern } of PATTERNS) {
        if (pattern.test(text)) {
            return [{ severity: "warning", category: "destructive-commands", detail }];
        }
    }
    return [];
}

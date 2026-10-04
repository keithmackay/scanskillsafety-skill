"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanText = scanText;
// ABOUTME: Static safety scanner entry point — normalizes text, runs every pattern category
// ABOUTME: against it, and derives a red/yellow/green rating from the worst finding severity.
// ABOUTME: Pure function: no DB, no network, no filesystem — safe to bundle standalone (see the
// ABOUTME: downloadable-skill phase of docs/plans/safety-scan-implementation-plan.md) and to run
// ABOUTME: directly against untrusted crawled text.
const normalizeForScan_1 = require("./normalizeForScan");
const roleOverride_1 = require("./patterns/roleOverride");
const exfiltration_1 = require("./patterns/exfiltration");
const obfuscation_1 = require("./patterns/obfuscation");
const secrets_1 = require("./patterns/secrets");
const destructiveCommands_1 = require("./patterns/destructiveCommands");
function scanText(rawText) {
    const { text, invisibleCharCount, homoglyphCount } = (0, normalizeForScan_1.normalizeForScan)(rawText);
    const findings = [
        ...(0, roleOverride_1.scanRoleOverride)(text),
        ...(0, exfiltration_1.scanExfiltration)(text),
        // Uses the original casing (not the lowercased `text`) — the base64 heuristic relies on
        // upper/lowercase mix to distinguish a real encoded payload from a lowercased false
        // positive like a long slash-separated word list.
        ...(0, obfuscation_1.scanObfuscation)(rawText, { invisibleCharCount, homoglyphCount }),
        ...(0, secrets_1.scanSecrets)(text),
        ...(0, destructiveCommands_1.scanDestructiveCommands)(text),
    ];
    const rating = findings.some((f) => f.severity === "critical")
        ? "red"
        : findings.length > 0
            ? "yellow"
            : "green";
    return { rating, findings };
}

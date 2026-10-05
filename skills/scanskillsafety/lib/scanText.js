"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanText = scanText;
// ABOUTME: Static safety scanner entry point — normalizes text, runs every pattern category
// ABOUTME: against it, and derives a red/yellow/green rating from the worst finding severity.
// ABOUTME: Pure function: no DB, no network, no filesystem — safe to bundle into the standalone
// ABOUTME: scanskillsafety skill and to run directly against untrusted crawled text.
const scanInput_1 = require("./scanInput");
const roleOverride_1 = require("./patterns/roleOverride");
const exfiltration_1 = require("./patterns/exfiltration");
const obfuscation_1 = require("./patterns/obfuscation");
const secrets_1 = require("./patterns/secrets");
const destructiveCommands_1 = require("./patterns/destructiveCommands");
const installScript_1 = require("./patterns/installScript");
const suspiciousDownload_1 = require("./patterns/suspiciousDownload");
const remoteAccess_1 = require("./patterns/remoteAccess");
const concealment_1 = require("./patterns/concealment");
const ratingFromFindings_1 = require("./ratingFromFindings");
function scanText(rawText) {
    const input = (0, scanInput_1.prepareScanInput)(rawText);
    const secrets = (0, secrets_1.scanSecrets)(input);
    const secretLines = new Set(secrets.map((f) => f.line));
    const scannerFindings = [
        ...(0, roleOverride_1.scanRoleOverride)(input),
        ...(0, exfiltration_1.scanExfiltration)(input),
        // A long token like github_pat_… also looks like a base64 blob; report it once, as a secret.
        ...(0, obfuscation_1.scanObfuscation)(input).filter((f) => f.line === undefined || !secretLines.has(f.line)),
        ...secrets,
        ...(0, destructiveCommands_1.scanDestructiveCommands)(input),
        ...(0, installScript_1.scanInstallScript)(input),
        ...(0, suspiciousDownload_1.scanSuspiciousDownload)(input),
        ...(0, remoteAccess_1.scanRemoteAccess)(input),
        ...(0, concealment_1.scanConcealment)(input),
    ];
    const findings = scannerFindings.map((f) => ({ ...f, source: "scanner" }));
    return { rating: (0, ratingFromFindings_1.ratingFromFindings)(findings), findings };
}

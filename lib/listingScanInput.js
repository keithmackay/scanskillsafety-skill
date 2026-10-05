"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildListingScanInput = buildListingScanInput;
// ABOUTME: Assembles the text a listing's safety scan reads (manifest, name, description, README) and names
// ABOUTME: which parts it covers, so the crawler, the full-text backfill and re-scans scan identical text.
const scanSourceLabels_1 = require("./scanSourceLabels");
function buildListingScanInput(parts) {
    const text = [parts.manifestText, parts.displayName, parts.description, parts.readmeText].filter(Boolean).join("\n");
    return { text, source: (0, scanSourceLabels_1.scanSourceFor)({ manifest: Boolean(parts.manifestText), readme: Boolean(parts.readmeText) }) };
}

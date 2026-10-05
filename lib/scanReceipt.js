"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashScannedText = hashScannedText;
exports.makeScanReceipt = makeScanReceipt;
// ABOUTME: A safety scan's receipt — which text was scanned, a hash of exactly that text, and the scanner
// ABOUTME: version — so a rating says what it covers and stale scans can be found and re-run.
const node_crypto_1 = require("node:crypto");
const scannerVersion_1 = require("./scannerVersion");
function hashScannedText(text) {
    return (0, node_crypto_1.createHash)("sha256").update(text).digest("hex");
}
function makeScanReceipt(source, scannedText) {
    return { source, hash: hashScannedText(scannedText), scannerVersion: scannerVersion_1.SCANNER_VERSION };
}

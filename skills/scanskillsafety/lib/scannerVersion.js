"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCRIPT_SCANNER_VERSION = exports.SCANNER_VERSION = void 0;
// ABOUTME: The scanner's version, stored with every rating it produces. Bump it whenever a rule or its
// ABOUTME: behaviour changes, so listings scanned by older rules can be found and re-scanned.
exports.SCANNER_VERSION = "2026-10-05.14";
// The script scan's version: the prose rules' version plus the rules only scripts get (file choice, code adjustments and
// code-only patterns). Bump the suffix when those change, so every listing's scripts are scanned again.
exports.SCRIPT_SCANNER_VERSION = `${exports.SCANNER_VERSION}+scripts.14`;

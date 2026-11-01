"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installScriptsOf = installScriptsOf;
exports.scanScriptFile = scanScriptFile;
// ABOUTME: Safety-scans one file a listing bundles (a script, hook config or MCP config) with the prose rules adjusted for code
// ABOUTME: and the code-only rules, tagging each finding with the file's path; a package.json is judged by its install scripts.
const scanText_1 = require("./scanText");
const scanInput_1 = require("./scanInput");
const codeThreats_1 = require("./patterns/codeThreats");
const codeFindings_1 = require("./codeFindings");
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];
// The install-time scripts of a package.json, one "name: command" a line; empty when there are none or it is not JSON.
function installScriptsOf(packageJson) {
    let scripts;
    try {
        scripts = JSON.parse(packageJson).scripts;
    }
    catch {
        return "";
    }
    if (!scripts || typeof scripts !== "object")
        return "";
    const named = scripts;
    return INSTALL_SCRIPTS.filter((name) => typeof named[name] === "string")
        .map((name) => `${name}: ${named[name]}`)
        .join("\n");
}
const isPackageJson = (path) => path === "package.json" || path.endsWith("/package.json");
// In these configs every string is a command or setting that runs as written, so nothing in them is quoted data.
const isConfig = (path) => /(^|\/)(hooks\.json|plugin\.json|\.mcp\.json)$/.test(path);
const codeThreats = (text) => (0, codeThreats_1.scanCodeThreats)((0, scanInput_1.prepareScanInput)(text)).map((f) => ({ ...f, source: "scanner" }));
function scanScriptFile(path, text) {
    if (isPackageJson(path)) {
        const scripts = installScriptsOf(text);
        if (scripts === "")
            return [];
        // Lines here count the extracted scripts, not the file, so they are left out.
        return [...(0, scanText_1.scanText)(scripts).findings, ...codeThreats(scripts)].map((f) => ({ ...f, line: undefined, file: path }));
    }
    const prose = (0, scanText_1.scanText)(text).findings;
    if (isConfig(path))
        return (0, codeFindings_1.oneBase64BlobPerFile)([...prose, ...codeThreats(text)]).map((f) => ({ ...f, file: path }));
    const lines = text.split(/\r?\n/);
    return (0, codeFindings_1.oneBase64BlobPerFile)([...(0, codeFindings_1.adjustForCode)(path, prose, lines), ...(0, codeFindings_1.adjustCodeThreats)(path, codeThreats(text), lines)]).map((f) => ({ ...f, file: path }));
}

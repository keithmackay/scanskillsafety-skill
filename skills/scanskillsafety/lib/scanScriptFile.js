"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installScriptsOf = installScriptsOf;
exports.scanScriptFile = scanScriptFile;
// ABOUTME: Safety-scans one file a listing bundles (a script, hook config, MCP config or Claude Code settings) with the prose rules
// ABOUTME: adjusted for code and the code-only rules, tagging each finding with its path; a package.json is judged by its install scripts.
const scanText_1 = require("./scanText");
const scanInput_1 = require("./scanInput");
const codeThreats_1 = require("./patterns/codeThreats");
const codeFindings_1 = require("./codeFindings");
const quotedSignatures_1 = require("./quotedSignatures");
const scriptFiles_1 = require("./scriptFiles");
const secretRequests_1 = require("./patterns/secretRequests");
const launchedTestFiles_1 = require("./launchedTestFiles");
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
// Tests, fixtures and examples hold sample keys; a real one there leaks its publisher's account, not the user's, so it is a warning.
const SAMPLE_FOLDER = /(^|\/)(tests?|__tests__|evals?|testdata|fixtures?|examples?|demo)\//i;
const isSampleFile = (path) => SAMPLE_FOLDER.test(path) || launchedTestFiles_1.TEST_FILE_NAME.test(path.slice(path.lastIndexOf("/") + 1));
const secretsAsWarnings = (path, findings) => isSampleFile(path) ? findings.map((f) => (f.category === "secrets" && f.severity === "critical" ? { ...f, severity: "warning" } : f)) : findings;
const isPackageJson = (path) => path === "package.json" || path.endsWith("/package.json");
// The prose rules on code, less the one reading instructions to the agent for credentials and the code rules on fenced blocks:
// the code rules judge a script's reads and run over the whole file.
const proseRules = (text) => (0, scanText_1.scanText)(text, { codeBlocks: false }).findings.filter((f) => !(0, secretRequests_1.isSecretRequest)(f));
const codeThreats = (text) => (0, codeThreats_1.scanCodeThreats)((0, scanInput_1.prepareScanInput)(text)).map((f) => ({ ...f, source: "scanner" }));
// Python runs the import lines of a .pth file in its site folder every time it starts, so code there runs without being called.
function pthStartupCode(path, text) {
    if (!/\.pth$/i.test(path))
        return [];
    const input = (0, scanInput_1.prepareScanInput)(text);
    const line = input.rawLines.findIndex((l) => /^import\s/.test(l)) + 1;
    if (line === 0)
        return [];
    return [{ ...(0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "persistence", detail: "Runs code every time Python starts (an import line in a .pth file)" }), source: "scanner" }];
}
function scanScriptFile(path, text) {
    if (isPackageJson(path)) {
        const scripts = installScriptsOf(text);
        if (scripts === "")
            return [];
        // Lines here count the extracted scripts, not the file, so they are left out.
        return [...proseRules(scripts), ...codeThreats(scripts)].map((f) => ({ ...f, line: undefined, file: path }));
    }
    const prose = proseRules(text);
    const decoded = (0, codeFindings_1.hexDecodedFindings)(text);
    // In a config every string is a command or setting that runs as written, so nothing in it is quoted data.
    if ((0, scriptFiles_1.isConfig)(path))
        return (0, codeFindings_1.oneBase64BlobPerFile)([...prose, ...codeThreats(text), ...decoded]).map((f) => ({ ...f, file: path }));
    const lines = text.split(/\r?\n/);
    const findings = [...(0, codeFindings_1.adjustForCode)(path, prose, lines), ...(0, quotedSignatures_1.quotedExfiltrationAsWarnings)(path, (0, quotedSignatures_1.adjustCodeThreats)(path, codeThreats(text), lines), lines), ...decoded, ...pthStartupCode(path, text)];
    return secretsAsWarnings(path, (0, codeFindings_1.oneBase64BlobPerFile)(findings)).map((f) => ({ ...f, file: path }));
}

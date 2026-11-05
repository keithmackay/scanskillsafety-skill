"use strict";
// ABOUTME: Chooses which files in a repository's tree a skill or plugin can run: scripts, hooks and MCP configs inside the
// ABOUTME: folders that hold a SKILL.md or plugin manifest (and the root .mcp.json), within per-file and per-listing caps.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_FILES_PER_LISTING = exports.MAX_BYTES_PER_LISTING = exports.MAX_BYTES_PER_FILE = void 0;
exports.scanRoots = scanRoots;
exports.selectScriptFiles = selectScriptFiles;
// Only this much of a file is read, so a larger file costs no more of the listing's allowance.
exports.MAX_BYTES_PER_FILE = 200 * 1024;
exports.MAX_BYTES_PER_LISTING = 20 * exports.MAX_BYTES_PER_FILE;
exports.MAX_FILES_PER_LISTING = 200;
const SCRIPT_EXTENSION = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1|bat|cmd|rb)$/i;
const MINIFIED = /\.min\.js$/i;
const CONFIG_NAMES = new Set(["hooks.json", "plugin.json", ".mcp.json"]);
// Dependencies and build output, and test and eval folders, whose fixtures quote the very patterns the scan looks for on purpose.
// A file only named like a test is scanned: attackers hide payloads in such names.
const SKIPPED_FOLDERS = new Set(["node_modules", "vendor", "dist", "build", "test", "tests", "__tests__", "evals"]);
const parentOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);
// The folders a skill or plugin lives in: those holding a SKILL.md, the folder above a .claude-plugin/plugin.json, and the
// repository's root when it holds a plugin.json. A plugin.json elsewhere is as likely to be a translation or app file.
function scanRoots(tree) {
    const roots = new Set();
    for (const { path } of tree) {
        const name = baseName(path);
        const folder = parentOf(path);
        if (name === "SKILL.md")
            roots.add(folder);
        else if (name === "plugin.json" && baseName(folder) === ".claude-plugin")
            roots.add(parentOf(folder));
        else if (path === "plugin.json")
            roots.add("");
    }
    return [...roots];
}
const isUnder = (path, root) => root === "" || path.startsWith(`${root}/`);
function isRunnable(path) {
    if (path.split("/").slice(0, -1).some((folder) => SKIPPED_FOLDERS.has(folder)))
        return false;
    const name = baseName(path);
    if (CONFIG_NAMES.has(name))
        return true;
    return SCRIPT_EXTENSION.test(name) && !MINIFIED.test(name);
}
const configFirst = (f) => (CONFIG_NAMES.has(baseName(f.path)) ? 0 : 1);
function selectScriptFiles(tree) {
    const roots = scanRoots(tree);
    if (roots.length === 0)
        return { paths: [], truncated: false };
    const candidates = tree
        .filter((f) => f.path === ".mcp.json" || (roots.some((root) => isUnder(f.path, root)) && isRunnable(f.path)))
        // Configs first: they say what runs, so a cap leaves out scripts before them.
        .sort((a, b) => configFirst(a) - configFirst(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const paths = [];
    const shas = new Set();
    let bytes = 0;
    let truncated = false;
    for (const f of candidates) {
        if (f.sha) {
            if (shas.has(f.sha))
                continue;
            shas.add(f.sha);
        }
        const cost = Math.min(f.size, exports.MAX_BYTES_PER_FILE);
        if (paths.length >= exports.MAX_FILES_PER_LISTING || bytes + cost > exports.MAX_BYTES_PER_LISTING) {
            truncated = true;
            continue;
        }
        paths.push(f.path);
        bytes += cost;
    }
    return { paths, truncated };
}

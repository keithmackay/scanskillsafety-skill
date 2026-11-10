"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LAUNCH_CONTEXT_FILES = exports.TEST_FILE_NAME = void 0;
exports.hasLaunchableTestFiles = hasLaunchableTestFiles;
exports.launchContextPaths = launchContextPaths;
exports.findLaunchedTestFiles = findLaunchedTestFiles;
// ABOUTME: Finds the scripts in test and eval folders that a file outside them runs, so a payload can't hide in a folder the
// ABOUTME: script scan skips: a skill, command, agent, hook, script or non-test package.json script that names one gets it read.
const scriptFiles_1 = require("./scriptFiles");
// The test and eval folders scriptFiles skips; its dependency and build folders stay skipped.
const TEST_FOLDERS = new Set(["test", "tests", "__tests__", "evals"]);
const DEPENDENCY_FOLDERS = new Set(["node_modules", "vendor", "dist", "build"]);
// scriptFiles' script extensions, plus a file with none (`sh tests/payload`).
const SCRIPT_EXTENSION = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1|bat|cmd|rb)$/i;
// package.json scripts named for tests, evals, benchmarks, smoke runs or QA are a test context (test, test:unit, bench:startup,
// win-update-e2e, qa:otel:smoke), and so is a file named like a test.
const TEST_SCRIPT_NAME = /(?:^|[:_.-])(?:pre|post)?(?:tests?|evals?|e2e|bench(?:mark)?s?|smoke|spec|qa|coverage|ci)(?:[:_.-]|$)/i;
exports.TEST_FILE_NAME = /(\.(test|spec)\.[^.]+$)|(_test\.[^.]+$)|(^test_.*\.py$)/i;
const WORD = /[\w-]+/g;
// At most this many SKILL.md, command and agent files are read to see what they run.
exports.MAX_LAUNCH_CONTEXT_FILES = 100;
const segmentsOf = (path) => path.split("/");
const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);
const testFolderIndex = (path) => segmentsOf(path).slice(0, -1).findIndex((s) => TEST_FOLDERS.has(s));
const inTestFolder = (path) => testFolderIndex(path) >= 0;
const inDependencyFolder = (path) => segmentsOf(path).slice(0, -1).some((s) => DEPENDENCY_FOLDERS.has(s));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
function isLaunchable(path) {
    if (inDependencyFolder(path))
        return false;
    const name = baseName(path);
    return (SCRIPT_EXTENSION.test(name) && !/\.min\.js$/i.test(name)) || !name.includes(".");
}
// Whether the tree has anything a file could launch from a test or eval folder: when not, nothing need be read to find out.
function hasLaunchableTestFiles(tree) {
    return tree.some((f) => inTestFolder(f.path) && isLaunchable(f.path));
}
// The files that say what a skill or plugin runs without being scripts themselves: SKILL.md, commands and agents in its
// folders, and the repository's package.json. (Hooks and MCP configs are already read as scripts.)
function launchContextPaths(tree) {
    const roots = (0, scriptFiles_1.scanRoots)(tree);
    const under = (path) => roots.some((root) => root === "" || path.startsWith(`${root}/`));
    return tree
        .filter((f) => f.path === "package.json" ||
        (under(f.path) &&
            !inTestFolder(f.path) &&
            !inDependencyFolder(f.path) &&
            (baseName(f.path) === "SKILL.md" || /(^|\/)(commands|agents)\/[^/]+\.md$/.test(f.path))))
        .sort(byPath)
        .slice(0, exports.MAX_LAUNCH_CONTEXT_FILES)
        .map((f) => f.path);
}
// The ways a file can name a test file: from its test folder on (tests/run.sh, ./tests/util, ${ROOT}/tests/run.sh), and
// for Python as a module (python -m tests.run). Whole path segments only: mytests/run.sh is not tests/run.sh.
function referencePattern(path) {
    const tail = segmentsOf(path).slice(testFolderIndex(path));
    const withPath = tail.join("/");
    const forms = [withPath, withPath.replace(/\.[^./]+$/, "")];
    if (/\.py$/i.test(path))
        forms.push(tail.join(".").replace(/\.py$/i, ""));
    const alternatives = [...new Set(forms)].map(escape).join("|");
    return new RegExp(`(?<![\\w.-])(?:${alternatives})(?![\\w/-]|\\.\\w)`, "g");
}
// Where a reference runs the file rather than mentions it. `segment` is the line before the reference, from the last command
// separator (&&, ||, ;, |, a backtick) on; `token` is its last word, the path in front of the reference (${ROOT}/, ./, ../).
const INTERPRETER = String.raw `(?:bash|sh|zsh|dash|ksh|source|\.|python[\d.]*|py|node|nodejs|deno|bun|tsx|ts-node|npx|ruby|perl|php|pwsh|powershell(?:\.exe)?|cmd(?:\.exe)?\s+/c|exec|eval|call|start|run)`;
const AFTER_INTERPRETER = new RegExp(String.raw `(?:^|[\s(\$])${INTERPRETER}(?:\s+-{1,2}[\w=-]+)*\s+["']?\S*$`, "i");
const CALL = /\b(?:require|import|spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|system|popen|Popen|run|call|check_call|check_output|run_path|run_module|import_module|Start-Process)\s*\(|\bfrom\s+["']\S*$|^\s*import\s+["']|^\s*(?:&|Start-Process)\s/;
// A path run directly as the first word of a command: ./tests/x.sh, ${CLAUDE_PLUGIN_ROOT}/tests/x.sh, ~/x/tests/y.sh.
const RUN_DIRECTLY = /^\s*(?:\$\s+)?["']?(?:\.{1,2}|\$\{?\w+\}?|~)\/\S*$/;
const TEST_RUNNER = /\b(?:vitest|jest|jasmine|pytest|py\.test|mocha|ava|tap|karma|cypress|playwright|unittest|nose2?|(?:npm|pnpm|yarn|bun|deno|go|cargo)\s+(?:run\s+)?test|node\s+--test|rspec|phpunit)\b/i;
const CODE_COMMENT = /^\s*(?:\/\/|#(?!!)|\*|\/\*|--|rem\b|::)/i;
function runsAt(referrerPath, text, index) {
    // A config's strings are what it runs (package.json is read as its commands, below).
    if (/\.json$/i.test(referrerPath) && baseName(referrerPath) !== "package.json")
        return true;
    const lineStart = text.lastIndexOf("\n", index - 1) + 1;
    const line = text.slice(lineStart, index);
    if (SCRIPT_EXTENSION.test(referrerPath) && CODE_COMMENT.test(line))
        return false;
    const segment = line.split(/&&|\|\||;|\||`/).pop() ?? "";
    if (TEST_RUNNER.test(segment))
        return false;
    return AFTER_INTERPRETER.test(segment) || CALL.test(line) || RUN_DIRECTLY.test(segment);
}
// Whether the reference at `index` names this test file rather than one with the same name in another folder: the referring
// file sits in the test folder's parent folder or below (so tests/x.sh or ../tests/x is relative to it), or the path in front
// of the reference names that parent.
function resolvesTo(testPath, referrerPath, text, index) {
    const parent = segmentsOf(testPath).slice(0, testFolderIndex(testPath)).join("/");
    if (parent === "" || referrerPath.startsWith(`${parent}/`))
        return true;
    const token = text.slice(0, index).match(/\S*$/)?.[0] ?? "";
    return token.endsWith(`${parent}/`);
}
function runs(testPath, pattern, referrer) {
    for (const match of referrer.text.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (resolvesTo(testPath, referrer.path, referrer.text, index) && runsAt(referrer.path, referrer.text, index))
            return true;
    }
    return false;
}
// What a file can run from: a README is for people, and package.json runs only its scripts, bin and main.
function launchText(file) {
    if (baseName(file.path) === "README.md")
        return null;
    if (baseName(file.path) !== "package.json")
        return file.text;
    try {
        const pkg = JSON.parse(file.text);
        const scripts = Object.entries(pkg.scripts ?? {})
            .filter(([name]) => !TEST_SCRIPT_NAME.test(name))
            .map(([, cmd]) => String(cmd));
        const bins = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {}).map(String);
        const main = typeof pkg.main === "string" ? [pkg.main] : [];
        // bin and main are run by node; written as commands, they are read like the scripts.
        return [...scripts, ...[...bins, ...main].map((path) => `node ${path}`)].join("\n");
    }
    catch {
        return file.text;
    }
}
// The files in the tree's test and eval folders that a file read so far runs, from outside those folders or from a test
// file already launched, within what is left of the script limits. `tried` holds paths already looked for. Call again with
// the launched files added (script, launchedBy) until none are found: a launched file can launch another.
function findLaunchedTestFiles(tree, files, tried = new Set()) {
    const read = new Set(files.map((f) => f.path));
    const referrers = files
        .filter((f) => (!inTestFolder(f.path) && !exports.TEST_FILE_NAME.test(baseName(f.path))) || f.launchedBy)
        .map((f) => ({ path: f.path, text: launchText(f) }))
        .filter((f) => Boolean(f.text))
        .map((f) => ({ ...f, words: new Set(f.text.match(WORD) ?? []) }));
    const scripts = files.filter((f) => f.script);
    let count = scripts.length;
    let bytes = scripts.reduce((sum, f) => sum + Math.min(Buffer.byteLength(f.text), scriptFiles_1.MAX_BYTES_PER_FILE), 0);
    const launched = [];
    let truncated = false;
    const candidates = tree
        .filter((f) => inTestFolder(f.path) && isLaunchable(f.path) && !read.has(f.path) && !tried.has(f.path))
        .sort(byPath);
    for (const f of candidates) {
        // A file can only name this one if the first word of its name is in it; that check is cheap, the pattern is not.
        const firstWord = baseName(f.path).match(WORD)?.[0] ?? "";
        const pattern = referencePattern(f.path);
        const by = referrers.find((r) => r.path !== f.path && r.words.has(firstWord) && runs(f.path, pattern, r));
        if (!by)
            continue;
        const cost = Math.min(f.size, scriptFiles_1.MAX_BYTES_PER_FILE);
        if (count + 1 > scriptFiles_1.MAX_FILES_PER_LISTING || bytes + cost > scriptFiles_1.MAX_BYTES_PER_LISTING) {
            truncated = true;
            continue;
        }
        launched.push({ path: f.path, by: by.path });
        count += 1;
        bytes += cost;
    }
    return { launched, truncated };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanInstallScript = scanInstallScript;
// ABOUTME: Flags a listing that pipes a downloaded script straight into a shell (curl | sh, | sudo
// ABOUTME: bash, bash <(curl …), PowerShell iex) — code from its own repo or host that this scan never
// ABOUTME: reads. A warning, in its own category so an appeal on an installer line can't dismiss a
// ABOUTME: real destructive-command finding. Official installers for well-known toolchains are skipped.
const scanInput_1 = require("../scanInput");
// Official installers for widely used toolchains. A curl | sh to one of these says nothing about the
// skill itself, and flagging every uv/Docker/nvm install line buries the installs that matter: a
// skill running its own unread script. Matched on exact host (+ path prefix), so lookalikes still flag.
const WELL_KNOWN_INSTALLERS = [
    { host: "astral.sh" }, { host: "get.docker.com" }, { host: "sh.rustup.rs" }, { host: "bun.sh" },
    { host: "deno.land" }, { host: "fly.io" }, { host: "tailscale.com" }, { host: "ollama.com" },
    { host: "claude.ai" }, { host: "community.chocolatey.org" }, { host: "get.pnpm.io" },
    { host: "install.python-poetry.org" }, { host: "sdk.cloud.google.com" },
    { host: "raw.githubusercontent.com", pathPrefix: "/nvm-sh/nvm/" },
    { host: "raw.githubusercontent.com", pathPrefix: "/homebrew/install/" },
];
// True when every URL on the line is a well-known toolchain installer.
function onlyWellKnownInstallers(line) {
    const urls = line.match(/https?:\/\/[^\s'"`|)]+/g) ?? [];
    return urls.length > 0 && urls.every((raw) => {
        try {
            const url = new URL(raw);
            return WELL_KNOWN_INSTALLERS.some((w) => url.hostname === w.host && (!w.pathPrefix || url.pathname.toLowerCase().startsWith(w.pathPrefix)));
        }
        catch {
            return false;
        }
    });
}
const PATTERNS = [
    {
        detail: "Pipes a downloaded script directly into a shell (curl | sh / wget | bash)",
        // Requires something to fetch (a URL or host/path) so prose naming "curl | bash" doesn't match.
        matches: (line) => /\b(curl|wget)\s[^|]*(https?:\/\/|\b[\w-]+(\.[\w-]+)+\/)[^|]*\|\s*(sudo\s+(-[a-z]+\s+)*)?(sh|bash|zsh)\b/i.test(line),
    },
    {
        detail: "Runs a downloaded script through process substitution (bash <(curl …))",
        matches: (line) => /\b(bash|sh|zsh|source)\s+<\(\s*(curl|wget)\b/i.test(line),
    },
    {
        detail: "Runs a downloaded PowerShell script (iex / Invoke-Expression)",
        matches: (line) => /\b(iex|invoke-expression)\s*\(?\s*\(?\s*(iwr|irm|invoke-webrequest|invoke-restmethod|new-object\s+(system\.)?net\.webclient)\b/i.test(line) ||
            /\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]*\|\s*(iex|invoke-expression)\b/i.test(line),
    },
];
function scanInstallScript(input) {
    const findings = [];
    for (const { line, text } of input.normalized.lines) {
        if (onlyWellKnownInstallers(text))
            continue;
        for (const { detail, matches } of PATTERNS) {
            if (matches(text))
                findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "install-script", detail }));
        }
    }
    return (0, scanInput_1.capFindings)(findings);
}

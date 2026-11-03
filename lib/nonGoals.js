"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFETY_SCANNER_NON_GOALS = void 0;
exports.SAFETY_SCANNER_NON_GOALS = [
    {
        title: "Anything that requires actually running the code",
        explanation: "This is a static, text-only scanner — it never executes a skill's scripts or starts an " +
            "MCP server. A payload that only triggers at runtime, or behavior that depends on real " +
            "inputs/environment, is invisible to it.",
    },
    {
        title: "Rug pulls (a tool's description changing after you already approved it)",
        explanation: "Detecting a rug pull requires comparing a listing's content against its own history — " +
            "this scanner only ever looks at a single snapshot of text, with no memory of what it " +
            "looked like before. findsafeskills re-scans a GitHub-hosted listing when its manifest " +
            "changes, but a change to only the README, to GitLab/Gitea listings, or to what a " +
            "running server tells your agent goes unnoticed.",
    },
    {
        title: "Contextual or workflow-dependent attacks",
        explanation: "An instruction that's only dangerous in combination with another tool's output, or that " +
            "relies on the broader conversation's context to make sense, won't match any fixed pattern.",
    },
    {
        title: "Novel phrasing not covered by the pattern list",
        explanation: "Detection here is pattern-matching against known phrasings/signatures (instruction " +
            "overrides, known exfiltration domains, secret formats, shell and download patterns, " +
            "concealment phrasing). Paraphrased jailbreaks, exfiltration to destinations not on the " +
            "list, and instructions to read sensitive files are not yet covered. A " +
            "sufficiently creative or newly-invented attack simply won't match anything on the list " +
            "until the list is updated.",
    },
    {
        title: "Anything outside the scanned text itself",
        explanation: "The scanner reads a listing's manifest, README and description, and for GitHub skills and " +
            "plugins the scripts, hooks and MCP configs it bundles, up to the limits on the safety page. " +
            "It says nothing about the publisher's identity, intent, or track record. It does not read an " +
            "MCP server's own source, files past those limits, or what a listing downloads: links are not " +
            "followed, and install scripts fetched at install time (curl | sh and the like) are never read.",
    },
];

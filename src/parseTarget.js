// ABOUTME: Classifies the user's scan target — a local dir/file, a GitHub or self-hosted
// ABOUTME: Gitea/Forgejo repo URL (optionally pointing into a subdirectory or at one file at a
// ABOUTME: given ref), or a plain URL to fetch directly.
"use strict";

const fs = require("fs");

function localKind(input) {
  try {
    const stat = fs.statSync(input);
    if (stat.isDirectory()) return { kind: "local-dir", path: input };
    if (stat.isFile()) return { kind: "local-file", path: input };
  } catch {
    // not a local path
  }
  return null;
}

// Splits "<ref>/<subpath...>" — assumes a single-segment ref (a branch name containing "/"
// would be misread, which then surfaces as a not-found error rather than a wrong scan).
function refAndSubpath(rest) {
  if (rest.length === 0) return { ref: null, subpath: "" };
  return { ref: rest[0], subpath: rest.slice(1).join("/") };
}

function parseTarget(input) {
  const local = localKind(input);
  if (local) return local;

  let url;
  try {
    url = new URL(input);
  } catch {
    return { kind: "invalid", input };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { kind: "invalid", input };

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (url.hostname === "raw.githubusercontent.com" || segments.length < 2) {
    return { kind: "raw-url", url: url.href };
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, "");
  const rest = segments.slice(2);

  if (url.hostname === "github.com") {
    if (rest[0] === "tree" || rest[0] === "blob") {
      return { kind: "github", owner, repo, ...refAndSubpath(rest.slice(1)), isFile: rest[0] === "blob" };
    }
    return { kind: "github", owner, repo, ref: null, subpath: "", isFile: false };
  }

  // Gitea/Forgejo: /owner/repo/src/{branch|tag|commit}/<ref>/<subpath>
  if (rest[0] === "src" && ["branch", "tag", "commit"].includes(rest[1])) {
    const { ref, subpath } = refAndSubpath(rest.slice(2));
    return { kind: "git-host", origin: url.origin, owner, repo, ref, subpath, isFile: /\.(md|json)$/i.test(subpath) };
  }
  if (rest.length > 0) return { kind: "raw-url", url: url.href };
  return { kind: "git-host", origin: url.origin, owner, repo, ref: null, subpath: "", isFile: false };
}

module.exports = { parseTarget };

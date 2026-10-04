#!/usr/bin/env node
// ABOUTME: CLI entry point for the scanskillsafety skill. Fully offline/local — makes no
// ABOUTME: network calls to any third party except the target repo's own host, to read its
// ABOUTME: public manifest/README text (or the local filesystem, for a local path).
"use strict";

const fs = require("fs");
const path = require("path");
const { scanText } = require("./lib/scanText");

const MANIFEST_FILENAMES = ["SKILL.md", "README.md", ".claude-plugin/marketplace.json", "plugin.json"];

const DISCLAIMER = [
  "scanskillsafety — static text analysis only.",
  "This does NOT execute any code, does NOT catch rug pulls (description changes after you",
  "already approved something), contextual/workflow-dependent attacks, or novel phrasing not",
  "covered by its pattern list. It is one signal, not a verdict — always read the thing yourself.",
].join("\n");

function parseOwnerRepo(repoUrl) {
  try {
    const url = new URL(repoUrl);
    const segments = url.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/").filter(Boolean);
    if (segments.length < 2) return null;
    return { origin: url.origin, owner: segments[0], repo: segments[segments.length - 1] };
  } catch {
    return null;
  }
}

async function fetchText(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchGithubText(owner, repo) {
  const branches = ["main", "master"];
  const texts = [];
  for (const branch of branches) {
    for (const filename of MANIFEST_FILENAMES) {
      const text = await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filename}`);
      if (text) texts.push(text);
    }
    if (texts.length > 0) break; // found content on this branch, don't also try the other
  }
  return texts;
}

async function fetchGenericGitHostText(origin, owner, repo) {
  // Covers self-hosted Gitea/Forgejo instances, whose REST API (unlike GitHub's) exposes the
  // default branch directly, so there's no need to guess main vs master.
  try {
    const repoInfoText = await fetchText(`${origin}/api/v1/repos/${owner}/${repo}`);
    if (!repoInfoText) return [];
    const repoInfo = JSON.parse(repoInfoText);
    if (typeof repoInfo.default_branch !== "string") return [];
    const texts = [];
    for (const filename of MANIFEST_FILENAMES) {
      const text = await fetchText(`${origin}/api/v1/repos/${owner}/${repo}/raw/${repoInfo.default_branch}/${filename}`);
      if (text) texts.push(text);
    }
    return texts;
  } catch {
    return [];
  }
}

function readLocalTexts(targetPath) {
  const texts = [];
  for (const filename of MANIFEST_FILENAMES) {
    const filePath = path.join(targetPath, filename);
    if (fs.existsSync(filePath)) {
      texts.push(fs.readFileSync(filePath, "utf-8"));
    }
  }
  return texts;
}

async function gatherText(target) {
  if (fs.existsSync(target)) {
    return readLocalTexts(target);
  }

  const parsed = parseOwnerRepo(target);
  if (!parsed) {
    // Not a local path and not a parseable owner/repo URL — try fetching it directly as a
    // single raw text URL (covers a user pasting a direct raw README/manifest link).
    const text = await fetchText(target);
    return text ? [text] : [];
  }

  if (parsed.origin === "https://github.com") {
    return fetchGithubText(parsed.owner, parsed.repo);
  }
  return fetchGenericGitHostText(parsed.origin, parsed.owner, parsed.repo);
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: scanskillsafety <local-path-or-repo-url>");
    process.exit(1);
  }

  const texts = await gatherText(target);
  if (texts.length === 0) {
    console.error(`Could not find any of ${MANIFEST_FILENAMES.join(", ")} for "${target}".`);
    process.exit(1);
  }

  const { rating, findings } = scanText(texts.join("\n"));

  console.log(DISCLAIMER);
  console.log("");
  console.log(`Rating: ${rating.toUpperCase()}`);
  if (findings.length === 0) {
    console.log("No findings from the static scan.");
  } else {
    for (const finding of findings) {
      console.log(`  [${finding.severity}] ${finding.category}: ${finding.detail}`);
    }
  }
}

main();

// ABOUTME: Test helpers — builds throwaway fixture trees in the OS temp dir (so this repo's own
// ABOUTME: self-scan never picks up deliberately-malicious fixture text) and fakes fetch.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanskillsafety-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

// routes: { url: string | {status, body} | Error }. Unlisted URLs return 404.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "string") return new Response(route, { status: 200 });
    const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200 });
  };
  fn.calls = calls;
  return fn;
}

module.exports = { makeTree, fakeFetch };

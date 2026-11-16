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

// routes: { url: string | {status, body} | Error | (init) => one of those }; a function answers by the request (its method and
// body), as for a POST. A string, Buffer or Uint8Array body is sent as is, anything else as JSON. Unlisted URLs return 404.
// Records each URL in calls and each request's options, its body among them, in options.
function fakeFetch(routes) {
  const calls = [];
  const options = [];
  const fn = async (url, init = {}) => {
    calls.push(url);
    options.push(init);
    const route = typeof routes[url] === "function" ? routes[url](init) : routes[url];
    if (route instanceof Error) throw route;
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "string") return new Response(route, { status: 200 });
    const asIs = typeof route.body === "string" || route.body instanceof Uint8Array;
    return new Response(asIs ? route.body : JSON.stringify(route.body), { status: route.status ?? 200 });
  };
  fn.calls = calls;
  fn.options = options;
  return fn;
}

module.exports = { makeTree, fakeFetch };

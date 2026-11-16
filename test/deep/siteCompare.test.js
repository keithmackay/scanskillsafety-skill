"use strict";
// ABOUTME: Tests comparing the commit a deep scan reads with what findsafeskills scanned, with a fake site and a fake GitHub:
// ABOUTME: each relation, two listings, not listed, out of reach (never read as not listed), and no request for a local folder.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { compareWithSite } = require("../../src/deep/siteCompare");
const { parseTarget } = require("../../src/parseTarget");
const { makeTree, fakeFetch } = require("../helpers");

const BASE = "https://site.test";
const COMMIT = "c".repeat(40);
const OLD = "a".repeat(40);
const OTHER = "b".repeat(40);
const GITHUB = parseTarget("https://github.com/o/r");
const lookupUrl = (repo, base = BASE) => `${base}/api/listings/lookup?repo=${encodeURIComponent(repo)}`;
const LOOKUP = lookupUrl("https://github.com/o/r");
const compareUrl = (scanned) => `https://api.github.com/repos/o/r/compare/${scanned}...${COMMIT}?per_page=1`;
const listing = (extra = {}) => ({
  slug: "o-r",
  url: `${BASE}/listings/o-r`,
  rating: "yellow",
  scannedAt: "2026-10-30T10:00:00.000Z",
  scanCommit: null,
  scriptsCommit: null,
  pushedAt: "2026-11-01T00:00:00.000Z",
  scriptsScan: "full",
  ...extra,
});
const page = { url: `${BASE}/listings/o-r`, rating: "yellow", scannedAt: "2026-10-30T10:00:00.000Z" };
const compareAnswer = (status, aheadBy, behindBy) => ({ body: { status, ahead_by: aheadBy, behind_by: behindBy, commits: [] } });

test("a local folder is not compared and nothing is sent", async () => {
  const fetchImpl = fakeFetch({});
  assert.deepEqual(await compareWithSite(parseTarget(makeTree({ "SKILL.md": "hi" })), null, fetchImpl, BASE), { status: "local" });
  assert.deepEqual(fetchImpl.calls, []);
});

test("not listed: the site answers an empty list", async () => {
  const fetchImpl = fakeFetch({ [LOOKUP]: { body: { listings: [] } } });
  assert.deepEqual(await compareWithSite(GITHUB, COMMIT, fetchImpl, BASE), { status: "not-listed", listings: [] });
  assert.deepEqual(fetchImpl.calls, [LOOKUP]);
});

test("the site is asked about the repository's root, whatever folder or ref the target names", async () => {
  const fetchImpl = fakeFetch({ [LOOKUP]: { body: { listings: [] } } });
  await compareWithSite(parseTarget("https://github.com/o/r/tree/v2/skills/x"), COMMIT, fetchImpl, BASE);
  assert.deepEqual(fetchImpl.calls, [LOOKUP]);
});

test("out of reach is never read as not listed: a network error, a failed answer, rate limiting, an answer of the wrong shape", async () => {
  const cases = [
    [new Error("getaddrinfo ENOTFOUND site.test"), `network error (getaddrinfo ENOTFOUND site.test): ${LOOKUP}`],
    [{ status: 500, body: "oops" }, `HTTP 500: ${LOOKUP}`],
    [{ status: 429, body: { error: "slow down" } }, `rate limited (HTTP 429): ${LOOKUP}`],
    [{ status: 403, body: "forbidden" }, `rate limited (HTTP 403): ${LOOKUP}`],
    [{ body: `{"listings":[],"pad":"${"x".repeat(1024 * 1024)}"}` }, `answered more than 1 MB: ${LOOKUP}`],
    ["not json", `did not answer a list of listings: ${LOOKUP}`],
    [{ body: { listings: "none" } }, `did not answer a list of listings: ${LOOKUP}`],
    [{ body: { listings: [null] } }, `did not answer a list of listings: ${LOOKUP}`],
  ];
  for (const [answer, reason] of cases) {
    const result = await compareWithSite(GITHUB, COMMIT, fakeFetch({ [LOOKUP]: answer }), BASE);
    assert.deepEqual(result, { status: "unreachable", reason });
  }
});

test("the text scan and the script scan at this commit: scanned this commit, with no call to GitHub", async () => {
  const fetchImpl = fakeFetch({ [LOOKUP]: { body: { listings: [listing({ scanCommit: COMMIT, scriptsCommit: COMMIT })] } } });
  assert.deepEqual(await compareWithSite(GITHUB, COMMIT, fetchImpl, BASE), {
    status: "listed",
    listings: [{ ...page, text: { commit: COMMIT, relation: "same" }, scripts: { commit: COMMIT, relation: "same" } }],
    more: 0,
  });
  assert.deepEqual(fetchImpl.calls, [LOOKUP]);
});

test("each relation GitHub's compare call gives: newer, older, diverged, identical", async () => {
  const cases = [
    [compareAnswer("ahead", 14, 0), { relation: "newer", by: 14 }],
    [compareAnswer("behind", 0, 3), { relation: "older", by: 3 }],
    [compareAnswer("diverged", 2, 5), { relation: "diverged", newerBy: 2, olderBy: 5 }],
    [compareAnswer("identical", 0, 0), { relation: "same" }],
  ];
  for (const [answer, relation] of cases) {
    const fetchImpl = fakeFetch({ [LOOKUP]: { body: { listings: [listing({ scriptsCommit: OLD })] } }, [compareUrl(OLD)]: answer });
    const result = await compareWithSite(GITHUB, COMMIT, fetchImpl, BASE);
    assert.deepEqual(result.listings, [{ ...page, text: null, scripts: { commit: OLD, ...relation } }]);
    assert.deepEqual(fetchImpl.calls, [LOOKUP, compareUrl(OLD)]);
  }
});

test("a 400 means the site could not use the address, which is not \"not listed\"", async () => {
  const result = await compareWithSite(GITHUB, COMMIT, fakeFetch({ [LOOKUP]: { status: 400, body: { error: "repo must be a repository URL" } } }), BASE);
  assert.deepEqual(result, { status: "refused", reason: "findsafeskills could not use this repository address (HTTP 400)" });
});

test("at most 10 listings are compared; the rest are counted", async () => {
  const commits = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(40, "0"));
  const routes = { [LOOKUP]: { body: { listings: commits.map((c) => listing({ scanCommit: c })) } } };
  for (const c of commits) routes[compareUrl(c)] = compareAnswer("ahead", 1, 0);
  const fetchImpl = fakeFetch(routes);
  const result = await compareWithSite(GITHUB, COMMIT, fetchImpl, BASE);
  assert.equal(result.listings.length, 10);
  assert.equal(result.more, 2);
  assert.equal(fetchImpl.calls.length, 11);
});

test("once GitHub's compare call is rate limited, no other commit is asked about", async () => {
  const third = "d".repeat(40);
  const fetchImpl = fakeFetch({
    [LOOKUP]: { body: { listings: [listing({ scanCommit: OLD }), listing({ scanCommit: OTHER, scriptsCommit: third })] } },
    [compareUrl(OLD)]: compareAnswer("ahead", 1, 0),
    [compareUrl(OTHER)]: { status: 429, body: "slow down" },
    [compareUrl(third)]: compareAnswer("ahead", 1, 0),
  });
  const result = await compareWithSite(GITHUB, COMMIT, fetchImpl, BASE);
  const reason = `GitHub's compare call was rate limited (HTTP 429): ${compareUrl(OTHER)}`;
  assert.deepEqual(result.listings[1].text, { commit: OTHER, relation: "not-compared", reason });
  assert.deepEqual(result.listings[1].scripts, { commit: third, relation: "not-compared", reason });
  assert.deepEqual(fetchImpl.calls, [LOOKUP, compareUrl(OLD), compareUrl(OTHER)]);
});

test("a page address off the site's own origin is replaced by the slug's page, or dropped; an unknown rating is \"unknown\"", async () => {
  const fetchImpl = fakeFetch({ [LOOKUP]: { body: { listings: [
    listing({ url: "https://evil.example/listings/o-r", rating: "purple" }),
    listing({ url: "https://site.test.evil.example/x", slug: "a b", rating: null }),
    listing({ url: "not a url", slug: 7 }),
  ] } } });
  const result = await compareWithSite(GITHUB, COMMIT, fetchImpl, BASE);
  assert.deepEqual(result.listings.map((l) => [l.url, l.rating]), [
    [`${BASE}/listings/o-r`, "unknown"],
    [`${BASE}/listings/a%20b`, null],
    [null, "yellow"],
  ]);
});

test("a text scan and a script scan at different commits are each compared", async () => {
  const fetchImpl = fakeFetch({
    [LOOKUP]: { body: { listings: [listing({ scanCommit: OLD, scriptsCommit: COMMIT })] } },
    [compareUrl(OLD)]: compareAnswer("ahead", 4, 0),
  });
  const result = await compareWithSite(GITHUB, COMMIT, fetchImpl, BASE);
  assert.deepEqual(result.listings[0].text, { commit: OLD, relation: "newer", by: 4 });
  assert.deepEqual(result.listings[0].scripts, { commit: COMMIT, relation: "same" });
});

test("a listing with no commit gives its scan date only", async () => {
  const fetchImpl = fakeFetch({ [LOOKUP]: { body: { listings: [listing()] } } });
  assert.deepEqual((await compareWithSite(GITHUB, COMMIT, fetchImpl, BASE)).listings, [{ ...page, text: null, scripts: null }]);
  assert.deepEqual(fetchImpl.calls, [LOOKUP]);
});

test("a value that is not a commit id is never put in a request", async () => {
  const fetchImpl = fakeFetch({ [LOOKUP]: { body: { listings: [listing({ scanCommit: "../../x", scriptsCommit: 7 })] } } });
  assert.deepEqual((await compareWithSite(GITHUB, COMMIT, fetchImpl, BASE)).listings, [{ ...page, text: null, scripts: null }]);
  assert.deepEqual(fetchImpl.calls, [LOOKUP]);
});

test("a failed compare call gives the scan date only, with the reason", async () => {
  const cases = [
    [undefined, "GitHub does not know the scanned commit"],
    [{ status: 403, body: "rate limit" }, `GitHub's compare call was rate limited (HTTP 403): ${compareUrl(OLD)}`],
    [{ body: `{"status":"ahead","ahead_by":1,"behind_by":0,"pad":"${"x".repeat(5 * 1024 * 1024)}"}` }, `answered more than 5 MB: ${compareUrl(OLD)}`],
    [{ status: 502, body: "bad" }, `HTTP 502: ${compareUrl(OLD)}`],
    [{ body: { status: "sideways" } }, `GitHub's compare call answered an unexpected shape: ${compareUrl(OLD)}`],
  ];
  for (const [answer, reason] of cases) {
    const routes = { [LOOKUP]: { body: { listings: [listing({ scanCommit: OLD })] } } };
    if (answer) routes[compareUrl(OLD)] = answer;
    const result = await compareWithSite(GITHUB, COMMIT, fakeFetch(routes), BASE);
    assert.deepEqual(result.listings[0].text, { commit: OLD, relation: "not-compared", reason });
  }
});

test("two listings, each reported; a commit both name is compared once", async () => {
  const second = listing({ slug: "o-r-2", url: `${BASE}/listings/o-r-2`, rating: "green", scanCommit: OLD, scriptsCommit: OTHER });
  const fetchImpl = fakeFetch({
    [LOOKUP]: { body: { listings: [listing({ scanCommit: OLD }), second] } },
    [compareUrl(OLD)]: compareAnswer("ahead", 1, 0),
    [compareUrl(OTHER)]: compareAnswer("behind", 0, 2),
  });
  const result = await compareWithSite(GITHUB, COMMIT, fetchImpl, BASE);
  assert.equal(result.status, "listed");
  assert.deepEqual(result.listings, [
    { ...page, text: { commit: OLD, relation: "newer", by: 1 }, scripts: null },
    {
      url: `${BASE}/listings/o-r-2`, rating: "green", scannedAt: page.scannedAt,
      text: { commit: OLD, relation: "newer", by: 1 }, scripts: { commit: OTHER, relation: "older", by: 2 },
    },
  ]);
  assert.deepEqual(fetchImpl.calls, [LOOKUP, compareUrl(OLD), compareUrl(OTHER)]);
});

test("a Gitea or Forgejo repository is looked up by its own address and gives the scan date only", async () => {
  const lookup = lookupUrl("https://code.example/o/r");
  const fetchImpl = fakeFetch({ [lookup]: { body: { listings: [listing({ scanCommit: OLD })] } } });
  const result = await compareWithSite(parseTarget("https://code.example/o/r/src/branch/main/x"), COMMIT, fetchImpl, BASE);
  assert.deepEqual(result.listings[0].text, { commit: OLD, relation: "not-compared", reason: "only commits on GitHub are compared" });
  assert.deepEqual(fetchImpl.calls, [lookup]);
});

test("an owner or repository name is encoded in the compare address", async () => {
  const target = { kind: "github", owner: "o?x", repo: "r#/..", ref: null, subpath: "", isFile: false };
  const lookup = lookupUrl("https://github.com/o?x/r#/..");
  const fetchImpl = fakeFetch({ [lookup]: { body: { listings: [listing({ scanCommit: OLD })] } } });
  await compareWithSite(target, COMMIT, fetchImpl, BASE);
  assert.deepEqual(fetchImpl.calls, [lookup, `https://api.github.com/repos/o%3Fx/r%23%2F../compare/${OLD}...${COMMIT}?per_page=1`]);
});

test("the site's address comes from FINDSAFESKILLS_URL, else findsafeskills.com", async () => {
  const saved = process.env.FINDSAFESKILLS_URL;
  try {
    delete process.env.FINDSAFESKILLS_URL;
    const live = fakeFetch({});
    await compareWithSite(GITHUB, COMMIT, live);
    assert.deepEqual(live.calls, [lookupUrl("https://github.com/o/r", "https://findsafeskills.com")]);
    process.env.FINDSAFESKILLS_URL = "http://localhost:3000";
    const local = fakeFetch({});
    await compareWithSite(GITHUB, COMMIT, local);
    assert.deepEqual(local.calls, [lookupUrl("https://github.com/o/r", "http://localhost:3000")]);
  } finally {
    if (saved === undefined) delete process.env.FINDSAFESKILLS_URL;
    else process.env.FINDSAFESKILLS_URL = saved;
  }
});

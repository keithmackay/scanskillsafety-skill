"use strict";
// ABOUTME: Tests asking OSV about a target's packages, with a fake OSV: malicious packages become critical findings, known
// ABOUTME: vulnerabilities are listed apart, paging and batching are followed, and any failed request means the check did not run.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkPackages } = require("../../src/deep/osv");
const { fakeFetch } = require("../helpers");

const BATCH = "https://api.osv.dev/v1/querybatch";
const vulnUrl = (id) => `https://api.osv.dev/v1/vulns/${id}`;
const pinned = (name, version, extra = {}) => ({ ecosystem: "npm", name, version, file: "package-lock.json", line: 7, ...extra });
const nameOnly = (name) => ({ ecosystem: "npm", name, version: null, file: "package.json", line: null });
const record = (id, extra = {}) => ({ body: { id, affected: [], ...extra } });
const severe = (id, severity) => record(id, { database_specific: { severity } });
const answers = (...results) => () => ({ body: { results } });
const vulns = (...ids) => ({ vulns: ids.map((id) => ({ id, modified: "2025-08-14T18:52:04Z" })) });
const bodies = (fetchImpl) => fetchImpl.options.filter((o) => o.method === "POST").map((o) => JSON.parse(o.body));

test("a malicious package on a pinned version is a critical finding naming the lockfile and its line", async () => {
  const fetchImpl = fakeFetch({ [BATCH]: answers(vulns("MAL-2025-20690")), [vulnUrl("MAL-2025-20690")]: record("MAL-2025-20690") });
  const result = await checkPackages([pinned("flatmap-stream", "0.1.1")], fetchImpl);
  assert.deepEqual(result, {
    status: "done",
    findings: [{
      severity: "critical",
      category: "malicious-package",
      source: "osv",
      file: "package-lock.json",
      line: 7,
      detail: "flatmap-stream@0.1.1 is listed as malicious in OSV (MAL-2025-20690)",
    }],
    vulnerabilities: [],
    detailsLeft: 0,
  });
  assert.deepEqual(bodies(fetchImpl), [{ queries: [{ package: { name: "flatmap-stream", ecosystem: "npm" }, version: "0.1.1" }] }]);
});

test("known vulnerabilities are listed with their ids and the highest severity, never as findings", async () => {
  const fetchImpl = fakeFetch({
    [BATCH]: answers(vulns("GHSA-a", "GHSA-b"), {}),
    [vulnUrl("GHSA-a")]: severe("GHSA-a", "MODERATE"),
    [vulnUrl("GHSA-b")]: severe("GHSA-b", "HIGH"),
  });
  const result = await checkPackages([pinned("minimist", "1.2.0"), pinned("left-pad", "1.3.0")], fetchImpl);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.vulnerabilities, [{ ecosystem: "npm", name: "minimist", version: "1.2.0", ids: ["GHSA-a", "GHSA-b"], highest: "HIGH" }]);
});

test("a result with a next page is asked again with its token until there is none", async () => {
  const fetchImpl = fakeFetch({
    [BATCH]: (init) => {
      const { queries } = JSON.parse(init.body);
      return { body: { results: queries.map((q) => (q.page_token ? vulns("GHSA-b") : { ...vulns("GHSA-a"), next_page_token: "t1" })) } };
    },
    [vulnUrl("GHSA-a")]: severe("GHSA-a", "LOW"),
    [vulnUrl("GHSA-b")]: severe("GHSA-b", "LOW"),
  });
  const result = await checkPackages([pinned("minimist", "1.2.0")], fetchImpl);
  assert.deepEqual(bodies(fetchImpl)[1], { queries: [{ package: { name: "minimist", ecosystem: "npm" }, version: "1.2.0", page_token: "t1" }] });
  assert.deepEqual(result.vulnerabilities[0].ids, ["GHSA-a", "GHSA-b"]);
});

test("withdrawn records are dropped: no finding, not listed", async () => {
  const fetchImpl = fakeFetch({
    [BATCH]: answers(vulns("MAL-1", "GHSA-a")),
    [vulnUrl("MAL-1")]: record("MAL-1", { withdrawn: "2025-01-01T00:00:00Z" }),
    [vulnUrl("GHSA-a")]: severe("GHSA-a", "HIGH"),
  });
  const result = await checkPackages([pinned("x", "1.0.0")], fetchImpl);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.vulnerabilities, [{ ecosystem: "npm", name: "x", version: "1.0.0", ids: ["GHSA-a"], highest: "HIGH" }]);
  const allWithdrawn = fakeFetch({ [BATCH]: answers(vulns("GHSA-a")), [vulnUrl("GHSA-a")]: record("GHSA-a", { withdrawn: "2025-01-01T00:00:00Z" }) });
  assert.deepEqual((await checkPackages([pinned("x", "1.0.0")], allWithdrawn)).vulnerabilities, []);
});

test("details are fetched for at most 200 ids, malicious ones first; the rest are listed without severity", async () => {
  const ids = Array.from({ length: 201 }, (_, i) => `GHSA-${i}`);
  const routes = { [BATCH]: answers(vulns(...ids), vulns("MAL-9")), [vulnUrl("MAL-9")]: record("MAL-9") };
  for (const id of ids) routes[vulnUrl(id)] = severe(id, "LOW");
  const fetchImpl = fakeFetch(routes);
  const result = await checkPackages([pinned("a", "1.0.0"), pinned("b", "2.0.0")], fetchImpl);
  const fetched = fetchImpl.calls.filter((url) => url.includes("/vulns/"));
  assert.equal(fetched.length, 200);
  assert.ok(fetched.includes(vulnUrl("MAL-9")));
  assert.ok(!fetched.includes(vulnUrl("GHSA-199")) && !fetched.includes(vulnUrl("GHSA-200")));
  assert.equal(result.detailsLeft, 2);
  assert.equal(result.vulnerabilities[0].ids.length, 201);
  assert.equal(result.vulnerabilities[0].highest, "LOW");
  assert.equal(result.findings.length, 1);
});

test("queries go 1,000 to a request", async () => {
  const fetchImpl = fakeFetch({ [BATCH]: (init) => ({ body: { results: JSON.parse(init.body).queries.map(() => ({})) } }) });
  const packages = Array.from({ length: 1001 }, (_, i) => pinned(`p${i}`, "1.0.0"));
  const result = await checkPackages(packages, fetchImpl);
  assert.deepEqual(bodies(fetchImpl).map((b) => b.queries.length), [1000, 1]);
  assert.deepEqual(result, { status: "done", findings: [], vulnerabilities: [], detailsLeft: 0 });
});

test("any failed request means the check did not run, with the reason; nothing partial is reported", async () => {
  const cases = [
    [{ [BATCH]: { status: 500, body: "oops" } }, /querybatch answered 500/],
    [{ [BATCH]: new Error("getaddrinfo ENOTFOUND api.osv.dev") }, /ENOTFOUND/],
    [{ [BATCH]: { body: "<html>" } }, /querybatch did not answer JSON/],
    [{ [BATCH]: () => ({ body: { results: [] } }) }, /querybatch answered 0 results for 1 queries/],
    [{ [BATCH]: answers(vulns("GHSA-a")) }, /vulns\/GHSA-a answered 404/],
  ];
  for (const [routes, reason] of cases) {
    const result = await checkPackages([pinned("x", "1.0.0")], fakeFetch(routes));
    assert.equal(result.status, "not-run");
    assert.match(result.reason, reason);
    assert.deepEqual(Object.keys(result), ["status", "reason"]);
  }
});

test("no packages: done, and nothing is sent", async () => {
  const fetchImpl = fakeFetch({});
  assert.deepEqual(await checkPackages([], fetchImpl), { status: "done", findings: [], vulnerabilities: [], detailsLeft: 0 });
  assert.deepEqual(fetchImpl.calls, []);
});

test("a name-only package is queried with no version, and only malicious records count for it", async () => {
  const fetchImpl = fakeFetch({
    [BATCH]: answers(vulns("GHSA-a", "MAL-2025-20690")),
    [vulnUrl("MAL-2025-20690")]: record("MAL-2025-20690", {
      affected: [{ package: { name: "flatmap-stream", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }] }],
    }),
  });
  const result = await checkPackages([nameOnly("flatmap-stream")], fetchImpl);
  assert.deepEqual(bodies(fetchImpl), [{ queries: [{ package: { name: "flatmap-stream", ecosystem: "npm" } }] }]);
  assert.ok(!fetchImpl.calls.includes(vulnUrl("GHSA-a")));
  assert.deepEqual(result.vulnerabilities, []);
  assert.deepEqual(result.findings, [{
    severity: "critical",
    category: "malicious-package",
    source: "osv",
    file: "package.json",
    line: null,
    detail: "flatmap-stream is listed as malicious in OSV, every version (MAL-2025-20690)",
  }]);
});

test("a name-only package with some malicious versions is a warning naming them", async () => {
  const fixedRange = { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "2.0.0" }] };
  const fetchImpl = fakeFetch({
    [BATCH]: answers(vulns("MAL-2025-46969"), vulns("MAL-2")),
    [vulnUrl("MAL-2025-46969")]: record("MAL-2025-46969", { affected: [{ package: { name: "chalk", ecosystem: "npm" }, versions: ["5.6.1"] }] }),
    [vulnUrl("MAL-2")]: record("MAL-2", { affected: [{ package: { name: "old", ecosystem: "npm" }, ranges: [fixedRange] }] }),
  });
  const result = await checkPackages([nameOnly("chalk"), nameOnly("old")], fetchImpl);
  assert.deepEqual(result.findings.map((f) => [f.severity, f.detail]), [
    ["warning", "chalk had malicious versions 5.6.1 (MAL-2025-46969); this project does not pin a version"],
    ["warning", "old had malicious versions >=0 <2.0.0 (MAL-2); this project does not pin a version"],
  ]);
});

test("the address can be changed with a base argument or OSV_URL", async () => {
  const other = fakeFetch({ "http://osv.test/v1/querybatch": answers({}) });
  assert.equal((await checkPackages([pinned("x", "1.0.0")], other, "http://osv.test")).status, "done");
  const saved = process.env.OSV_URL;
  process.env.OSV_URL = "http://osv.test";
  try {
    assert.equal((await checkPackages([pinned("x", "1.0.0")], other)).status, "done");
  } finally {
    if (saved === undefined) delete process.env.OSV_URL;
    else process.env.OSV_URL = saved;
  }
  assert.deepEqual(other.calls, ["http://osv.test/v1/querybatch", "http://osv.test/v1/querybatch"]);
});

test("a name-only package whose malicious record is past the 200 details says its versions were not fetched", async () => {
  const ids = Array.from({ length: 200 }, (_, i) => `MAL-${i}`);
  const routes = { [BATCH]: answers(vulns(...ids), vulns("MAL-late")) };
  for (const id of ids) routes[vulnUrl(id)] = record(id);
  const result = await checkPackages([pinned("a", "1.0.0"), nameOnly("b")], fakeFetch(routes));
  assert.deepEqual(result.findings.at(-1), {
    severity: "warning",
    category: "malicious-package",
    source: "osv",
    file: "package.json",
    line: null,
    detail: "b has malicious-package records in OSV (MAL-late); their versions were not fetched, and this project does not pin a version",
  });
  assert.equal(result.detailsLeft, 1);
});

test("a query OSV keeps paging past 50 pages, or with a token it gave before, means the check did not run", async () => {
  const endless = fakeFetch({ [BATCH]: (init) => ({ body: { results: [{ next_page_token: `t${JSON.parse(init.body).queries[0].page_token ?? ""}x` }] } }) });
  const result = await checkPackages([pinned("x", "1.0.0")], endless);
  assert.equal(result.status, "not-run");
  assert.match(result.reason, /more than 50 pages for x/);
  assert.equal(endless.calls.length, 50);
  const same = fakeFetch({ [BATCH]: answers({ next_page_token: "same" }) });
  const repeated = await checkPackages([pinned("x", "1.0.0")], same);
  assert.match(repeated.reason, /the same page token twice for x/);
  assert.equal(same.calls.length, 2);
});

test("a malformed malicious-package record is read as naming no versions, never as every version", async () => {
  const shapes = [
    { affected: [{ ranges: [{ events: [null, 7, { introduced: "0" }, { fixed: null }] }] }] },
    { affected: [null, "x", { ranges: "x" }, { ranges: [null, { events: "x" }] }, { versions: [null, 3] }] },
    { affected: "everything" },
  ];
  for (const shape of shapes) {
    const fetchImpl = fakeFetch({ [BATCH]: answers(vulns("MAL-1")), [vulnUrl("MAL-1")]: record("MAL-1", shape) });
    const result = await checkPackages([nameOnly("a")], fetchImpl);
    assert.deepEqual(result.findings.map((f) => [f.severity, f.detail]), [
      ["warning", "a has malicious-package records in OSV (MAL-1) that name no versions it can read; this project does not pin a version"],
    ], JSON.stringify(shape));
  }
  const notObject = fakeFetch({ [BATCH]: answers(vulns("MAL-1", "GHSA-a")), [vulnUrl("MAL-1")]: { body: "null" }, [vulnUrl("GHSA-a")]: { body: [1] } });
  const pinnedResult = await checkPackages([pinned("a", "1.0.0")], notObject);
  assert.equal(pinnedResult.findings[0].severity, "critical");
  assert.equal(pinnedResult.vulnerabilities[0].highest, null);
});

test("once a details request fails, no more are sent", async () => {
  const ids = Array.from({ length: 40 }, (_, i) => `GHSA-${i}`);
  const fetchImpl = fakeFetch({ [BATCH]: answers(vulns(...ids)) });
  const result = await checkPackages([pinned("a", "1.0.0")], fetchImpl);
  assert.equal(result.status, "not-run");
  assert.ok(fetchImpl.calls.filter((u) => u.includes("/vulns/")).length <= 8);
});

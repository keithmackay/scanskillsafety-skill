"use strict";
// ABOUTME: Guards against drift: lib/ must match a fresh build of the upstream scanner source
// ABOUTME: (when the sibling findsafeskills checkout exists), and SKILL.md/README.md must name
// ABOUTME: every check and every non-goal the scanner actually has.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { SAFETY_SCANNER_CHECKS } = require("../lib/checks");
const { SAFETY_SCANNER_NON_GOALS } = require("../lib/nonGoals");

const ROOT = path.join(__dirname, "..");
const UPSTREAM = path.join(ROOT, "..", "findsafeskills");
const norm = (s) => s.toLowerCase().replace(/[*_`]/g, "").replace(/\s+/g, " ");

test("lib/ matches a fresh build of findsafeskills/src/lib/safety", { skip: !fs.existsSync(path.join(UPSTREAM, "tsconfig.safety-skill.json")) && "sibling findsafeskills checkout not found" }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "scanskillsafety-lib-"));
  const build = spawnSync("npx", ["tsc", "-p", "tsconfig.safety-skill.json", "--outDir", out], { cwd: UPSTREAM, encoding: "utf-8" });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const diff = spawnSync("diff", ["-r", out, path.join(ROOT, "lib")], { encoding: "utf-8" });
  assert.equal(diff.status, 0, `lib/ is stale — run \`npm run build:safety-skill\` in findsafeskills.\n${diff.stdout}`);
});

for (const doc of ["SKILL.md", "README.md"]) {
  test(`${doc} names every scanner check and every non-goal`, () => {
    const text = norm(fs.readFileSync(path.join(ROOT, doc), "utf-8"));
    for (const { title } of [...SAFETY_SCANNER_CHECKS, ...SAFETY_SCANNER_NON_GOALS]) {
      assert.ok(text.includes(norm(title)), `${doc} is missing "${title}"`);
    }
  });
}

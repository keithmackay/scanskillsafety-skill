// ABOUTME: Reads scanskillsafety's command line: the target, --json, and for --deep its ref, the services it may contact, the
// ABOUTME: plan id that agrees to Claude's reading, the token budget and the model. Anything unknown or malformed is an error.
"use strict";

const { parseArgs } = require("util");

const OPTIONS = {
  json: { type: "boolean" },
  deep: { type: "boolean" },
  ref: { type: "string" },
  "no-site": { type: "boolean" },
  "no-osv": { type: "boolean" },
  "no-claude": { type: "boolean" },
  "claude-ok": { type: "string" },
  budget: { type: "string" },
  model: { type: "string" },
};
const DEEP_ONLY = ["ref", "no-site", "no-osv", "no-claude", "claude-ok", "budget", "model"];
const DEFAULT_MODEL = "sonnet";

function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) return { ok: false, error: "give exactly one target" };
  if (!values.deep) {
    const stray = DEEP_ONLY.find((name) => values[name] !== undefined);
    if (stray) return { ok: false, error: `--${stray} needs --deep` };
    return { ok: true, target: positionals[0], json: Boolean(values.json), deep: null };
  }
  let budget = null;
  if (values.budget !== undefined) {
    budget = /^\d+$/.test(values.budget) ? Number(values.budget) : NaN;
    if (!Number.isSafeInteger(budget) || budget < 1) return { ok: false, error: "--budget takes a positive whole number of tokens" };
  }
  return {
    ok: true,
    target: positionals[0],
    json: Boolean(values.json),
    deep: {
      ref: values.ref ?? null,
      site: !values["no-site"],
      osv: !values["no-osv"],
      claude: !values["no-claude"],
      claudeOk: values["claude-ok"] ?? null,
      budget,
      model: values.model ?? DEFAULT_MODEL,
    },
  };
}

module.exports = { parseCliArgs, DEFAULT_MODEL };

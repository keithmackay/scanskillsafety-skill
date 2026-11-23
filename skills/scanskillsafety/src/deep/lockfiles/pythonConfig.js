// ABOUTME: Reads Python config that names where installs fetch packages from: uv's settings, indexes and install-wide lists (uv.toml,
// ABOUTME: [tool.uv]), Poetry's, PDM's and Rye's sources, pdm.toml, and the settings that turn off certificate checks.
"use strict";

const { FIND_LINKS, INDEX, UNREADABLE } = require("../packageSources");
const { append, manifestEntries, normalisePyPI, unnamedEntry, withoutBom } = require("./shared");
const { certificateChecksOff, configEntry } = require("./configEntries");
const { after, arrayTables, stringOf, tomlValues } = require("./toml");
const { pythonAddress } = require("./python");
const { envAddress, keptRole } = require("./requirements");
const { projectRelative, requirementListEntries } = require("./requirementLists");

// An index or find-links address a setting names, `role` saying which: one set from an environment variable is said to be so;
// PDM's and Hatch's project folder is read as a path; a path inside the repository is a folder of archives; PyPI's index gives
// nothing.
function configAddressEntries(address, line, folder, role) {
  const relative = projectRelative(address);
  if (relative.includes("${")) return [configEntry(line, envAddress(role), keptRole(role))];
  const verdict = pythonAddress(relative, folder, { pathField: true, role });
  return verdict.expected ? [] : [configEntry(line, verdict, keptRole(role))];
}

// uv's allow-insecure-host, whatever hosts it names.
const INSECURE_HOSTS = certificateChecksOff("allow-insecure-host");
const SSL_UNVERIFIED = certificateChecksOff("verify_ssl = false");

// A source's verify_ssl: false is reported, true gives nothing, and any other value is one it cannot read.
function verifySslEntries(value) {
  const flag = value.kind === "scalar" ? value.text : null;
  if (flag === "false") return [configEntry(value.line, SSL_UNVERIFIED)];
  return flag === "true" ? [] : [configEntry(value.line, UNREADABLE)];
}

// uv's settings that name an index or a find-links page: one address, or a list of them.
const UV_ADDRESS_SETTINGS = new Map([
  ["index-url", { role: INDEX, list: false }],
  ["extra-index-url", { role: INDEX, list: true }],
  ["find-links", { role: FIND_LINKS, list: true }],
]);

// uv's index-url, extra-index-url and find-links at `prefix` (the top of uv.toml or its [pip], [tool.uv] in pyproject.toml or its
// [tool.uv.pip]), and allow-insecure-host there, whatever hosts it names (none gives nothing); an address setting that is not a string, or a list of strings
// where uv takes one, is one it cannot read.
function uvSettingEntries(values, prefix, folder) {
  const out = [];
  for (const { path, value } of values) {
    const rest = after(path, prefix);
    const noHosts = value.kind === "array" && value.items.length === 0;
    if (rest !== null && rest[0] === "allow-insecure-host" && !noHosts) out.push(configEntry(value.line, INSECURE_HOSTS));
    if (rest === null || !UV_ADDRESS_SETTINGS.has(rest[0])) continue;
    const { role, list } = UV_ADDRESS_SETTINGS.get(rest[0]);
    const items = list && value.kind === "array" ? value.items : [value];
    const addresses = items.map(stringOf);
    const shaped = rest.length === 1 && list === (value.kind === "array") && addresses.every((address) => address !== null);
    if (!shaped) out.push(configEntry(value.line, UNREADABLE));
    else items.forEach((item, k) => append(out, configAddressEntries(addresses[k], item.line, folder, role)));
  }
  return out;
}

// The url of each table at `prefix` (uv's indexes, Poetry's, PDM's and Rye's sources), read as what the table says it is (`roleOf`:
// an index or a find-links page, or null for a kind the tool does not take), and its verify_ssl where the tool has one
// (`verifiesSsl`). A table with no url is one it cannot read unless the tool needs none for it (`urlOptional`); a malformed section
// is one it cannot read, once.
function sourceTableEntries(values, prefix, folder, { roleOf, urlOptional = () => false, verifiesSsl = false }) {
  const { tables, badLine } = arrayTables(values, prefix);
  const out = badLine === null ? [] : [configEntry(badLine, UNREADABLE)];
  for (const { fields, line, nested } of tables) {
    const url = fields?.get("url");
    const urlLine = url?.line ?? line;
    if (fields === null || nested.has("url")) out.push(configEntry(urlLine, UNREADABLE));
    else if (url === undefined) {
      if (!urlOptional(fields)) out.push(configEntry(line, UNREADABLE));
    } else {
      const role = roleOf(fields);
      const address = stringOf(url);
      if (role === null || address === null) out.push(configEntry(urlLine, UNREADABLE));
      else append(out, configAddressEntries(address, urlLine, folder, role));
    }
    if (verifiesSsl && fields?.has("verify_ssl")) append(out, verifySslEntries(fields.get("verify_ssl")));
  }
  return out;
}

// What a table's field names it as, by its value: `kinds` maps each value the tool takes to a role; with no field, `absent`.
const roleByField = (field, kinds, absent) => (fields) => {
  if (!fields.has(field)) return absent;
  return kinds.get(stringOf(fields.get(field))) ?? null;
};

const UV_INDEX_ROLE = roleByField("format", new Map([["simple", INDEX], ["flat", FIND_LINKS]]), INDEX);
const PDM_SOURCE_ROLE = roleByField("type", new Map([["index", INDEX], ["find_links", FIND_LINKS]]), INDEX);
const RYE_SOURCE_ROLE = roleByField("type", new Map([["index", INDEX], ["find-links", FIND_LINKS]]), INDEX);

// uv's settings and indexes at `prefix` (the top of uv.toml, or [tool.uv] in pyproject.toml), and its settings for `uv pip` below
// it in [pip].
const uvConfigEntries = (values, prefix, folder) => [
  ...uvSettingEntries(values, prefix, folder),
  ...uvSettingEntries(values, [...prefix, "pip"], folder),
  ...sourceTableEntries(values, [...prefix, "index"], folder, { roleOf: UV_INDEX_ROLE }),
];

// uv's lists of PEP 508 strings that apply to every install, read whether or not a lockfile is present.
const UV_REQUIREMENT_LISTS = ["override-dependencies", "constraint-dependencies", "build-constraint-dependencies"];

// uv's install-wide lists at `prefix` (the top of uv.toml, or [tool.uv] in pyproject.toml): those in `lists` (by default its
// override, constraint and build constraint lists) and each `dependency-metadata` table's `requires-dist`, as a manifest's found
// entries whose names are never sent to OSV; a list or table in any other shape is one it cannot read.
function uvRequirementFound(values, prefix, folder, lists = UV_REQUIREMENT_LISTS) {
  const entries = [];
  for (const { path, value } of values) {
    const rest = after(path, prefix);
    if (rest === null || !lists.includes(rest[0])) continue;
    if (rest.length === 1) for (const entry of requirementListEntries(value, folder)) entries.push(entry);
    else entries.push(unnamedEntry(value.line));
  }
  const { tables, badLine } = arrayTables(values, [...prefix, "dependency-metadata"]);
  if (badLine !== null) entries.push(unnamedEntry(badLine));
  for (const { fields, line, nested } of tables) {
    if (fields === null || nested.has("requires-dist")) entries.push(unnamedEntry(line));
    else if (fields.has("requires-dist")) for (const entry of requirementListEntries(fields.get("requires-dist"), folder)) entries.push(entry);
  }
  return entries.map((entry) => ({ entry, checked: false }));
}

// Those lists as entries, without a manifest's other lists: only the packages from outside the registry.
const uvRequirementEntries = (values, prefix, folder) =>
  manifestEntries(uvRequirementFound(values, prefix, folder), (name) => (name === null ? null : normalisePyPI(name)));

// pdm.toml's indexes: [pypi] url, PyPI's replacement, an index; and [pypi.<name>] url, an index or, with `type = "find_links"`, a
// find-links page; and each one's verify_ssl. A url in any other place under [pypi], one that is not a string, or a type PDM does
// not take is one it cannot read.
function pdmTomlEntries(values, folder) {
  // Each index's own settings by name, "" being [pypi] itself: a setting sits at [pypi] or [pypi.<name>].
  const settings = new Map();
  const out = [];
  for (const { path, value } of values) {
    if (path[0] !== "pypi") continue;
    const rest = path.slice(1);
    // [pypi.url] is read as an index named url only for its own url: any other field under it is [pypi]'s url holding a table.
    const nestedUrl = rest[0] === "url" && rest.length === 2 && rest[1] !== "url";
    const own = rest.length === 1 || (rest.length === 2 && typeof rest[0] === "string" && !nestedUrl);
    if (own) {
      const name = rest.length === 1 ? "" : rest[0];
      if (!settings.has(name)) settings.set(name, new Map());
      settings.get(name).set(rest[rest.length - 1], value);
    } else if (rest.length === 0 || typeof rest[0] !== "string" || rest.slice(0, 2).includes("url")) {
      // [pypi] itself as a value, an array of tables, or a url with a value nested below it.
      out.push(configEntry(value.line, UNREADABLE));
    }
  }
  for (const [name, fields] of settings) {
    if (fields.has("url")) {
      const url = fields.get("url");
      const address = stringOf(url);
      // [pypi] replaces PyPI's index; only a named index may be a find-links page.
      const role = name === "" ? INDEX : PDM_SOURCE_ROLE(fields);
      if (address === null || role === null) out.push(configEntry(url.line, UNREADABLE));
      else append(out, configAddressEntries(address, url.line, folder, role));
    }
    if (fields.has("verify_ssl")) append(out, verifySslEntries(fields.get("verify_ssl")));
  }
  return out.sort((a, b) => a.line - b.line);
}

// pyproject.toml's settings that name where packages come from: uv's, Poetry's sources (one named PyPI needs no url), PDM's and
// Rye's.
const pyprojectConfigEntries = (values, folder) => [
  ...uvConfigEntries(values, ["tool", "uv"], folder),
  ...sourceTableEntries(values, ["tool", "poetry", "source"], folder, {
    roleOf: () => INDEX,
    urlOptional: (fields) => fields.has("name") && stringOf(fields.get("name"))?.toLowerCase() === "pypi",
    verifiesSsl: true,
  }),
  ...sourceTableEntries(values, ["tool", "pdm", "source"], folder, { roleOf: PDM_SOURCE_ROLE, verifiesSsl: true }),
  ...sourceTableEntries(values, ["tool", "rye", "sources"], folder, { roleOf: RYE_SOURCE_ROLE }),
];

// uv.toml: uv's index settings at its top level and in [pip], and its lists that apply to every install.
function readUvToml(text, folder = "") {
  const values = tomlValues(withoutBom(text));
  return [...uvConfigEntries(values, [], folder), ...uvRequirementEntries(values, [], folder)];
}

// pdm.toml: PDM's index settings.
const readPdmToml = (text, folder = "") => pdmTomlEntries(tomlValues(withoutBom(text)), folder);

module.exports = { pyprojectConfigEntries, readPdmToml, readUvToml, UV_REQUIREMENT_LISTS, uvRequirementEntries, uvRequirementFound };

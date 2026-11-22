// ABOUTME: Reads lists of PEP 508 requirements in TOML (pyproject.toml, uv.toml): each requirement's name and the address it installs
// ABOUTME: from, with the other item forms a list may take; an item it cannot read is reported, never ignored.
"use strict";

const { LOCAL } = require("../packageSources");
const { unnamedEntry, unreadableNamed } = require("./shared");
const { stringOf, tableFields } = require("./toml");
const { addressEntries, specifierEntries, splitName } = require("./requirements");

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WHITESPACE = /\s/;

// The project's own folder as PDM (`file:///${PROJECT_ROOT}`) and Hatch (`{root:uri}`) write it in a dependency's URL.
const PROJECT_ROOTS = ["file:///${PROJECT_ROOT}", "{root:uri}"];

// An address with the project's folder written as PDM or Hatch write it, as a path from the pyproject's folder; any other
// unchanged.
function projectRelative(address) {
  for (const root of PROJECT_ROOTS) {
    if (address === root) return ".";
    if (address.startsWith(`${root}/`)) return `./${address.slice(root.length + 1)}`;
  }
  return address;
}

// The entries of one address a requirement installs from (`name` null when it gives none), a local one kept so its name is held
// back from OSV.
function requirementAddressEntries(address, name, line, folder) {
  const entries = addressEntries(projectRelative(address), name, line, folder);
  return entries.length > 0 ? entries : [{ name, version: null, line, classified: LOCAL }];
}

// A PEP 508 requirement: `name [extras] @ url ; marker`, or `name [extras] specifiers ; marker`. A URL ends at whitespace, after
// which only a marker may follow. One that is not a requirement it can read keeps its name when it has one; a bare URL has none.
function requirementEntries(text, line, folder) {
  const requirement = text.trim();
  const parts = SCHEME.test(requirement) ? null : splitName(requirement);
  if (parts === null) return [unnamedEntry(line)];
  if (parts.rest.startsWith("@")) {
    const address = parts.rest.slice(1).trimStart();
    const end = address.search(WHITESPACE);
    const marker = end < 0 ? "" : address.slice(end).trim();
    if (marker !== "" && !marker.startsWith(";")) return [unreadableNamed(parts.name, line)];
    return requirementAddressEntries(end < 0 ? address : address.slice(0, end), parts.name, line, folder);
  }
  const specified = specifierEntries({ name: parts.name, rest: parts.rest.split(";", 1)[0] }, line);
  if (specified !== null && specified[0].classified !== undefined) return specified;
  return [{ name: parts.name, version: null, line }];
}

// How a list's items may be written besides PEP 508 strings: a dependency group's `{ include-group = "name" }`, which names no
// source; uv's extra build dependency `{ requirement = "…", match-runtime = … }`; PDM's editable `-e <address>`.
const GROUPS = "groups";
const BUILD = "build";
const EDITABLE = "editable";

// The requirement in a uv extra build dependency table, or null when the table is not one.
function buildRequirement(item) {
  const fields = tableFields(item);
  if (fields === null || [...fields.keys()].some((field) => field !== "requirement" && field !== "match-runtime")) return null;
  return fields.has("requirement") ? stringOf(fields.get("requirement")) : null;
}

const isIncludeGroup = (item) => {
  const fields = tableFields(item);
  return fields !== null && fields.size === 1 && fields.has("include-group") && stringOf(fields.get("include-group")) !== null;
};

// An array of PEP 508 strings, with the other items its `form` allows; any other item is one it cannot read.
function requirementListEntries(value, folder, form) {
  if (value.kind !== "array") return [unnamedEntry(value.line)];
  return value.items.flatMap((item) => {
    // A multi-line string has no text, so like any other item it does not know it is one it cannot read.
    const text = stringOf(item);
    if (text !== null && form === EDITABLE && /^-e\s/.test(`${text.trim()} `)) {
      const address = text.trim().slice(2).trim();
      return address === "" ? [unnamedEntry(item.line)] : requirementAddressEntries(address, null, item.line, folder);
    }
    if (text !== null) return requirementEntries(text, item.line, folder);
    if (form === GROUPS && isIncludeGroup(item)) return [];
    const requirement = form === BUILD ? buildRequirement(item) : null;
    return requirement === null ? [unnamedEntry(item.line)] : requirementEntries(requirement, item.line, folder);
  });
}

module.exports = { BUILD, EDITABLE, GROUPS, projectRelative, requirementListEntries };

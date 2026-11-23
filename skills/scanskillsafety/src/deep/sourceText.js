// ABOUTME: Words a package or setting from outside the registry: what packages come from, what a setting or index line names, and
// ABOUTME: the whole warning text, built only from classified fields (cut addresses, fixed texts, parsed names), never raw input.
"use strict";

const { n } = require("./util");
const { ALLOWS_HTTP, FIND_LINKS } = require("./packageSources");
const { ENV_INDEX } = require("./lockfiles/requirements");
const { OUTSIDE_PROJECT } = require("./lockfiles/shared");

// The most characters of one field (an address, a scope, a file, a version) shown, so one value cannot fill the screen.
const FIELD_MAX = 300;

// A field as shown: cut at FIELD_MAX characters (code points), with … marking the cut.
function fieldText(text) {
  const chars = Array.from(text);
  return chars.length > FIELD_MAX ? `${chars.slice(0, FIELD_MAX).join("")}…` : text;
}

// What packages come from, after "comes from": the address (git with its commit), a bundled file with what it is, or the fixed
// text a source with no address has.
function packageSource({ kind, address, commit, text }) {
  if (address === null) return text;
  const shown = fieldText(address);
  if (kind === "git") return `git ${shown}${commit ? ` (commit ${commit})` : ""}`;
  if (kind === "bundled") return `${shown}, ${text}`;
  return shown;
}

// The fixed texts of a line with no address that name something rather than say what the setting does; every other such text
// (a setting that turns off certificate checks, hides the registry) is already said as what the setting does.
const NAMED_BY_LINE = new Set([ENV_INDEX.text, OUTSIDE_PROJECT.text]);

// What a setting or index line does, as a verb phrase after its file and line.
function lineText({ kind, address, text, from, ecosystem, scope, role }) {
  if (kind === "unreadable") return "names a source it could not read";
  if (address === null) return NAMED_BY_LINE.has(text) ? `names ${text}` : text;
  const shown = fieldText(address);
  if (role === ALLOWS_HTTP) return `allows plain http from ${shown}`;
  if (kind === "bundled") return `names ${shown}, ${text}`;
  if (role === FIND_LINKS) return `names a find-links page ${shown}`;
  if (from === "requirements") return `names the package index ${shown}`;
  return `names the ${ecosystem} registry ${shown} for ${scope ? `${fieldText(scope)} ` : ""}installs in this folder`;
}

// A source entry's warning text: a line's verb phrase, or its packages (one by name, several by count) and where they come from.
function sourceDetail(entry) {
  if (entry.from) return lineText(entry);
  const one = entry.total === 1;
  const who = one ? entry.packages[0].name ?? "a package" : `${n(entry.total)} packages`;
  if (entry.kind === "unreadable") return `${who} ${one ? "has" : "have"} a source it could not read`;
  return `${who} ${one ? "comes" : "come"} from ${packageSource(entry)}`;
}

module.exports = { packageSource, lineText, sourceDetail, fieldText };

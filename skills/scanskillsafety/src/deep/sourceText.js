// ABOUTME: Words a package or setting from outside the registry: what packages come from, what a setting or index line names, and
// ABOUTME: the whole warning text, built only from classified fields (cut addresses, fixed texts, parsed names), never raw input.
"use strict";

const { n } = require("./util");
const { ENV_INDEX } = require("./lockfiles/requirements");
const { OUTSIDE_PROJECT } = require("./lockfiles/shared");

// What packages come from, after "comes from": the address (git with its commit), a bundled file with what it is, or the fixed
// text a source with no address has.
function packageSource({ kind, address, commit, text }) {
  if (address === null) return text;
  if (kind === "git") return `git ${address}${commit ? ` (commit ${commit})` : ""}`;
  if (kind === "bundled") return `${address}, ${text}`;
  return address;
}

// The fixed texts of a line with no address that name something rather than say what the setting does; every other such text
// (a setting that turns off certificate checks, hides the registry) is already said as what the setting does.
const NAMED_BY_LINE = new Set([ENV_INDEX.text, OUTSIDE_PROJECT.text]);

// What a setting or index line does, as a verb phrase after its file and line.
function lineText({ kind, address, text, from, ecosystem, scope }) {
  if (kind === "unreadable") return "names a source it could not read";
  if (address === null) return NAMED_BY_LINE.has(text) ? `names ${text}` : text;
  if (kind === "http") return `allows plain http from ${address}`;
  if (kind === "bundled") return `names ${address}, ${text}`;
  if (from === "requirements") return `names the package index ${address}`;
  return `names the ${ecosystem} registry ${address} for ${scope ? `${scope} ` : ""}installs in this folder`;
}

// A source entry's warning text: a line's verb phrase, or its packages (one by name, several by count) and where they come from.
function sourceDetail(entry) {
  if (entry.from) return lineText(entry);
  const one = entry.total === 1;
  const who = one ? entry.packages[0].name ?? "a package" : `${n(entry.total)} packages`;
  if (entry.kind === "unreadable") return `${who} ${one ? "has" : "have"} a source it could not read`;
  return `${who} ${one ? "comes" : "come"} from ${packageSource(entry)}`;
}

module.exports = { packageSource, lineText, sourceDetail };

// ABOUTME: Words a package or setting from outside the registry: what packages come from, what a setting or index line names, and
// ABOUTME: the whole warning text, built only from classified fields (cut addresses, fixed texts, parsed names), never raw input;
// ABOUTME: a long address, scope or version is cut, and a name that breaks the registries' name rules is quoted.
"use strict";

const { n } = require("./util");
const { cut } = require("../printable");
const { ALLOWS_HTTP, FIND_LINKS } = require("./packageSources");
const { ENV_FIND_LINKS, ENV_INDEX } = require("./lockfiles/requirements");
const { OUTSIDE_PROJECT } = require("./lockfiles/shared");

// The most characters of one field (an address, a scope, a version) shown, so one value cannot fill the screen; a longer one is
// cut and marked with "…".
const FIELD_MAX = 300;

// A name npm or PyPI could publish: letters, digits, `.`, `_`, `~` and `-`, after an optional `@scope/`. Any other (spaces, commas,
// brackets, quotes, control characters) could read as part of the sentence around it.
const PLAIN_NAME = /^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/;

// A package's name as shown: as it is when it keeps to those rules, else in quotes with any quote, backslash or control character
// escaped; a package with no name is "a package".
function packageName(name) {
  if (name === null) return "a package";
  return PLAIN_NAME.test(name) ? name : JSON.stringify(name);
}

// Version control other than git, whose addresses keep the `hg+`, `svn+` or `bzr+` that names it.
const OTHER_VCS = /^(?:hg|svn|bzr)\+/i;

// What packages come from, after "comes from": the address (a git one after the word git, with its commit), a bundled file with
// what it is, or the fixed text a source with no address has.
function packageSource({ kind, address, commit, text }) {
  if (address === null) return text;
  const shown = cut(address, FIELD_MAX, "…");
  if (kind === "git") return `${OTHER_VCS.test(address) ? "" : "git "}${shown}${commit ? ` (commit ${commit})` : ""}`;
  if (kind === "bundled") return `${shown}, ${text}`;
  return shown;
}

// The fixed texts of a line with no address that name something rather than say what the setting does; every other such text
// (a setting that turns off certificate checks, hides the registry) is already said as what the setting does.
const NAMED_BY_LINE = new Set([ENV_INDEX.text, ENV_FIND_LINKS.text, OUTSIDE_PROJECT.text]);

// What a setting or index line does, as a verb phrase after its file and line.
function lineText({ kind, address, text, from, ecosystem, scope, role }) {
  if (kind === "unreadable") return "names a source it could not read";
  if (address === null) return NAMED_BY_LINE.has(text) ? `names ${text}` : text;
  const shown = cut(address, FIELD_MAX, "…");
  if (role === ALLOWS_HTTP) return `allows plain http from ${shown}`;
  if (kind === "bundled") return `names ${shown}, ${text}`;
  if (role === FIND_LINKS) return `names a find-links page ${shown}`;
  if (from === "requirements") return `names the package index ${shown}`;
  return `names the ${ecosystem} registry ${shown} for ${scope ? `${cut(scope, FIELD_MAX, "…")} ` : ""}installs in this folder`;
}

// A package entry's subject (`subject`, naming its one package or counting them) followed by where they come from, or that their
// source could not be read, the verb agreeing with how many there are.
function comesFrom(subject, entry) {
  const one = entry.total === 1;
  if (entry.kind === "unreadable") return `${subject} ${one ? "has" : "have"} a source it could not read`;
  return `${subject} ${one ? "comes" : "come"} from ${packageSource(entry)}`;
}

// A source entry's warning text: a line's verb phrase, or its packages (one by name, several by count) and where they come from.
function sourceDetail(entry) {
  if (entry.from) return lineText(entry);
  return comesFrom(entry.total === 1 ? packageName(entry.packages[0].name) : `${n(entry.total)} packages`, entry);
}

module.exports = { comesFrom, lineText, packageName, packageSource, sourceDetail, FIELD_MAX };

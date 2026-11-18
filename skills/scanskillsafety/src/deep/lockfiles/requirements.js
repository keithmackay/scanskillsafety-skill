// ABOUTME: Reads a requirements file as pip reads one: joined lines, comments and options in every spelling, giving pinned
// ABOUTME: requirements, sources, index options and the -r and -c files it names; a line it cannot read is reported, never ignored.
"use strict";

const { OBJECT_ID } = require("../util");
const { classifySource, UNREADABLE } = require("../packageSources");
const { found, isPackageArchive, linesOf, OUTSIDE_PROJECT, pathFrom, Unreadable, UNREADABLE_ENTRY } = require("./shared");
const { pythonAddress } = require("./python");

// pip ends a line at each of these as well as at \n and \r\n (Python's splitlines), so
// a line holding one is read differently by pip than line by line.
const PIP_LINE_BREAK = /[\r\v\f\x1c-\x1e\x85\u2028\u2029]/;
// Characters JavaScript reads as whitespace and pip's patterns do not (a BOM after the first character, and \x1f, which Python
// strips but its \s does not match), so a comment or a word would end in a different place.
const SPACE_PIP_READS_OTHERWISE = /[\uFEFF\x1f]/;
// PEP 263's coding line, which pip honours in the first two lines when the file has no BOM.
const CODING = /coding[:=][ \t\n\r\f\v]*([-\w.]+)/;
const UTF8_NAMES = new Set(["utf-8", "utf8", "utf_8", "u8", "utf-8-sig"]);
// Whitespace other than a space: pip splits a line into words at spaces only.
const OTHER_WHITESPACE = /[^\S ]/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const REQUIREMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*/;
const EGG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EXTRAS = /^\[[A-Za-z0-9._,\s-]*\]$/;
const VERSION_CLAUSE = /^(===|==|!=|<=|>=|~=|<|>)\s*([A-Za-z0-9._*+!-]+)$/;
const TRUSTED_HOST = /^([A-Za-z0-9.-]+)(?::\d+)?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const VCS_PREFIXES = ["git+", "hg+", "svn+", "bzr+"];
const ENV_INDEX = Object.freeze({ expected: false, kind: "host", address: null, text: "an index set from an environment variable" });

// What each option pip reads in a requirements file does here: names an index or a folder of archives, allows plain http to a
// host, names another requirements or constraints file, installs an editable project, applies to the requirement on its line,
// or changes nothing about where a package comes from (a flag, or a setting with a value).
const INDEX = "index";
const FIND_LINKS = "find-links";
const TRUSTED = "trusted";
const OTHER_FILE = "file";
const EDITABLE = "editable";
const REQUIREMENT_OPTION = "requirement";
const FLAG = "flag";
const SETTING = "setting";
const LONG_OPTIONS = new Map([
  ["--index-url", INDEX],
  ["--pypi-url", INDEX],
  ["--extra-index-url", INDEX],
  ["--find-links", FIND_LINKS],
  ["--trusted-host", TRUSTED],
  ["--requirement", OTHER_FILE],
  ["--constraint", OTHER_FILE],
  ["--editable", EDITABLE],
  ["--hash", REQUIREMENT_OPTION],
  ["--config-settings", REQUIREMENT_OPTION],
  // Passed to the package's build; it changes how the package is built, not where it is downloaded from.
  ["--global-option", REQUIREMENT_OPTION],
  ["--no-index", FLAG],
  ["--no-require-hashes", FLAG],
  ["--pre", FLAG],
  ["--prefer-binary", FLAG],
  ["--require-hashes", FLAG],
  ["--no-binary", SETTING],
  ["--only-binary", SETTING],
  ["--use-feature", SETTING],
  ["--all-releases", SETTING],
  ["--only-final", SETTING],
]);
const SHORT_OPTIONS = new Map([["-i", "--index-url"], ["-f", "--find-links"], ["-r", "--requirement"], ["-c", "--constraint"], ["-e", "--editable"], ["-C", "--config-settings"]]);

const lineEntry = (line, verdict) => ({ line, from: "requirements", classified: verdict });
const unreadableRequirement = (name, line) => ({ name, version: null, line, ...UNREADABLE_ENTRY });
// A line it cannot read, naming no package it can tell.
const unreadableLine = (line) => unreadableRequirement(null, line);

// The text without the backslashes at either end, as pip strips a line it joins to the next.
function withoutEndBackslashes(text) {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "\\") start++;
  while (end > start && text[end - 1] === "\\") end--;
  return text.slice(start, end);
}

const withoutBom = (text) => (text.startsWith("\uFEFF") ? text.slice(1) : text);

// A file whose first or second line, starting with `#`, names an encoding other than UTF-8, and that has no BOM: pip decodes it
// with that encoding, so its lines are not the ones read here.
function declaresOtherEncoding(text) {
  if (text.startsWith("\uFEFF")) return false;
  return text.split("\n", 2).some((line) => {
    const coding = line.startsWith("#") ? CODING.exec(line) : null;
    return coding !== null && !UTF8_NAMES.has(coding[1].toLowerCase());
  });
}

const isCommentLine = (text) => text.trimStart().startsWith("#");

// pip's lines: physical lines joined across a trailing backslash (a comment line never continues), each with the number of its
// first line. A physical line pip would end somewhere this reader does not is given with no text.
function logicalLines(text) {
  const out = [];
  let joined = null;
  const flush = () => {
    if (joined) out.push(joined);
    joined = null;
  };
  linesOf(withoutBom(text)).forEach((physical, i) => {
    if (PIP_LINE_BREAK.test(physical) || SPACE_PIP_READS_OTHERWISE.test(physical)) {
      flush();
      out.push({ line: i + 1, text: null });
    } else if (physical.endsWith("\\") && !isCommentLine(physical)) {
      joined ??= { line: i + 1, text: "" };
      joined.text += withoutEndBackslashes(physical);
    } else if (joined) {
      joined.text += isCommentLine(physical) ? ` ${physical}` : physical;
      flush();
    } else out.push({ line: i + 1, text: physical });
  });
  flush();
  return out;
}

// The text before its comment: a `#` at the start or after whitespace. A `#` inside a word, as in a URL's `#egg=`, is kept.
function withoutComment(text) {
  let hash = text.indexOf("#");
  while (hash > 0 && !/\s/.test(text[hash - 1])) hash = text.indexOf("#", hash + 1);
  return hash < 0 ? text : text.slice(0, hash);
}

// An option word's long name and the value written in it: `--name=value`, `--name`, `-xvalue` or `-x` (the short name read as its
// long one); the value is undefined when the word holds none.
function splitOption(word) {
  if (!word.startsWith("--")) return { name: SHORT_OPTIONS.get(word.slice(0, 2)), value: word.length > 2 ? word.slice(2) : undefined };
  const sep = word.indexOf("=");
  return sep < 0 ? { name: word, value: undefined } : { name: word.slice(0, sep), value: word.slice(sep + 1) };
}

// The options of a line, as pip's option parser reads them: `--name=value`, `--name value`, `-xvalue` or `-x value`. null when a
// word is not an option pip reads in a requirements file, an option lacks its value or a flag has one, or a word is quoted or
// escaped, which pip reads in a way this reader does not.
function parseOptions(words) {
  const options = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (/["'\\]/.test(word) || !word.startsWith("-")) return null;
    const split = splitOption(word);
    const kind = LONG_OPTIONS.get(split.name);
    let { value } = split;
    if (kind === undefined || (kind === FLAG && value !== undefined)) return null;
    if (kind !== FLAG && value === undefined) {
      if (i + 1 === words.length || /["'\\]/.test(words[i + 1])) return null;
      value = words[++i];
    }
    options.push({ kind, value });
  }
  return options;
}

// A version control address (`git+`, `hg+`, `svn+`, `bzr+`), shown without user info, query, fragment or the `@<revision>` pip
// reads after the path; a git revision that is a commit id is kept. null when the address is not one.
function vcsVerdict(address, folder) {
  const vcs = VCS_PREFIXES.find((prefix) => address.slice(0, prefix.length).toLowerCase() === prefix);
  if (!vcs) return null;
  const inner = address.slice(vcs.length);
  if (/^file:/i.test(inner)) return pythonAddress(inner, folder);
  let url = null;
  try {
    url = new URL(inner);
  } catch {}
  if (!url || !url.host) return UNREADABLE;
  const at = url.pathname.lastIndexOf("@");
  const repoPath = at < 0 ? url.pathname : url.pathname.slice(0, at);
  const revision = at < 0 ? "" : url.pathname.slice(at + 1);
  const shown = `${vcs === "git+" ? "" : vcs}${url.protocol}//${url.host}${repoPath}`;
  const verdict = { expected: false, kind: "git", address: shown };
  return vcs === "git+" && OBJECT_ID.test(revision) ? { ...verdict, commit: revision } : verdict;
}

// The project name an address gives in its `#egg=` fragment, or null.
function eggName(address) {
  const hash = address.indexOf("#");
  if (hash < 0) return null;
  const egg = address.slice(hash + 1).split("&").find((part) => part.startsWith("egg="));
  return egg !== undefined && EGG_NAME.test(egg.slice(4)) ? egg.slice(4) : null;
}

const WHEEL = /\.whl$/i;
const SDIST = /\.(?:zip|tar(?:\.(?:gz|bz2|xz|lz|lzma))?)$/i;

// The name and version an archive's file name gives: a wheel's are its first two `-` parts (of at least five), a source archive's
// the text either side of its last `-`. null when the file is neither or the name is not one.
function archiveNameAndVersion(address) {
  const path = address.split("#", 1)[0].split("?", 1)[0];
  const file = path.slice(path.lastIndexOf("/") + 1);
  let parts = null;
  if (WHEEL.test(file)) {
    const fields = file.slice(0, -".whl".length).split("-");
    if (fields.length >= 5) parts = fields;
  } else if (SDIST.test(file)) {
    const stem = file.replace(SDIST, "");
    const dash = stem.lastIndexOf("-");
    if (dash > 0) parts = [stem.slice(0, dash), stem.slice(dash + 1)];
  }
  return parts && EGG_NAME.test(parts[0]) ? { name: parts[0], version: parts[1] } : null;
}

// A path without the `[extras]` pip allows after it.
const withoutExtras = (path) => (path.endsWith("]") && path.includes("[") ? path.slice(0, path.lastIndexOf("[")) : path);

// One address a requirement installs from: a version control address, a URL (one archive), or a path. A path inside the project
// gives nothing. An archive on the official registry with no name given is the package its file name names, checked by that
// name and the version, when it is one; a file there whose name names no package is one it cannot read.
function addressEntries(address, name, line, folder) {
  if (address === "" || /\s/.test(address)) return [unreadableRequirement(name, line)];
  const verdict =
    vcsVerdict(address, folder) ??
    (SCHEME.test(address)
      ? pythonAddress(address, folder, { direct: true })
      : pythonAddress(withoutExtras(address), folder, { pathField: true }));
  const named = name ?? eggName(address);
  if (verdict.unreadable) return [unreadableRequirement(named, line)];
  if (verdict.kind === "local") return [];
  if (verdict.expected && named === null) {
    const archive = archiveNameAndVersion(address);
    return archive ? [{ ...archive, line, classified: verdict }] : [unreadableLine(line)];
  }
  return [{ name: named, version: null, line, classified: verdict }];
}

// A requirement's name and the text after it and its `[extras]`; null when it does not start with a name.
function splitName(text) {
  const name = REQUIREMENT_NAME.exec(text)?.[0];
  if (name === undefined) return null;
  let rest = text.slice(name.length).trimStart();
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close < 0 || !EXTRAS.test(rest.slice(0, close + 1))) return null;
    rest = rest.slice(close + 1).trimStart();
  }
  return { name, rest };
}

// A requirement by name and version specifier. An exact `==` pin is kept with its version; a wildcard pin (`==1.0.*`) or an
// arbitrary equality (`===`) is kept with no version, so OSV is asked about the name; any other specifier, or none, is not a
// pinned version (null). A specifier that is not one pip reads makes the requirement one it could not read.
function specifierEntries({ name, rest }, line) {
  let specifier = rest.trim();
  if (specifier === "") return null;
  if (specifier.startsWith("(") && specifier.endsWith(")")) specifier = specifier.slice(1, -1).trim();
  const clauses = specifier.split(",").map((clause) => VERSION_CLAUSE.exec(clause.trim()));
  if (clauses.some((clause) => clause === null)) return [unreadableRequirement(name, line)];
  if (clauses.length !== 1) return null;
  const [, operator, version] = clauses[0];
  if (operator === "===" || (operator === "==" && version.endsWith(".*"))) return [{ name, version: null, line }];
  return operator === "==" ? [{ name, version, line }] : null;
}

const looksLikePath = (text) => /^[.~]/.test(text) || text.includes("/") || text.includes("\\") || isPackageArchive(text);

// A requirement line's words before its options: a version control address or URL (its marker after "; "), `name @ address`, a
// path, or a name with a version specifier (its marker after ";"). An environment variable in it is one it cannot read.
function requirementEntries(text, line, folder) {
  if (text.includes("${")) return [unreadableLine(line)];
  if (SCHEME.test(text)) {
    return addressEntries(text.split("; ", 1)[0].trim(), null, line, folder);
  }
  const requirement = text.split(";", 1)[0].trim();
  const parts = splitName(requirement);
  if (parts && parts.rest.startsWith("@")) return addressEntries(parts.rest.slice(1).trim(), parts.name, line, folder);
  if (looksLikePath(requirement)) return addressEntries(requirement, null, line, folder);
  return parts ? specifierEntries(parts, line) : [unreadableLine(line)];
}

// An index (`-i`, `--extra-index-url`, `--pypi-url`) or a place to find archives (`-f`, which may be a folder): reported unless it
// is PyPI's index or a folder inside the project; a find-links page is reported on any host. One set from an environment variable
// is reported as such.
function indexEntries(value, line, folder, role) {
  if (value.includes("${")) return [lineEntry(line, ENV_INDEX)];
  const verdict = pythonAddress(value, folder, { pathField: role === "find-links", role });
  if (verdict.unreadable) return [unreadableLine(line)];
  return verdict.expected || verdict.kind === "local" ? [] : [lineEntry(line, verdict)];
}

// A `--trusted-host` value: a host name with a letter in it, or an IPv4 address of four parts, with an optional port; any other is
// one it cannot read, so a number is never shown as the address a URL parser makes of it.
function trustedHostEntries(value, line) {
  const host = TRUSTED_HOST.exec(value)?.[1];
  const known = host !== undefined && (/[A-Za-z]/.test(host) || IPV4.test(host));
  const verdict = known ? classifySource("PyPI", `http://${value}`) : UNREADABLE;
  return verdict.unreadable ? [unreadableLine(line)] : [lineEntry(line, verdict)];
}

// What an option on a line of options gives. A `-r` or `-c` file inside the repository is a file to read in turn (`requires`, its
// path in the repository); one outside it is reported; one at a URL is one it cannot read.
function optionEntries({ kind, value }, line, folder) {
  if (kind === INDEX) return indexEntries(value, line, folder, "index");
  if (kind === FIND_LINKS) return indexEntries(value, line, folder, "find-links");
  if (kind === TRUSTED) return trustedHostEntries(value, line);
  if (kind !== OTHER_FILE) return [];
  const verdict = pythonAddress(value, folder, { pathField: true });
  if (verdict.kind === "local") return [{ line, requires: pathFrom(folder, value) }];
  return verdict === OUTSIDE_PROJECT ? [lineEntry(line, verdict)] : [unreadableLine(line)];
}

// One line of a requirements file, without its comment. Its words up to the first that starts with `-` are a requirement, which
// may be followed only by the options pip applies to one requirement; a line of options alone gives what each option names, and
// one with `-e` installs that one address. pip expands environment variables before it reads options, so one in any option value
// but an index's is one it cannot read. null for a requirement with no pinned version.
function requirementsLineEntries(text, line, folder) {
  if (OTHER_WHITESPACE.test(text)) return [unreadableLine(line)];
  const words = text.split(" ");
  const first = words.findIndex((word) => word.startsWith("-"));
  const requirement = (first < 0 ? words : words.slice(0, first)).join(" ").trim();
  const options = parseOptions(first < 0 ? [] : words.slice(first).filter((word) => word !== ""));
  const expanded = (option) => option.kind !== INDEX && option.kind !== FIND_LINKS && option.value?.includes("${");
  if (options === null || options.some(expanded)) return [unreadableLine(line)];
  if (requirement !== "") {
    const others = options.some((option) => option.kind !== REQUIREMENT_OPTION);
    return others ? [unreadableLine(line)] : requirementEntries(requirement, line, folder);
  }
  const editables = options.filter((option) => option.kind === EDITABLE);
  if (editables.length === 0) return options.flatMap((option) => optionEntries(option, line, folder));
  const alone = editables.length === 1 && options.every((option) => option.kind === EDITABLE || option.kind === REQUIREMENT_OPTION);
  return alone ? addressEntries(editables[0].value, null, line, folder) : [unreadableLine(line)];
}

// text: a requirements file; folder: its folder in the repository, which a relative path in it is read from. Pinned requirements,
// sources (version control, URLs, paths outside the project), index options and the -r and -c files it names, line by line, and
// how many of its requirements are unpinned. One that declares an encoding other than UTF-8 is one it cannot read.
function requirementsFile(text, folder) {
  if (declaresOtherEncoding(text)) throw new Unreadable("an encoding it cannot read");
  const entries = [];
  let unpinned = 0;
  for (const logical of logicalLines(text)) {
    const content = logical.text === null ? null : withoutComment(logical.text).trim();
    if (content === "") continue;
    const lineEntries = content === null ? [unreadableLine(logical.line)] : requirementsLineEntries(content, logical.line, folder);
    if (lineEntries === null) unpinned++;
    else entries.push(...lineEntries);
  }
  return { entries, unpinned };
}

// A requirements file read in its own right: one whose only requirements are unpinned has no pinned versions in it.
function readRequirements(text, folder = "") {
  const { entries, unpinned } = requirementsFile(text, folder);
  return found(entries, unpinned, "no pinned versions in it");
}

// A file a requirements file names with -r or -c: read whatever it holds, so one with only unpinned requirements (a constraints
// file of ranges) gives nothing to check rather than a file it could not read.
const readNamedRequirements = (text, folder = "") => requirementsFile(text, folder).entries;

module.exports = { readRequirements, readNamedRequirements, addressEntries, specifierEntries, splitName };

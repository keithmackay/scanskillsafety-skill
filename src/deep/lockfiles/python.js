// ABOUTME: Reads the packages in Python lockfiles, each with its line: poetry.lock and uv.lock package blocks and where each comes
// ABOUTME: from, read strictly as Poetry and uv write their TOML, and a requirements file's pins, sources and index options.
"use strict";

const { OBJECT_ID } = require("../util");
const { classifySource, LOCAL, UNREADABLE } = require("../packageSources");
const { found, gitRepositorySource, linesOf, unnamedEntry, Unreadable, UNREADABLE_ENTRY } = require("./shared");
const { tomlStatements } = require("./toml");

// The fields Poetry writes in [package.source].
const POETRY_SOURCE_FIELDS = new Set(["type", "url", "reference", "resolved_reference", "subdirectory"]);
// The kinds of uv `source`, one per source; `subdirectory` may sit beside `url`.
const UV_SOURCE_KINDS = ["registry", "git", "url", "path", "directory", "editable", "virtual"];
// The fields uv writes in an `sdist` or a `wheels` item.
const UV_FILE_FIELDS = new Set(["url", "path", "filename", "hash", "size", "upload-time"]);
const OUTSIDE_PROJECT = Object.freeze({ expected: false, kind: "url", address: null, text: "a path outside the project" });
const PROJECT = Object.freeze({ project: true });
// A Poetry block with no [package.source]: from whatever index the project is set to use.
const NO_SOURCE = Object.freeze({});

// The starts of an address that make it a path rather than a URL: absolute, home, or relative to the lockfile's folder.
const PATH_STARTS = ["/", "~", "./", "../"];
const DRIVE = /^[A-Za-z]:(?:[\\/]|$)/;

// The path, inside the repository, of a relative path read from a folder that it never climbs above.
function pathFrom(folder, path) {
  const segments = [];
  for (const segment of [...folder.split("/"), ...path.split("/")]) {
    if (segment === "..") segments.pop();
    else if (segment !== "." && segment !== "") segments.push(segment);
  }
  return segments.join("/");
}

// A relative path that, read from the lockfile's folder, never climbs above the repository root; an absolute path, a home path, a
// drive or a scheme leaves it.
function staysInside(folder, path) {
  if (path === "" || path.startsWith("/") || path.startsWith("~") || path.includes(":") || path.includes("\\")) return false;
  let depth = 0;
  for (const segment of [...folder.split("/"), ...path.split("/")]) {
    if (segment === "..") depth--;
    else if (segment !== "." && segment !== "") depth++;
    if (depth < 0) return false;
  }
  return true;
}

// Where an address in a Python lockfile points, `folder` being the lockfile's folder in the repository. A `file:` URL is outside
// the project. A path (absolute, home, a drive, starting `./` or `../`, or, in a field that holds a path, any name with no `:`) is
// local while it stays inside the repository and outside the project otherwise. Any other address is classified: as a git
// repository when the field names one, as one archive when it pins one.
function pythonAddress(address, folder, { pathField = false, git = false, direct = false } = {}) {
  if (/^file:/i.test(address)) return OUTSIDE_PROJECT;
  const named = PATH_STARTS.some((start) => address.startsWith(start)) || DRIVE.test(address);
  if (named || (pathField && !address.includes(":"))) return staysInside(folder, address) ? LOCAL : OUTSIDE_PROJECT;
  return classifySource("PyPI", git ? gitRepositorySource(address, "").source : address, { direct });
}

// Where a Poetry package comes from, by its [package.source] `type`: an index (`legacy`), a git repository at
// `resolved_reference`, one archive (`url`), or a file or folder. Any other type, or no `url`, is one it cannot read.
function poetryOrigin(block, folder) {
  if (block.source === null) return NO_SOURCE;
  const type = block.source.get("type");
  const url = block.source.get("url");
  if (url === undefined) return UNREADABLE_ENTRY;
  if (type === "legacy") return { classified: pythonAddress(url, folder) };
  if (type === "url") return { classified: pythonAddress(url, folder, { direct: true }) };
  if (type === "file" || type === "directory") return { classified: pythonAddress(url, folder, { pathField: true }) };
  if (type !== "git") return UNREADABLE_ENTRY;
  const verdict = pythonAddress(url, folder, { git: true });
  const commit = block.source.get("resolved_reference") ?? "";
  return { classified: verdict.kind === "git" && OBJECT_ID.test(commit) ? { ...verdict, commit } : verdict };
}

// The fields of an inline table written as uv writes one, by name; null when it is not one or a name is given twice.
function uvTable(value) {
  if (value === undefined || value.kind !== "table" || !value.exact) return null;
  const fields = new Map();
  for (const entry of value.entries) {
    if (fields.has(entry.key)) return null;
    fields.set(entry.key, entry.value);
  }
  return fields;
}

// A uv `source`: exactly one kind, a string: an index (a folder when it is a path), a git repository with its commit after `#`, one
// archive, a file or folder, or the project itself (`editable` or `virtual` inside the repository).
function uvSourceVerdict(value, folder) {
  const fields = uvTable(value);
  const kinds = fields ? UV_SOURCE_KINDS.filter((kind) => fields.has(kind)) : [];
  if (kinds.length !== 1) return UNREADABLE;
  const [kind] = kinds;
  const extra = kind === "url" && fields.has("subdirectory") ? 1 : 0;
  const address = fields.get(kind);
  if (fields.size !== 1 + extra || address.kind !== "string") return UNREADABLE;
  if (kind === "git") return pythonAddress(address.text, folder, { git: true });
  if (kind === "url") return pythonAddress(address.text, folder, { direct: true });
  const verdict = pythonAddress(address.text, folder, { pathField: true });
  return (kind === "editable" || kind === "virtual") && verdict === LOCAL ? PROJECT : verdict;
}

// A uv `sdist` or `wheels` item: the address of its `url` or its `path`, null when it names neither.
function uvFileVerdict(value, folder) {
  const fields = uvTable(value);
  if (!fields || [...fields.keys()].some((name) => !UV_FILE_FIELDS.has(name)) || (fields.has("url") && fields.has("path"))) {
    return UNREADABLE;
  }
  const address = fields.get("url") ?? fields.get("path");
  if (address === undefined) return null;
  if (address.kind !== "string") return UNREADABLE;
  return pythonAddress(address.text, folder, { pathField: fields.has("path") });
}

// Where a uv package comes from: the first address that is neither the registry nor a path inside the project among its source,
// its sdist and its wheels, else what its source is. A package with no source, or a project with files, is one it cannot read.
function uvOrigin(block, folder) {
  const source = block.fields.get("source");
  if (source === undefined) return UNREADABLE_ENTRY;
  const verdicts = [uvSourceVerdict(source.value, folder)];
  const sdist = block.fields.get("sdist");
  if (sdist !== undefined) verdicts.push(uvFileVerdict(sdist.value, folder));
  const wheels = block.fields.get("wheels");
  if (wheels !== undefined) {
    const laidOut = wheels.value.kind === "array" && wheels.value.exact;
    if (laidOut) verdicts.push(...wheels.value.items.map((item) => uvFileVerdict(item, folder)));
    else verdicts.push(UNREADABLE);
  }
  const named = verdicts.filter((verdict) => verdict !== null);
  if (named[0] === PROJECT) return named.length === 1 ? PROJECT : UNREADABLE_ENTRY;
  const reported = named.find((verdict) => !verdict.expected && verdict.kind !== "local");
  return { classified: reported ?? named[0] };
}

// Poetry writes a package's source as a [package.source] table; uv as `source`, `sdist` and `wheels` fields of the block. Each
// writes its own other sub-tables of a [[package]] block, none of which names where the package comes from.
const POETRY = {
  tool: "Poetry",
  sourceTable: true,
  writesEmptyList: true,
  otherTables: new Set(["dependencies", "extras"]),
  foreignFields: ["source", "sdist", "wheels"],
  origin: poetryOrigin,
};
const UV = {
  tool: "uv",
  sourceTable: false,
  writesEmptyList: false,
  otherTables: new Set(["optional-dependencies", "dev-dependencies", "metadata", "group-requires-python"]),
  foreignFields: [],
  origin: uvOrigin,
};

// A block field's text: undefined when it is not given, null when it is not a basic string with no escape.
function fieldText(block, name) {
  const field = block.fields.get(name);
  if (field === undefined) return undefined;
  return field.value.kind === "string" && field.value.plain ? field.value.text : null;
}

// What a finished block stands for: the project itself (skipped, `{ project: true }`), or an entry. A block in a shape the tool
// does not write, or with neither a version nor a source of its own, is one it cannot read; one with no name it can read is one
// it cannot name.
function blockEntry(block, format, folder) {
  const name = fieldText(block, "name");
  const version = fieldText(block, "version");
  const origin = format.origin(block, folder);
  const odd = format.foreignFields.some((field) => block.fields.has(field));
  const unversioned = version === undefined && origin === NO_SOURCE;
  const unreadable = block.unreadable || odd || name === null || version === null || unversioned;
  if (origin === PROJECT && !unreadable) return PROJECT;
  if (typeof name !== "string") return unnamedEntry(block.line);
  return { name, version: version ?? null, line: block.fields.get("name").line, ...(unreadable ? UNREADABLE_ENTRY : origin) };
}

// A field of a block's own table, written as the tool writes one and given once, or the block is one it cannot read.
function readBlockField(block, { key, exact, value, line }) {
  if (!exact || block.fields.has(key)) block.unreadable = true;
  else block.fields.set(key, { value, line });
}

// A field of Poetry's [package.source]: one Poetry writes, written as it writes it, a basic string with no escape, given once.
function readSourceField(block, { key, exact, value }) {
  const known = exact && POETRY_SOURCE_FIELDS.has(key) && !block.source.has(key);
  if (known && value.kind === "string" && value.plain) block.source.set(key, value.text);
  else block.unreadable = true;
}

// `package = []` written as Poetry writes it for a project with no dependencies.
const isEmptyPackageList = ({ key, exact, value }) =>
  key === "package" && exact && value.kind === "array" && value.items.length === 0 && value.exact;

// poetry.lock and uv.lock, read statement by statement. Each [[package]] block runs through its sub-tables until the next
// [[package]] or another top-level table. Before the first table, a key is a bare name other than `package`, except Poetry's
// `package = []`, after which no package table may follow; a package sub-table with no block before it, among other tables, means
// the file is not one it can read, and a file with neither blocks nor that empty list is one with no packages found in it. In a
// block, every field of its own table and of Poetry's [package.source] must be written as the tool writes it, or the block is one
// it cannot read; a sub-table it does not know is one too.
function readPackageBlocks(text, format, folder) {
  const layout = `not laid out as ${format.tool} writes it`;
  const out = [];
  let block = null;
  let blocks = 0;
  let emptyList = false;
  let table = "root";
  const finish = () => {
    if (!block) return;
    const entry = blockEntry(block, format, folder);
    block = null;
    if (entry !== PROJECT) out.push(entry);
  };
  for (const statement of tomlStatements(text, layout)) {
    if (statement.header) {
      const [top, sub, ...deeper] = statement.header;
      if (top !== "package") {
        finish();
        table = "other";
      } else if (emptyList) throw new Unreadable(layout);
      else if (statement.array && sub === undefined) {
        finish();
        blocks++;
        block = { line: statement.line, fields: new Map(), source: null, unreadable: false };
        table = "block";
      } else if (!block) throw new Unreadable(layout);
      else if (format.otherTables.has(sub)) table = "other";
      else if (format.sourceTable && sub === "source" && !statement.array && deeper.length === 0 && block.source === null) {
        block.source = new Map();
        table = "source";
      } else {
        block.unreadable = true;
        table = "other";
      }
    } else if (table === "root") {
      if (format.writesEmptyList && !emptyList && isEmptyPackageList(statement)) emptyList = true;
      else if (statement.key === null || statement.key === "package") throw new Unreadable(layout);
    } else if (table === "block") readBlockField(block, statement);
    else if (table === "source") readSourceField(block, statement);
  }
  finish();
  if (blocks === 0 && !emptyList) throw new Unreadable("no packages found in it");
  return out;
}

// text: the lockfile; folder: its folder in the repository, which a relative path in it is read from.
const readPoetryLock = (text, folder = "") => readPackageBlocks(text, POETRY, folder);
const readUvLock = (text, folder = "") => readPackageBlocks(text, UV, folder);

// A requirements file, read as pip reads one. pip ends a line at each of these as well as at \n and \r\n (Python's splitlines), so
// a line holding one is read differently by pip than line by line.
const PIP_LINE_BREAK = /[\r\v\f\x1c-\x1e\x85\u2028\u2029]/;
// Whitespace other than a space: pip splits a line into words at spaces only.
const OTHER_WHITESPACE = /[^\S ]/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const REQUIREMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*/;
const EGG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EXTRAS = /^\[[A-Za-z0-9._,\s-]*\]$/;
const VERSION_CLAUSE = /^(===|==|!=|<=|>=|~=|<|>)\s*([A-Za-z0-9._*+!-]+)$/;
const TRUSTED_HOST = /^([A-Za-z0-9.-]+)(?::\d+)?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const ARCHIVE = /\.(?:whl|zip|tar|tgz|tar\.gz|tar\.bz2|tbz|tar\.xz|txz)$/i;
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

// The text without the backslashes at either end, as pip strips a line it joins to the next.
function withoutEndBackslashes(text) {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "\\") start++;
  while (end > start && text[end - 1] === "\\") end--;
  return text.slice(start, end);
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
  linesOf(text.startsWith("\uFEFF") ? text.slice(1) : text).forEach((physical, i) => {
    if (PIP_LINE_BREAK.test(physical)) {
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

// The options of a line, as pip's option parser reads them: `--name=value`, `--name value`, `-xvalue` or `-x value`. null when a
// word is not an option pip reads in a requirements file, an option lacks its value or a flag has one, or a word is quoted or
// escaped, which pip reads in a way this reader does not.
function parseOptions(words) {
  const options = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (/["'\\]/.test(word) || !word.startsWith("-")) return null;
    const long = word.startsWith("--");
    const sep = long ? word.indexOf("=") : -1;
    const name = long ? (sep < 0 ? word : word.slice(0, sep)) : SHORT_OPTIONS.get(word.slice(0, 2));
    let value = long ? (sep < 0 ? undefined : word.slice(sep + 1)) : word.length > 2 ? word.slice(2) : undefined;
    const kind = LONG_OPTIONS.get(name);
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

// A path without the `[extras]` pip allows after it.
const withoutExtras = (path) => (path.endsWith("]") && path.includes("[") ? path.slice(0, path.lastIndexOf("[")) : path);

// One address a requirement installs from: a version control address, a URL (one archive), or a path. A path inside the project
// gives nothing; so does the official registry when the requirement names no package.
function addressEntries(address, name, line, folder) {
  if (address === "" || /\s/.test(address) || address.includes("${")) return [unreadableRequirement(name, line)];
  const verdict =
    vcsVerdict(address, folder) ??
    (SCHEME.test(address)
      ? pythonAddress(address, folder, { direct: true })
      : pythonAddress(withoutExtras(address), folder, { pathField: true }));
  const named = name ?? eggName(address);
  if (verdict.unreadable) return [unreadableRequirement(named, line)];
  if (verdict.kind === "local" || (verdict.expected && named === null)) return [];
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

const looksLikePath = (text) => /^[.~]/.test(text) || text.includes("/") || text.includes("\\") || ARCHIVE.test(text);

// A requirement line's words before its options: a version control address or URL (its marker after "; "), `name @ address`, a
// path, or a name with a version specifier (its marker after ";"). An environment variable in it is one it cannot read.
function requirementEntries(text, line, folder) {
  if (text.includes("${")) return [unreadableRequirement(null, line)];
  if (VCS_PREFIXES.some((prefix) => text.toLowerCase().startsWith(prefix)) || SCHEME.test(text)) {
    return addressEntries(text.split("; ", 1)[0].trim(), null, line, folder);
  }
  const requirement = text.split(";", 1)[0].trim();
  const parts = splitName(requirement);
  if (parts && parts.rest.startsWith("@")) return addressEntries(parts.rest.slice(1).trim(), parts.name, line, folder);
  if (looksLikePath(requirement)) return addressEntries(requirement, null, line, folder);
  return parts ? specifierEntries(parts, line) : [unreadableRequirement(null, line)];
}

// An index (`-i`, `--extra-index-url`) or a place to find archives (`-f`, which may be a folder): reported unless it is the
// official registry or a folder inside the project. One set from an environment variable is reported as such.
function indexEntries(value, line, folder, pathField) {
  if (value.includes("${")) return [lineEntry(line, ENV_INDEX)];
  const verdict = pythonAddress(value, folder, { pathField });
  if (verdict.unreadable) return [unreadableRequirement(null, line)];
  return verdict.expected || verdict.kind === "local" ? [] : [lineEntry(line, verdict)];
}

// A `--trusted-host` value: a host name with a letter in it, or an IPv4 address of four parts, with an optional port; any other is
// one it cannot read, so a number is never shown as the address a URL parser makes of it.
function trustedHostEntries(value, line) {
  const host = TRUSTED_HOST.exec(value)?.[1];
  const known = host !== undefined && (/[A-Za-z]/.test(host) || IPV4.test(host));
  const verdict = known ? classifySource("PyPI", `http://${value}`) : UNREADABLE;
  return verdict.unreadable ? [unreadableRequirement(null, line)] : [lineEntry(line, verdict)];
}

// What an option on a line of options gives. A `-r` or `-c` file inside the repository is a file to read in turn (`requires`, its
// path in the repository); one outside it is reported; one at a URL is one it cannot read.
function optionEntries({ kind, value }, line, folder) {
  if (kind === INDEX) return indexEntries(value, line, folder, false);
  if (kind === FIND_LINKS) return indexEntries(value, line, folder, true);
  if (kind === TRUSTED) return trustedHostEntries(value, line);
  if (kind !== OTHER_FILE) return [];
  const verdict = pythonAddress(value, folder, { pathField: true });
  if (verdict.kind === "local") return [{ line, requires: pathFrom(folder, value) }];
  return verdict === OUTSIDE_PROJECT ? [lineEntry(line, verdict)] : [unreadableRequirement(null, line)];
}

// One line of a requirements file, without its comment. Its words up to the first that starts with `-` are a requirement, which
// may be followed only by the options pip applies to one requirement; a line of options alone gives what each option names, and
// one with `-e` installs that one address. pip expands environment variables before it reads options, so one in any option value
// but an index's is one it cannot read. null for a requirement with no pinned version.
function requirementsLineEntries(text, line, folder) {
  if (OTHER_WHITESPACE.test(text)) return [unreadableRequirement(null, line)];
  const words = text.split(" ");
  const first = words.findIndex((word) => word.startsWith("-"));
  const requirement = (first < 0 ? words : words.slice(0, first)).join(" ").trim();
  const options = parseOptions(first < 0 ? [] : words.slice(first).filter((word) => word !== ""));
  const expanded = (option) => option.kind !== INDEX && option.kind !== FIND_LINKS && option.value?.includes("${");
  if (options === null || options.some(expanded)) return [unreadableRequirement(null, line)];
  if (requirement !== "") {
    const others = options.some((option) => option.kind !== REQUIREMENT_OPTION);
    return others ? [unreadableRequirement(null, line)] : requirementEntries(requirement, line, folder);
  }
  const editables = options.filter((option) => option.kind === EDITABLE);
  if (editables.length === 0) return options.flatMap((option) => optionEntries(option, line, folder));
  const alone = editables.length === 1 && options.every((option) => option.kind === EDITABLE || option.kind === REQUIREMENT_OPTION);
  return alone ? addressEntries(editables[0].value, null, line, folder) : [unreadableRequirement(null, line)];
}

// text: a requirements file; folder: its folder in the repository, which a relative path in it is read from. Pinned requirements,
// sources (version control, URLs, paths outside the project), index options and the -r and -c files it names, line by line. A file whose only requirements are
// unpinned has no pinned versions in it.
function readRequirements(text, folder = "") {
  const out = [];
  let unpinned = 0;
  for (const logical of logicalLines(text)) {
    const content = logical.text === null ? null : withoutComment(logical.text).trim();
    if (content === "") continue;
    const entries = content === null ? [unreadableRequirement(null, logical.line)] : requirementsLineEntries(content, logical.line, folder);
    if (entries === null) unpinned++;
    else out.push(...entries);
  }
  return found(out, unpinned, "no pinned versions in it");
}

module.exports = { readPoetryLock, readUvLock, readRequirements };

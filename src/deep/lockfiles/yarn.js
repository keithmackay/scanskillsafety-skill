// ABOUTME: Reads the packages in a yarn.lock, classic or Berry, each with its line and where it comes from; a file or entry not
// ABOUTME: laid out as Yarn writes it is one it cannot read, never one taken for the registry.
"use strict";

const {
  addressSource,
  fieldOf,
  leadingSpaces,
  linesOf,
  LONE_CR_OR_TAB,
  opensUnclosed,
  PLAIN_NAME,
  startsWithAny,
  unnamedEntry,
  unquote,
  Unreadable,
  UNREADABLE_ENTRY,
} = require("./shared");

// A Yarn spec's package name: the text before the first `@` past the start, or the real name an `npm:` alias points at.
function yarnSpecName(spec) {
  const at = spec.indexOf("@", 1);
  if (at < 0) return spec;
  const range = spec.slice(at + 1);
  if (range.startsWith("npm:")) {
    const aliasAt = range.indexOf("@", 5);
    if (aliasAt > 0) return range.slice(4, aliasAt);
  }
  return spec.slice(0, at);
}

// The resolution in a Berry `name@<resolution>`: the text after the first `@` past the start, so a scoped name stays whole; null
// when there is none.
function afterName(text) {
  const at = text.indexOf("@", 1);
  return at < 0 ? null : text.slice(at + 1);
}

// The resolution a Berry `patch:` patches, URL-decoded, without the patch after `#` or the package name before `@`; null when it
// cannot be decoded or names no package.
function berryPatched(resolution) {
  let decoded;
  try {
    decoded = decodeURIComponent(resolution.slice("patch:".length).split("#", 1)[0]);
  } catch {
    return null;
  }
  return afterName(decoded);
}

// A Berry resolution that is not a patch: `npm:` records no host; an http(s) address with `#commit=` is a git repository; any
// other http(s) address pins one archive; the rest (git URLs, local protocols, a patch inside a patch) is left to the classifier.
function berryResolutionSource(resolution) {
  if (resolution.startsWith("npm:")) return { recordsHost: false };
  if (!resolution.startsWith("https:") && !resolution.startsWith("http:")) return { source: resolution };
  const hash = resolution.indexOf("#");
  if (hash >= 0 && resolution.startsWith("commit=", hash + 1)) return { source: `git+${resolution}` };
  return { source: resolution, direct: true };
}

// The source of a Berry `resolution:` value (`name@<resolution>`); a patch is classified by the resolution it patches.
function berrySource(value) {
  const resolution = afterName(value);
  if (resolution === null) return UNREADABLE_ENTRY;
  if (!resolution.startsWith("patch:")) return berryResolutionSource(resolution);
  const patched = berryPatched(resolution);
  return patched === null ? UNREADABLE_ENTRY : berryResolutionSource(patched);
}

// An entry with no source line: with a version, from whatever registry the install used; with neither, one it cannot read.
const noOrigin = (entry) => (entry.version === undefined ? UNREADABLE_ENTRY : {});

const YARN_LAYOUT = "not laid out as Yarn writes it";
// The first character of a YAML tag, anchor or alias.
const YAML_NODE_PROPERTY = "!&*";
// How an unquoted Berry header never starts: like a YAML indicator, a merge key or a quoted string.
const BERRY_HEADER_ODD_START = "?{}[]&*!|>%@#`'\",-<";
// How a Berry `version` or `resolution` value never starts: like a YAML indicator or a single-quoted string.
const BERRY_VALUE_ODD_START = "|>{[&*!%@#`'";
const DOUBLE_QUOTED = /^"[^"\\]*"$/;

// A header as Berry writes one: `name:`, unquoted with nothing YAML would read differently, or a double-quoted `"…":` with no
// escape in it.
function berryHeaderReadable(line) {
  if (!line.endsWith(":")) return false;
  const key = line.slice(0, -1);
  if (key.startsWith('"')) return DOUBLE_QUOTED.test(key);
  return key !== "" && !startsWithAny(key, BERRY_HEADER_ODD_START) && !/["'\\]|: | #/.test(key);
}

// A `version` or `resolution` value as Berry writes one: a plain scalar, or a double-quoted string with no escape, on one line.
function berryScalar(value) {
  if (value.startsWith('"')) return DOUBLE_QUOTED.test(value);
  return value !== "" && !startsWithAny(value, BERRY_VALUE_ODD_START);
}

// The fields a Berry entry's version and source are read from; a line deeper than either is one YAML would join to it.
const BERRY_SCALAR_FIELDS = ["version", "resolution"];

// A line of a Berry entry, read only as Berry writes one; any other shape makes the entry's source one it cannot read. Its fields
// are at 2 spaces, each a plain name written right against its colon, with no escape, tag, anchor or alias in the line, and not
// left open at the end of it. `version` and `resolution` are each given once, hold a scalar, and are read from that one field;
// a resolution of `workspace:` marks the project's own workspace. Deeper lines under any other field are passed over, since Yarn
// takes the source only from `resolution`; a deeper line before any field or under `version` or `resolution`, or a line at 1
// space, is not.
function readBerryLine(entry, line) {
  if (line.trim() === "") return;
  const indent = leadingSpaces(line);
  if (indent > 2) {
    if (entry.field === null || BERRY_SCALAR_FIELDS.includes(entry.field)) entry.unreadable = true;
    return;
  }
  const text = line.slice(indent);
  const field = indent === 2 ? fieldOf(text) : null;
  const shaped = field && PLAIN_NAME.test(field.key) && text.startsWith(`${field.key}:`);
  if (!shaped || text.includes("\\") || startsWithAny(field.value, YAML_NODE_PROPERTY)) {
    entry.unreadable = true;
    return;
  }
  entry.field = field.key;
  if (BERRY_SCALAR_FIELDS.includes(field.key)) readBerryScalar(entry, field);
  else if (opensUnclosed(field.value)) entry.unreadable = true;
}

const WORKSPACE = "workspace:";

// A workspace resolution's folder as Berry writes one: relative to the project (`.`, `./…`, `../…`, `packages/a`), with no `:`
// or `//` that could make it an address, and not absolute.
const isWorkspaceFolder = (folder) => folder !== "" && !folder.startsWith("/") && !folder.includes(":") && !folder.includes("//");

// The `version` or `resolution` field of a Berry entry, each given once and holding a scalar, or the entry's source is one it
// cannot read. A resolution of `workspace:` and a relative folder is the project's own workspace, skipped; one naming anything
// else is one it cannot read.
function readBerryScalar(entry, { key, value }) {
  const given = key === "version" ? entry.version !== undefined : entry.origin !== undefined;
  if (given || !berryScalar(value)) {
    entry.unreadable = true;
    return;
  }
  if (key === "version") {
    entry.version = unquote(value);
    return;
  }
  const resolution = unquote(value);
  const named = afterName(resolution) ?? "";
  entry.origin = berrySource(resolution);
  if (!named.startsWith(WORKSPACE)) return;
  if (isWorkspaceFolder(named.slice(WORKSPACE.length))) entry.workspace = true;
  else entry.unreadable = true;
}

// A classic field: a plain name, one space and a double-quoted value with no escape or an unquoted one; or a plain name and a
// colon opening the deeper lines below it.
const CLASSIC_FIELD = /^ {2}([A-Za-z]+) ("[^"\\]*"|[^\s"]+)$/;
const CLASSIC_BLOCK = /^ {2}[A-Za-z]+:$/;

// A line of a classic entry, read only as Yarn writes one; any other shape, a backslash (Yarn decodes quoted strings as JSON) or a
// tab anywhere in it, makes the entry's source one it cannot read. Deeper lines are passed over under a field that opens them.
// `version` is given once, and a later `resolved` replaces an earlier one.
function readClassicLine(entry, line) {
  if (line.trim() === "") return;
  if (line.includes("\\") || line.includes("\t")) {
    entry.unreadable = true;
    return;
  }
  const indent = leadingSpaces(line);
  if (indent > 2) {
    if (!entry.inBlock || indent < 4) entry.unreadable = true;
    return;
  }
  entry.inBlock = CLASSIC_BLOCK.test(line);
  if (entry.inBlock) return;
  const match = CLASSIC_FIELD.exec(line);
  if (!match) entry.unreadable = true;
  else if (match[1] === "version") {
    if (entry.version !== undefined) entry.unreadable = true;
    else entry.version = unquote(match[2]);
  }
  else if (match[1] === "resolved") entry.origin = addressSource(unquote(match[2]));
}

// Each entry runs from its header to the next header or the end of the file, so its source, on a line after its version, is
// carried with it. A header that does not end in `:` is an entry it cannot name; an entry is never left out for lacking a version.
// A file with a `__metadata:` line is Berry, read by Berry's rules whatever else it holds; any other file must carry the classic
// marker. Yarn itself reads a file with its classic parser when the opening comments carry `# yarn lockfile v1`; such a file with
// a `__metadata:` line is read here by the stricter Berry rules, under which a classic-shaped line makes its entry unreadable,
// so a source Yarn reads is never taken for the registry. Berry is YAML, read only as Berry writes it: a lone carriage return or
// a tab makes the file one it cannot read, a header in any other shape is an entry it cannot name, and only an entry whose
// resolution is a `workspace:` folder is skipped. A classic entry is never skipped.
function readYarnLock(text) {
  const lines = linesOf(text);
  const berry = lines.includes("__metadata:");
  if (!berry && !text.includes("# yarn lockfile v1")) throw new Unreadable("not a Yarn lockfile it can read");
  if (berry && LONE_CR_OR_TAB.test(text)) throw new Unreadable(YARN_LAYOUT);
  const readLine = berry ? readBerryLine : readClassicLine;
  const out = [];
  let entry = null;
  const finish = () => {
    if (entry && !(entry.workspace && !entry.unreadable)) {
      const origin = entry.unreadable ? UNREADABLE_ENTRY : entry.origin ?? noOrigin(entry);
      out.push({ name: entry.name, line: entry.line, version: entry.version ?? null, ...origin });
    }
    entry = null;
  };
  lines.forEach((line, i) => {
    if (!/^[^\s#]/.test(line)) {
      if (entry) readLine(entry, line);
      return;
    }
    finish();
    if (berry && line === "__metadata:") return;
    const named = line.endsWith(":") && (!berry || berryHeaderReadable(line));
    const spec = unquote(line.replace(/:$/, "").split(/,\s*/)[0]);
    if (!named) out.push(unnamedEntry(i + 1));
    else entry = { name: yarnSpecName(spec), line: i + 1, field: null, inBlock: false, workspace: false, unreadable: false };
  });
  finish();
  return out;
}

module.exports = { readYarnLock };

// ABOUTME: Reads the config files that name where installs in a folder fetch packages from (.npmrc, .yarnrc, .yarnrc.yml, uv.toml)
// ABOUTME: and pnpm-workspace.yaml's folders; auth lines are never read, and a setting in a form it does not model is unreadable.
"use strict";

const { classifySource, EXPECTED, UNREADABLE } = require("../packageSources");
const { configEntry, fieldOf, leadingSpaces, linesOf, startsWithAny, unnamedEntry, workspaceEntries } = require("./shared");
const { tomlValues, uvConfigEntries } = require("./pyproject");

const withoutBom = (text) => (text.startsWith("\uFEFF") ? text.slice(1) : text);

// What a registry setting names: the official registry, a mirror (host) or plain http; anything else (a path, a git address, text
// that is no address) is one it cannot read.
function registryVerdict(address) {
  const verdict = address === null ? UNREADABLE : classifySource("npm", address);
  return verdict.expected || verdict.kind === "host" || verdict.kind === "http" ? verdict : UNREADABLE;
}

// A scoped registry key's scope (`@myco:registry` → `@myco`).
const scopeOfKey = (key) => key.slice(0, key.indexOf(":"));

// .npmrc and .yarnrc

// Lines as npm's ini reader and Yarn's rc reader split them: a carriage return alone ends a line too.
const rcLines = (text) => withoutBom(text).split(/\r\n|\n|\r/);

// An auth setting (`//host/:_authToken=…`, `_auth=…`, `_password=…`): recognised by its key and never read further, so its value
// reaches nothing.
function isAuthLine(trimmed, key) {
  const lower = key.toLowerCase();
  return trimmed.startsWith("//") || trimmed.startsWith('"//') || lower.includes("_auth") || lower.includes("_password");
}

// A key as npm or Yarn might come to read it, for telling whether it is a registry setting: up to an ini comment, without quotes,
// spaces, backslashes, an array's `[]`, a Yarn flag's `--` and command, in lower case with `_` read as `-`.
function looseKey(key) {
  const bare = key.split(/[;#]/, 1)[0].replace(/["'\s\\]/g, "").replace(/\[\]$/, "").replace(/^--(?:[a-z-]+\.)?/i, "");
  return bare.toLowerCase().replace(/_/g, "-");
}

const NPM_SETTINGS = ["registry", "replace-registry-host", "omit-lockfile-registry-resolved"];
// A key that may name a registry setting, however written; one holding a variable may become any key.
const mayNameSetting = (loose, settings) => loose.includes("${") || settings.includes(loose) || loose.endsWith(":registry");

// A scoped registry key as npm and Yarn write one.
const SCOPED_REGISTRY = /^@[A-Za-z0-9._~-]+:registry$/;

// A value as npm's ini reader gives it, in the forms modelled here: unquoted with no comment, escape or quote, or quoted with no
// quote or escape inside; null for any other form, or one holding a variable, which npm expands.
function iniValue(raw) {
  const value = raw.trim();
  if (value.includes("${") || value.includes("\\")) return null;
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return /["';#]/.test(value) ? null : value;
  if (value.length < 2 || !value.endsWith(quote)) return null;
  const inner = value.slice(1, -1);
  return /["']/.test(inner) ? null : inner;
}

// The values of replace-registry-host that redirect nothing.
const NO_REPLACEMENT = new Set(["npmjs", "never", "always"]);
const HOST_NAME = /^[A-Za-z0-9.-]+(?::\d+)?$/;
const OMITS_RESOLVED = Object.freeze({ expected: false, kind: "host", address: null, text: "hides the registry from package-lock.json" });

// replace-registry-host: a host name whose addresses npm fetches from the configured registry instead.
function replacedHostVerdict(value) {
  if (value !== null && NO_REPLACEMENT.has(value)) return EXPECTED;
  if (value === null || !HOST_NAME.test(value) || !/[A-Za-z]/.test(value)) return UNREADABLE;
  return registryVerdict(`https://${value}`);
}

// omit-lockfile-registry-resolved: true is reported, since it hides the registry from package-lock.json.
const omitResolvedVerdict = (value) => (value === "true" ? OMITS_RESOLVED : value === "false" ? EXPECTED : UNREADABLE);

// What one .npmrc registry setting gives, by its key as written and its value (null when not in a form modelled).
function npmSettingEntry(key, value, line) {
  if (key === "registry") return configEntry(line, registryVerdict(value), { registry: true });
  if (SCOPED_REGISTRY.test(key)) return configEntry(line, registryVerdict(value), { registry: true, scope: scopeOfKey(key) });
  if (key === "replace-registry-host") return configEntry(line, replacedHostVerdict(value));
  if (key === "omit-lockfile-registry-resolved") return configEntry(line, omitResolvedVerdict(value));
  return configEntry(line, UNREADABLE);
}

// .npmrc, read as npm's ini reader reads it: `key=value` lines, `;` and `#` comment lines, `[section]` headers. Only the registry
// settings are read; one written in any form not modelled here (another spelling of the key, a value with a comment, escape or
// variable, an array, no value, inside a section) is one it cannot read.
function readNpmrc(text) {
  const out = [];
  let inSection = false;
  rcLines(text).forEach((raw, i) => {
    const trimmed = raw.trim();
    const eq = raw.indexOf("=");
    const rawKey = eq < 0 ? raw : raw.slice(0, eq);
    if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#") || isAuthLine(trimmed, rawKey)) return;
    if (/^\[[^\]]*\]\s*$/.test(raw)) {
      inSection = true;
      return;
    }
    if (!mayNameSetting(looseKey(rawKey), NPM_SETTINGS)) return;
    const value = eq < 0 || inSection ? null : iniValue(raw.slice(eq + 1));
    out.push(npmSettingEntry(inSection ? null : rawKey.trim(), value, i + 1));
  });
  return out;
}

// A .yarnrc registry line as Yarn 1 writes one: the key bare or double-quoted, spaces, and the address double-quoted with no
// escape, an optional comment after.
const YARNRC_REGISTRY = /^(registry|"registry"|"@[A-Za-z0-9._~-]+:registry") +"([^"\\]*)"(?:\s+#.*)?$/;

// The first word of a .yarnrc line: a double-quoted key, or the text up to a space, without a colon ending it.
function yarnrcKey(line) {
  if (line.startsWith('"')) {
    const close = line.indexOf('"', 1);
    return close < 0 ? line : line.slice(0, close + 1);
  }
  return line.split(/\s/, 1)[0].replace(/:$/, "");
}

// What one .yarnrc registry line gives; any other form is one it cannot read.
function yarnrcEntry(text, line) {
  const match = YARNRC_REGISTRY.exec(text);
  if (match === null) return configEntry(line, UNREADABLE);
  const key = match[1].replace(/"/g, "");
  const address = match[2].includes("${") ? null : match[2];
  const scope = key === "registry" ? {} : { scope: scopeOfKey(key) };
  return configEntry(line, registryVerdict(address), { registry: true, ...scope });
}

// .yarnrc (Yarn 1), read line by line: only the registry and a scope's registry, each `key "address"` on its own line; another
// spelling of such a key, an unquoted address, or lines indented under one is one it cannot read. Other settings and the lines
// indented under them are passed over.
function readYarnrc(text) {
  const out = [];
  let root = null;
  rcLines(text).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#") || isAuthLine(trimmed, yarnrcKey(trimmed))) return;
    if (/^\s/.test(raw)) {
      if (root !== null && !root.unreadable) {
        out.push(configEntry(line, UNREADABLE));
        root.unreadable = true;
      }
      return;
    }
    root = null;
    if (!mayNameSetting(looseKey(yarnrcKey(trimmed)), ["registry"])) return;
    const entry = yarnrcEntry(raw.trimEnd(), line);
    out.push(entry);
    root = { unreadable: entry.classified.unreadable === true };
  });
  return out;
}

// YAML (.yarnrc.yml and pnpm-workspace.yaml), read line by line, strictly where a source can be named.

// A setting a part of the file does not model: the line it is on.
class Unmodelled {
  constructor(line) {
    this.line = line;
  }
}

// An auth setting in .yarnrc.yml, recognised by its key and never read further.
const YAML_AUTH_LINE = /^\s*(?:- )?["']?npmAuth(?:Token|Ident)["']?\s*:/;
// How a plain YAML key or value never starts: like an indicator, an anchor, an alias, a tag, a directive or a merge key.
const YAML_ODD_START = "?&*!|>%@`{[]},:-<#";
const DOCUMENT_START = "---";

// A key or a value in quotes, as YAML writes one with no escape: its text, what follows its closing quote, or null.
function quoted(text) {
  const quote = text[0];
  const close = text.indexOf(quote, 1);
  if (close < 0) return null;
  const inner = text.slice(1, close);
  const rest = text.slice(close + 1);
  if ((quote === '"' && inner.includes("\\")) || (quote === "'" && rest.startsWith("'"))) return null;
  return { text: inner, rest };
}

// The content of a YAML line, after its indentation: `{ key, value }` for a mapping entry, `{ item, value }` for a sequence item,
// `{ text }` for a line that is neither, `{ bad }` for a key quoted with an escape or starting like an indicator.
function yamlContent(text) {
  if (text === "-" || text.startsWith("- ")) return { item: true, value: text.slice(1).trim() };
  if (text[0] === '"' || text[0] === "'") {
    const key = quoted(text);
    if (key === null) return { bad: true };
    const rest = key.rest.trimStart();
    if (rest !== ":" && !rest.startsWith(": ")) return { bad: true };
    return { key: key.text, value: rest.slice(1).trim() };
  }
  if (startsWithAny(text, YAML_ODD_START)) return { bad: true };
  const field = fieldOf(text);
  if (field === null) return { text };
  return field.key.includes(" #") ? { bad: true } : { key: field.key, value: field.value };
}

// A YAML value as written on its line: nothing (or a comment), an empty collection, or a scalar's text; null for any other form
// (a flow collection, a block scalar, an anchor, alias or tag, a quoted string with an escape or not closed, a variable).
function yamlValue(value) {
  if (value === "" || value.startsWith("#")) return { empty: true };
  if (value === "{}" || value === "[]") return { emptyCollection: true };
  let text;
  if (value[0] === '"' || value[0] === "'") {
    const scalar = quoted(value);
    if (scalar === null || (scalar.rest !== "" && !/^ +#/.test(scalar.rest))) return null;
    text = scalar.text;
  } else {
    if (startsWithAny(value, YAML_ODD_START)) return null;
    text = value.split(" #", 1)[0].trimEnd();
    if (text.includes(": ")) return null;
  }
  return text.includes("${") ? null : { text };
}

// The lines below a root key as a tree by indentation, each node `{ line, key | item | text | bad, value, children }`. A sequence
// may sit at its key's own indentation. A line whose indentation fits no open level is one it does not model.
function yamlTree(root, lines) {
  const stack = [{ node: root, indent: 0, childIndent: null }];
  const accepts = (frame, node, indent) => {
    if (frame.childIndent !== null) return indent === frame.childIndent && (frame.childIndent > frame.indent || node.item === true);
    return indent > frame.indent || (node.item === true && frame.node.key !== undefined && indent === frame.indent);
  };
  for (const { text, line, indent } of lines) {
    const node = { line, ...yamlContent(text), children: [] };
    let frame = stack[stack.length - 1];
    while (!accepts(frame, node, indent)) {
      if (stack.length === 1 || indent > frame.indent) throw new Unmodelled(line);
      stack.pop();
      frame = stack[stack.length - 1];
    }
    frame.childIndent = indent;
    frame.node.children.push(node);
    stack.push({ node, indent, childIndent: null });
  }
  return root;
}

// A node's own value as a scalar's text, with nothing below it; any other form is one it does not model, at the line where it
// shows.
function scalarText(node) {
  const value = yamlValue(node.value);
  if (value === null || value.text === undefined) throw new Unmodelled(node.line);
  if (node.children.length > 0) throw new Unmodelled(node.children[0].line);
  return value.text;
}

// The entries under a node holding a mapping or a sequence (`want`: "key" or "item"), as nothing, an empty collection, or lines
// below; each entry of the other kind, or a line that is neither, is one it does not model.
function collectionChildren(node, want) {
  const value = yamlValue(node.value);
  if (value === null || (value.emptyCollection && node.children.length > 0) || value.text !== undefined) throw new Unmodelled(node.line);
  for (const child of node.children) if (child[want] === undefined || child.bad) throw new Unmodelled(child.line);
  return node.children;
}

// A mapping's entries that each hold scalars only (an auth setting's lines being gone already): any deeper line is one it does
// not model.
function scalarFields(node) {
  return collectionChildren(node, "key").map((field) => ({ field, text: scalarText(field) }));
}

// .yarnrc.yml's npmScopes: each scope's npmRegistryServer, for that scope.
function npmScopesEntries(root) {
  return collectionChildren(root, "key").flatMap((scope) => {
    const scopeName = `@${scope.key.replace(/^@/, "")}`;
    return scalarFields(scope)
      .filter(({ field }) => field.key === "npmRegistryServer")
      .map(({ field, text }) => configEntry(field.line, registryVerdict(text), { registry: true, scope: scopeName }));
  });
}

// .yarnrc.yml's npmRegistries: each key names a registry (`//host` read as https), its settings below it.
function npmRegistriesEntries(root) {
  return collectionChildren(root, "key").map((registry) => {
    scalarFields(registry);
    const address = registry.key.startsWith("//") ? `https:${registry.key}` : registry.key;
    return configEntry(registry.line, registryVerdict(address));
  });
}

const HTTP_HOST = /^[A-Za-z0-9*.-]+$/;

// .yarnrc.yml's unsafeHttpWhitelist: each host, which Yarn may fetch from over plain http.
function unsafeHttpEntries(root) {
  return collectionChildren(root, "item").map((item) => {
    const host = scalarText(item);
    if (!HTTP_HOST.test(host)) throw new Unmodelled(item.line);
    return configEntry(item.line, classifySource("npm", `http://${host}`));
  });
}

const YARNRC_YML_SECTIONS = new Map([
  ["npmRegistryServer", (root) => [configEntry(root.line, registryVerdict(scalarText(root)), { registry: true })]],
  ["npmScopes", npmScopesEntries],
  ["npmRegistries", npmRegistriesEntries],
  ["unsafeHttpWhitelist", unsafeHttpEntries],
]);

// pnpm-workspace.yaml's packages: each folder pattern that leaves the repository.
const pnpmPackagesEntries = (root, folder) =>
  collectionChildren(root, "item").flatMap((item) => workspaceEntries([scalarText(item)], item.line, folder));

// A YAML file read for the root keys in `sections`, each read strictly by its handler (`(root, folder) → entries`, throwing
// Unmodelled); other root keys are passed over with the lines below them. A root line it cannot read as a plain key, a line with
// a tab or a lone carriage return, a directive, or a second document is one it does not model; lines that follow a root line it
// cannot read, up to the next root key, add nothing more. A problem in a section gives one entry it cannot read
// (`unreadable(line)`) in place of that section's entries from that point.
function readYamlConfig(text, folder, sections, unreadable) {
  const out = [];
  let block = null;
  let content = false;
  const finish = () => {
    if (block && block.handler) {
      try {
        out.push(...block.handler(yamlTree(block.root, block.lines), folder));
      } catch (err) {
        if (!(err instanceof Unmodelled)) throw err;
        out.push(unreadable(err.line));
      }
    }
    block = null;
  };
  const bad = (line) => {
    finish();
    out.push(unreadable(line));
    block = { bad: true };
  };
  const lines = linesOf(withoutBom(text));
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = i + 1;
    if (raw.includes("\r") || (raw.includes("\t") && !raw.trimStart().startsWith("#"))) {
      if (!(block && block.bad)) bad(line);
      continue;
    }
    if (raw.trim() === "" || raw.trimStart().startsWith("#") || YAML_AUTH_LINE.test(raw)) continue;
    const indent = leadingSpaces(raw);
    const rootLine = indent === 0 && raw !== "-" && !raw.startsWith("- ");
    if (rootLine && raw.trimEnd() === DOCUMENT_START && !content) continue;
    if (rootLine && (raw.trimEnd() === DOCUMENT_START || raw.startsWith("%") || raw.trimEnd() === "...")) {
      bad(line);
      break;
    }
    content = true;
    if (rootLine) {
      const parsed = yamlContent(raw.trimEnd());
      if (parsed.key === undefined || parsed.key === "<<") {
        if (!(block && block.bad)) bad(line);
        continue;
      }
      finish();
      const handler = sections.get(parsed.key);
      block = handler ? { handler, root: { line, key: parsed.key, value: parsed.value, children: [] }, lines: [] } : { skip: true };
    } else if (block === null) bad(line);
    else if (block.handler) block.lines.push({ text: raw.slice(indent).trimEnd(), line, indent });
  }
  finish();
  return out;
}

const unreadableConfig = (line) => configEntry(line, UNREADABLE);

// .yarnrc.yml (Yarn 2 and later): npmRegistryServer, npmScopes, npmRegistries and unsafeHttpWhitelist.
const readYarnrcYml = (text, folder = "") => readYamlConfig(text, folder, YARNRC_YML_SECTIONS, unreadableConfig);

// pnpm-workspace.yaml: the workspace's folders, for a workspace with no pnpm lockfile beside it.
const readPnpmWorkspace = (text, folder = "") => readYamlConfig(text, folder, new Map([["packages", pnpmPackagesEntries]]), unnamedEntry);

// uv.toml: uv's index settings at its top level.
const readUvToml = (text, folder = "") => uvConfigEntries(tomlValues(withoutBom(text)), [], folder);

module.exports = { readNpmrc, readYarnrc, readYarnrcYml, readUvToml, readPnpmWorkspace };

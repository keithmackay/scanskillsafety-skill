// ABOUTME: Reads the config files that name where installs in a folder fetch packages from (.npmrc, .yarnrc, .yarnrc.yml,
// ABOUTME: pnpm-workspace.yaml, uv.toml, pdm.toml); auth lines are never read, and a setting in a form it does not model is unreadable.
"use strict";

const { classifySource, EXPECTED, UNREADABLE } = require("../packageSources");
const { configEntry, fieldOf, leadingSpaces, linesOf, startsWithAny, unnamedEntry, workspaceEntries } = require("./shared");
const { pdmTomlEntries, tomlValues, uvConfigEntries } = require("./pyproject");
const { overrideTarget, packageJsonVerdict } = require("./packageJson");

const withoutBom = (text) => (text.startsWith("\uFEFF") ? text.slice(1) : text);

// What a registry setting names: the official registry, a mirror (host) or plain http; anything else (a path, a git address, text
// that is no address) is one it cannot read.
function registryVerdict(address) {
  const verdict = address === null ? UNREADABLE : classifySource("npm", address);
  return verdict.expected || verdict.kind === "host" || verdict.kind === "http" ? verdict : UNREADABLE;
}

// A scoped registry key's scope (`@myco:registry` → `@myco`).
const scopeOfKey = (key) => key.slice(0, key.indexOf(":"));

// A line it cannot read where a registry may be named: it covers every package of a lockfile that records no host, since it is
// reported itself.
const coveringUnreadable = (line) => configEntry(line, UNREADABLE, { covers: [null] });
const unreadableConfig = (line) => configEntry(line, UNREADABLE);

// A setting naming the registry for installs, or for one scope's packages when `scope` is given.
function registryEntry(line, verdict, scope = null) {
  if (verdict.unreadable) return coveringUnreadable(line);
  return configEntry(line, verdict, scope === null ? { covers: [null] } : { covers: [scope], scope });
}

// .npmrc and .yarnrc

// Lines as npm's ini reader and Yarn's rc reader split them: a carriage return alone ends a line too.
const rcLines = (text) => withoutBom(text).split(/\r\n|\n|\r/);

// The settings that hold credentials, alone or after a registry (`//host/:_authToken`).
const AUTH_SETTINGS = new Set(["_auth", "_authtoken", "_password", "username", "email", "certfile", "keyfile"]);

// An auth setting (`//host/:_authToken=…`, `_auth=…`, `_password=…`), known by the setting after the key's last colon, so a scope
// named like one (`@x_auth:registry`) is still read: never read further, so its value reaches nothing.
function isAuthLine(key) {
  const name = key.trim().replace(/"/g, "").replace(/\[\]$/, "");
  return AUTH_SETTINGS.has(name.slice(name.lastIndexOf(":") + 1).toLowerCase());
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

// The settings read that name no registry for installs.
const OTHER_NPM_SETTINGS = ["replace-registry-host", "omit-lockfile-registry-resolved"];

// What one .npmrc registry setting gives, by its key as written, whether it sits in a section, and its value (null when not in a
// form modelled). Any other spelling, or a key in a section, is one it cannot read.
function npmSettingEntry(key, inSection, value, line) {
  if (!inSection && key === "registry") return registryEntry(line, registryVerdict(value));
  if (!inSection && SCOPED_REGISTRY.test(key)) return registryEntry(line, registryVerdict(value), scopeOfKey(key));
  if (!inSection && key === "replace-registry-host") return configEntry(line, replacedHostVerdict(value));
  if (!inSection && key === "omit-lockfile-registry-resolved") return configEntry(line, omitResolvedVerdict(value));
  return OTHER_NPM_SETTINGS.includes(looseKey(key)) ? unreadableConfig(line) : coveringUnreadable(line);
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
    if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#") || isAuthLine(rawKey)) return;
    if (/^\[[^\]]*\]\s*$/.test(raw)) {
      inSection = true;
      return;
    }
    if (!mayNameSetting(looseKey(rawKey), NPM_SETTINGS)) return;
    const value = eq < 0 || inSection ? null : iniValue(raw.slice(eq + 1));
    out.push(npmSettingEntry(rawKey.trim(), inSection, value, i + 1));
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
  if (match === null) return coveringUnreadable(line);
  const key = match[1].replace(/"/g, "");
  const address = match[2].includes("${") ? null : match[2];
  return registryEntry(line, registryVerdict(address), key === "registry" ? null : scopeOfKey(key));
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
    if (trimmed === "" || trimmed.startsWith("#") || isAuthLine(yarnrcKey(trimmed))) return;
    if (/^\s/.test(raw)) {
      if (root !== null && !root.unreadable) {
        out.push(coveringUnreadable(line));
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
      .map(({ field, text }) => registryEntry(field.line, registryVerdict(text), scopeName));
  });
}

// .yarnrc.yml's npmRegistries: each key names a registry (`//host` read as https), its settings below it.
function npmRegistriesEntries(root) {
  return collectionChildren(root, "key").map((registry) => {
    scalarFields(registry);
    const verdict = registryVerdict(registry.key.startsWith("//") ? `https:${registry.key}` : registry.key);
    return verdict.unreadable ? coveringUnreadable(registry.line) : configEntry(registry.line, verdict);
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

// A root key's reader (`(root, folder) → entries`, throwing Unmodelled) and what a problem in it gives (`unreadable(line)`): by
// default a line that covers a lockfile recording no host, as one naming a registry would.
const section = (read, unreadable = coveringUnreadable) => ({ read, unreadable });

// A root key holding one registry address, for installs.
const registryScalarEntries = (root) => [registryEntry(root.line, registryVerdict(scalarText(root)))];

const YARNRC_YML_SECTIONS = new Map([
  ["npmRegistryServer", section(registryScalarEntries)],
  ["npmScopes", section(npmScopesEntries)],
  ["npmRegistries", section(npmRegistriesEntries)],
  ["unsafeHttpWhitelist", section(unsafeHttpEntries, unreadableConfig)],
]);

// pnpm-workspace.yaml's packages: each folder pattern that leaves the repository.
const pnpmPackagesEntries = (root, folder) =>
  collectionChildren(root, "item").flatMap((item) => workspaceEntries([scalarText(item)], item.line, folder));

// A package a catalog or override names, by a value read as package.json's are: reported when it is not from the registry.
function namedValueEntries(name, field, folder) {
  const verdict = packageJsonVerdict(scalarText(field), folder);
  return verdict.expected ? [] : [{ name, version: null, line: field.line, classified: verdict }];
}

// pnpm-workspace.yaml's catalog: each package's version or source.
const catalogEntries = (root, folder) => collectionChildren(root, "key").flatMap((field) => namedValueEntries(field.key, field, folder));
// pnpm-workspace.yaml's catalogs: catalogs by name, each read as the catalog is.
const catalogsEntries = (root, folder) => collectionChildren(root, "key").flatMap((catalog) => catalogEntries(catalog, folder));
// pnpm-workspace.yaml's overrides: each named by the package it replaces.
const overridesEntries = (root, folder) =>
  collectionChildren(root, "key").flatMap((field) => namedValueEntries(overrideTarget(field.key), field, folder));

// A scope as pnpm names one in `scopes`; a bare `@` is the unscoped default registry.
const PNPM_SCOPE = /^@(?:[A-Za-z0-9._~-]+)?$/;
const coveredScope = (scope) => (scope === "@" ? null : scope);

// A one-line flow sequence of scalars (`['@a', "@b"]`), their texts; null for any other form, a nested collection or a comment
// after it among them.
function flowScalars(value) {
  if (!value.startsWith("[") || !value.endsWith("]")) return null;
  const inner = value.slice(1, -1).trim();
  if (inner === "") return [];
  if (/[[\]{}]/.test(inner)) return null;
  const items = inner.split(",").map((part) => yamlValue(part.trim()));
  return items.every((item) => item !== null && item.text !== undefined) ? items.map((item) => item.text) : null;
}

// A registries entry's scopes, as a flow sequence on its line or a block sequence below it, each a scope.
function scopeList(field) {
  const flow = field.value.startsWith("[") ? flowScalars(field.value) : undefined;
  if (flow === null || (flow !== undefined && field.children.length > 0)) throw new Unmodelled(field.line);
  const scopes = flow ?? collectionChildren(field, "item").map(scalarText);
  if (!scopes.every((scope) => PNPM_SCOPE.test(scope))) throw new Unmodelled(field.line);
  return scopes;
}

// The fields of a registries entry keyed by its URL; any other is one it does not model.
const PNPM_REGISTRY_FIELDS = new Set(["serverType", "scopes", "prefix", "networkConcurrency", "supportsTimeField", "ecosystem"]);

// One pnpm-workspace.yaml registries entry: keyed by its URL, covering the scopes routed to it (none when it only answers a
// prefix) and serving npm; or, in the older shape, a scope (`@` or `default` being the default registry) and its URL.
function pnpmRegistryEntry(registry) {
  const { key } = registry;
  if (key === "default" || key.startsWith("@")) {
    if (key !== "default" && !PNPM_SCOPE.test(key)) throw new Unmodelled(registry.line);
    return registryEntry(registry.line, registryVerdict(scalarText(registry)), key === "default" ? null : coveredScope(key));
  }
  if (!/^https?:\/\//i.test(key)) throw new Unmodelled(registry.line);
  const covers = [];
  for (const field of collectionChildren(registry, "key")) {
    if (!PNPM_REGISTRY_FIELDS.has(field.key)) throw new Unmodelled(field.line);
    if (field.key === "scopes") covers.push(...scopeList(field).map(coveredScope));
    else if (scalarText(field) !== "npm" && field.key === "ecosystem") throw new Unmodelled(field.line);
  }
  const verdict = registryVerdict(key);
  return verdict.unreadable ? coveringUnreadable(registry.line) : configEntry(registry.line, verdict, { covers });
}

// pnpm-workspace.yaml's namedRegistries: registries a dependency addresses by a prefix, which route no package of their own.
const namedRegistriesEntries = (root) =>
  scalarFields(root).map(({ field, text }) => {
    const verdict = registryVerdict(text);
    return verdict.unreadable ? coveringUnreadable(field.line) : configEntry(field.line, verdict);
  });

const PNPM_SETTINGS_SECTIONS = new Map([
  ["registry", section(registryScalarEntries)],
  ["registries", section((root) => collectionChildren(root, "key").map(pnpmRegistryEntry))],
  ["namedRegistries", section(namedRegistriesEntries)],
  ["catalog", section(catalogEntries, unnamedEntry)],
  ["catalogs", section(catalogsEntries, unnamedEntry)],
  ["overrides", section(overridesEntries, unnamedEntry)],
]);
const PNPM_WORKSPACE_SECTIONS = new Map([...PNPM_SETTINGS_SECTIONS, ["packages", section(pnpmPackagesEntries, unnamedEntry)]]);

// A YAML file read for the root keys in `sections`, each read strictly by its section's reader; other root keys are passed over
// with the lines below them. A root line it cannot read as a plain key, a line with a tab or a lone carriage return, a directive,
// or a second document is one it does not model, and may hide a registry; lines that follow a root line it cannot read, up to the
// next root key, add nothing more. A problem in a section gives one entry it cannot read, its section's, in place of that
// section's entries from that point.
function readYamlConfig(text, folder, sections) {
  const unreadable = coveringUnreadable;
  const out = [];
  let block = null;
  let content = false;
  const finish = () => {
    if (block && block.handler) {
      try {
        out.push(...block.handler.read(yamlTree(block.root, block.lines), folder));
      } catch (err) {
        if (!(err instanceof Unmodelled)) throw err;
        out.push(block.handler.unreadable(err.line));
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

// .yarnrc.yml (Yarn 2 and later): npmRegistryServer, npmScopes, npmRegistries and unsafeHttpWhitelist.
const readYarnrcYml = (text, folder = "") => readYamlConfig(text, folder, YARNRC_YML_SECTIONS);

// pnpm-workspace.yaml: its registry settings, catalogs and overrides, and the workspace's folders.
const readPnpmWorkspace = (text, folder = "") => readYamlConfig(text, folder, PNPM_WORKSPACE_SECTIONS);
// pnpm-workspace.yaml beside a pnpm lockfile, whose importers already name the workspace's folders.
const readPnpmWorkspaceSettings = (text, folder = "") => readYamlConfig(text, folder, PNPM_SETTINGS_SECTIONS);

// uv.toml: uv's index settings at its top level and in [pip].
const readUvToml = (text, folder = "") => uvConfigEntries(tomlValues(withoutBom(text)), [], folder);

// pdm.toml: PDM's index settings.
const readPdmToml = (text, folder = "") => pdmTomlEntries(tomlValues(withoutBom(text)), folder);

module.exports = { readNpmrc, readYarnrc, readYarnrcYml, readUvToml, readPdmToml, readPnpmWorkspace, readPnpmWorkspaceSettings };

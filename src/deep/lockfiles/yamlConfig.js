// ABOUTME: Reads .yarnrc.yml (registries, scopes, plain-http hosts, certificate checks, package extensions) and pnpm-workspace.yaml
// ABOUTME: (registries, catalogs, overrides, package extensions, workspace folders) for where installs fetch packages from.
"use strict";

const { classifySource } = require("../packageSources");
const { manifestEntries, unnamedEntry, workspaceEntries } = require("./shared");
const { certificateChecksOff, configEntry, configOrCovering, registryEntry, registryVerdict, unreadableConfig } = require("./configEntries");
const { Unmodelled, collectionChildren, flowScalars, readYamlConfig, scalarFields, scalarText, section } = require("./yamlTree");
const { dependencyFound, EXTENSION_META, EXTENSION_SECTIONS, overrideTarget } = require("./packageJson");

// .yarnrc.yml's npmScopes: each scope's npmRegistryServer, for that scope.
function npmScopesEntries(root) {
  return collectionChildren(root, "key").flatMap((scope) => {
    const scopeName = `@${scope.key.replace(/^@/, "")}`;
    return scalarFields(scope)
      .filter(({ field }) => field.key === "npmRegistryServer")
      .map(({ field, text }) => registryEntry(field.line, registryVerdict(text), scopeName));
  });
}

// How Yarn reads a boolean setting's text, in any case; any other text is one it does not model.
const YAML_FALSE = new Set(["false", "no", "off", "0"]);
const YAML_TRUE = new Set(["true", "yes", "on", "1"]);
const YARN_STRICT_SSL_OFF = certificateChecksOff("enableStrictSsl: false");

// An enableStrictSsl setting: false is reported, true gives nothing.
function strictSslEntries(node) {
  const flag = scalarText(node).toLowerCase();
  if (YAML_FALSE.has(flag)) return [configEntry(node.line, YARN_STRICT_SSL_OFF)];
  if (YAML_TRUE.has(flag)) return [];
  throw new Unmodelled(node.line);
}

// .yarnrc.yml's npmRegistries: each key names a registry (`//host` read as https), its settings below it, an enableStrictSsl
// among them read as the top-level one is.
function npmRegistriesEntries(root) {
  return collectionChildren(root, "key").flatMap((registry) => {
    const fields = scalarFields(registry);
    const verdict = registryVerdict(registry.key.startsWith("//") ? `https:${registry.key}` : registry.key);
    const entry = configOrCovering(registry.line, verdict);
    const strictSsl = fields.filter(({ field }) => field.key === "enableStrictSsl").flatMap(({ field }) => strictSslEntries(field));
    return [entry, ...strictSsl];
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

// A root key holding one registry address, for installs.
const registryScalarEntries = (root) => [registryEntry(root.line, registryVerdict(scalarText(root)))];

const YARNRC_YML_SECTIONS = new Map([
  ["npmRegistryServer", section(registryScalarEntries)],
  ["npmScopes", section(npmScopesEntries)],
  ["npmRegistries", section(npmRegistriesEntries)],
  ["unsafeHttpWhitelist", section(unsafeHttpEntries, unreadableConfig)],
  ["enableStrictSsl", section(strictSslEntries, unreadableConfig)],
  ["packageExtensions", section(packageExtensionsEntries, unnamedEntry)],
]);

// pnpm-workspace.yaml's packages: each folder pattern that leaves the repository.
const pnpmPackagesEntries = (root, folder) =>
  collectionChildren(root, "item").flatMap((item) => workspaceEntries([scalarText(item)], item.line, folder));

// What a mapping of package names to values gives, each value read as a package.json dependency's is (`role`: `checked` when the
// registry names are sent to OSV, `overrides` when only the packages a value names in place of its key's are): the packages from
// outside the registry, and the registry names sent to OSV.
const dependencyFields = (node, folder, nameOf, role) =>
  collectionChildren(node, "key").flatMap((field) =>
    dependencyFound(nameOf(field.key), { value: scalarText(field), line: field.line }, role, folder),
  );
const asEntries = (found) => manifestEntries(found, (name) => name);
const CATALOG = { checked: true, overrides: false };
const OVERRIDE = { checked: false, overrides: true };
const EXTENSION = { checked: false, overrides: false };
const ownName = (name) => name;

// pnpm-workspace.yaml's catalog: each package's version or source; a registry range's package is sent to OSV by name.
const catalogEntries = (root, folder) => asEntries(dependencyFields(root, folder, ownName, CATALOG));
// pnpm-workspace.yaml's catalogs: catalogs by name, each read as the catalog is.
const catalogsEntries = (root, folder) =>
  asEntries(collectionChildren(root, "key").flatMap((catalog) => dependencyFields(catalog, folder, ownName, CATALOG)));
// pnpm-workspace.yaml's overrides: each named by the package it replaces.
const overridesEntries = (root, folder) => asEntries(dependencyFields(root, folder, overrideTarget, OVERRIDE));

// packageExtensions (pnpm-workspace.yaml, .yarnrc.yml): `<selector>: { dependencies: { <name>: <value> } }`, each dependency it adds
// from outside the registry; any other section is one it does not model.
function packageExtensionsEntries(root, folder) {
  const found = collectionChildren(root, "key").flatMap((selector) =>
    collectionChildren(selector, "key").flatMap((field) => {
      if (field.key === EXTENSION_META) return [];
      if (!EXTENSION_SECTIONS.has(field.key)) throw new Unmodelled(field.line);
      return dependencyFields(field, folder, ownName, EXTENSION);
    }),
  );
  return asEntries(found);
}

// A scope as pnpm names one in `scopes`; a bare `@` is the unscoped default registry.
const PNPM_SCOPE = /^@(?:[A-Za-z0-9._~-]+)?$/;
const coveredScope = (scope) => (scope === "@" ? null : scope);

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
    if (field.key === "scopes") {
      for (const scope of scopeList(field)) covers.push(coveredScope(scope));
      continue;
    }
    const text = scalarText(field);
    // Only an npm registry is modelled; one serving another ecosystem is not.
    if (field.key === "ecosystem" && text !== "npm") throw new Unmodelled(field.line);
  }
  return configOrCovering(registry.line, registryVerdict(key), { covers });
}

// pnpm-workspace.yaml's namedRegistries: registries a dependency addresses by a prefix, which route no package of their own.
const namedRegistriesEntries = (root) =>
  scalarFields(root).map(({ field, text }) => configOrCovering(field.line, registryVerdict(text)));

const PNPM_SETTINGS_SECTIONS = new Map([
  ["registry", section(registryScalarEntries)],
  ["registries", section((root) => collectionChildren(root, "key").map(pnpmRegistryEntry))],
  ["namedRegistries", section(namedRegistriesEntries)],
  ["catalog", section(catalogEntries, unnamedEntry)],
  ["catalogs", section(catalogsEntries, unnamedEntry)],
  ["overrides", section(overridesEntries, unnamedEntry)],
  ["packageExtensions", section(packageExtensionsEntries, unnamedEntry)],
]);
const PNPM_WORKSPACE_SECTIONS = new Map([...PNPM_SETTINGS_SECTIONS, ["packages", section(pnpmPackagesEntries, unnamedEntry)]]);

// .yarnrc.yml (Yarn 2 and later): npmRegistryServer, npmScopes, npmRegistries and unsafeHttpWhitelist.
const readYarnrcYml = (text, folder = "") => readYamlConfig(text, folder, YARNRC_YML_SECTIONS);

// pnpm-workspace.yaml: its registry settings, catalogs and overrides, and the workspace's folders.
const readPnpmWorkspace = (text, folder = "") => readYamlConfig(text, folder, PNPM_WORKSPACE_SECTIONS);
// pnpm-workspace.yaml beside a pnpm lockfile, whose importers already name the workspace's folders.
const readPnpmWorkspaceSettings = (text, folder = "") => readYamlConfig(text, folder, PNPM_SETTINGS_SECTIONS);

module.exports = { readYarnrcYml, readPnpmWorkspace, readPnpmWorkspaceSettings };

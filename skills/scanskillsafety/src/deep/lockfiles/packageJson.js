// ABOUTME: Reads every package.json: its names for OSV (a covering lockfile only keeps from OSV the names it sent), and every
// ABOUTME: dependency, override and workspace from outside the registry or the repository, with its line; a shape it cannot read is reported.
"use strict";

const { isObject } = require("../util");
const { classifyManifestValue, UNREADABLE } = require("../packageSources");
const {
  append,
  jsonMembers,
  localPathVerdict,
  manifestEntries,
  parseJson,
  ROOT_OBJECT,
  SEMVER,
  unnamedEntry,
  unreadableNamed,
  withoutBom,
  workspaceEntries,
} = require("./shared");

// The sections whose registry names are sent to OSV; the others are read only for where they fetch from.
const CHECKED_SECTIONS = new Set(["dependencies", "optionalDependencies", "peerDependencies"]);
const SOURCE_SECTIONS = new Set([...CHECKED_SECTIONS, "devDependencies", "overrides", "resolutions"]);
// The sections that replace a package wherever it is installed, so one they name in place of the key's is sent to OSV.
const OVERRIDE_SECTIONS = new Set(["overrides", "resolutions", "pnpm.overrides"]);

// The package an override or resolution key is about: the last package of a pnpm `a>b` chain or of a Yarn `a/**/b` path, without
// its version range.
function overrideTarget(key) {
  const last = key.slice(key.lastIndexOf(">") + 1);
  const parts = last.split("/");
  const scoped = parts.length > 1 && parts[parts.length - 2].startsWith("@");
  const tail = scoped ? parts.slice(-2).join("/") : parts[parts.length - 1];
  const at = tail.indexOf("@", 1);
  return at < 0 ? tail : tail.slice(0, at);
}

// An npm package name, scoped or not, in the characters npm allows; a version or range (`18.2.0`, `1.x`, `~3`) is not one.
const NPM_NAME = /^(?:@[A-Za-z0-9-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9-][A-Za-z0-9._~-]*$/;
const VERSION_LIKE = /^v?\d+(?:\.(?:\d+|x|\*))*(?:[-+][0-9A-Za-z.+-]*)?$/i;
const isPackageName = (text) => NPM_NAME.test(text) && !VERSION_LIKE.test(text);

// The one release a range pins, as npm reads an exact version (spaces around it, one leading `=`, then one `v`), or null for any
// other range or tag.
function exactVersion(range) {
  const exact = range.trim().replace(/^=/, "").replace(/^v/, "");
  return SEMVER.test(exact) ? exact : null;
}

// The package an npm alias (`npm:<name>@<range>`, `npm:<name>`, in any case) names, whether a range follows it and the version an
// exact one pins; null for any other value, or when the text after `npm:` is no package name (`npm:^4.17.21`), which leaves the
// key's package.
function aliasParts(value) {
  if (value.slice(0, 4).toLowerCase() !== "npm:") return null;
  const spec = value.slice(4);
  const at = spec.indexOf("@", 1);
  const name = at < 0 ? spec : spec.slice(0, at);
  return isPackageName(name) ? { name, ranged: at >= 0, version: at < 0 ? null : exactVersion(spec.slice(at + 1)) } : null;
}
const aliasTarget = (value) => aliasParts(value)?.name ?? null;

// The package a `patch:` value patches: the alias its inner resolution names, else the package named before it; null when it
// names none.
function patchTarget(value) {
  if (!value.startsWith("patch:")) return null;
  let body = value.slice("patch:".length).split("#", 1)[0];
  try {
    body = decodeURIComponent(body);
  } catch {
    return null;
  }
  const at = body.indexOf("@", 1);
  if (at < 0) return null;
  const name = body.slice(0, at);
  return aliasTarget(body.slice(at + 1)) ?? (isPackageName(name) ? name : null);
}

// The longest tarball file name read: npm caps a name at 214 characters, so a longer one is no package's.
const MAX_TARBALL_FILE = 512;

// The package and version a tarball on the official npm registry is, from its file name, `<name>-<version>.tgz`, under
// `/<package>/-/` or `/@<scope>/<package>/-/` (the `/` after the scope possibly encoded), the scope kept; the file is what is
// downloaded, so its name wins over the folder's. null when the path is not one.
function registryTarball(value) {
  let segments;
  try {
    segments = decodeURIComponent(new URL(value).pathname).slice(1).split("/");
  } catch {
    return null;
  }
  const scope = segments[0].startsWith("@") ? segments[0] : null;
  const [dash, file, ...more] = segments.slice(scope === null ? 1 : 2);
  const tarball = file !== undefined && file.length <= MAX_TARBALL_FILE && file.endsWith(".tgz");
  if (dash !== "-" || more.length > 0 || !tarball) return null;
  const stem = file.slice(0, -".tgz".length);
  for (let at = stem.indexOf("-"); at > 0; at = stem.indexOf("-", at + 1)) {
    const version = stem.slice(at + 1);
    if (!SEMVER.test(version)) continue;
    const name = scope === null ? stem.slice(0, at) : `${scope}/${stem.slice(0, at)}`;
    return isPackageName(name) ? { name, version } : null;
  }
  return null;
}

// The packages a registry value names beyond its key, each with a version or null: the package an alias or a patch installs (for
// `npm:<tag>`, which npm reads as a package and Yarn as a tag of the key's package, both), or the package and version a registry
// tarball is; UNREADABLE for an address on the registry that is no tarball it can read; null when it is a range or a tag for the
// key's package.
function namedPackages(value, keyName) {
  const alias = aliasParts(value);
  if (alias !== null) return [{ name: alias.name, version: alias.version }, ...(alias.ranged ? [] : [{ name: keyName, version: null }])];
  const patched = patchTarget(value);
  if (patched !== null) return [{ name: patched, version: null }];
  if (!/^https?:/i.test(value)) return null;
  const tarball = registryTarball(value);
  return tarball === null ? UNREADABLE : [tarball];
}

// The values of one section, each with its name and the line of its value: walked iteratively, depth first in parse order,
// through nested override objects (`.` naming the package of the object it is in). A value that is neither a string nor, where
// overrides nest, an object is one it cannot read (`value: null`). A line is given only when the text at it is the value parsed.
function sectionValues(section, members, object, nests) {
  const values = [];
  const stack = [{ entries: Object.entries(section), next: 0, object, parent: null }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.next === frame.entries.length) {
      stack.pop();
      continue;
    }
    const [key, value] = frame.entries[frame.next++];
    const member = members(frame.object, key);
    const name = key === "." && frame.parent !== null ? frame.parent : key;
    if (typeof value === "string") values.push({ name, value, line: member?.text === value ? member.line : null });
    else if (nests && isObject(value)) {
      stack.push({ entries: Object.entries(value), next: 0, object: member?.object, parent: name });
    } else values.push({ name, value: null, line: member?.line ?? null });
  }
  return values;
}

// A package.json value: a local path is read from the manifest's folder (a path outside the project when it leaves the
// repository; inside it, an archive is bundled and a folder stays local).
function packageJsonVerdict(value, folder) {
  const verdict = classifyManifestValue("npm", value);
  return verdict.kind === "local" ? localPathVerdict(value, folder, verdict) : verdict;
}

// What one package.json dependency gives: its source when that is not the registry, or one it cannot read for a registry address
// that is no tarball; from the registry, in a checked section, the packages it names (the key's, or those an alias, a patch or a
// registry tarball names); in an override section, only packages an alias, a patch or a registry tarball names, which are
// installed in place of the key's; in any other section, nothing.
function dependencyFound(packageName, { value, line }, { checked, overrides }, folder) {
  const verdict = packageJsonVerdict(value, folder);
  if (!verdict.expected) return [{ entry: { name: packageName, version: null, line, classified: verdict }, checked }];
  const named = namedPackages(value, packageName);
  if (named?.unreadable) return [{ entry: unreadableNamed(packageName, line), checked }];
  // An exact version pins one release, which is checked as such; a range or a tag only names the package.
  if (named === null) return checked ? [{ entry: { name: packageName, version: exactVersion(value), line }, checked: true }] : [];
  if (!checked && !overrides) return [];
  return named.map(({ name, version }) => ({ entry: { name, version, line }, checked: true }));
}

// What package.json's `workspaces` gives, as an array of folder patterns or as `{ packages: [...] }`: each pattern that leaves
// the repository, at the line of the array.
function workspaceFound(json, members, folder) {
  if (!Object.hasOwn(json, "workspaces")) return [];
  const member = members(ROOT_OBJECT, "workspaces");
  const { workspaces } = json;
  const listed = isObject(workspaces) && Object.hasOwn(workspaces, "packages");
  const patterns = listed ? workspaces.packages : workspaces;
  const line = (listed ? members(member?.object, "packages") : member)?.line ?? null;
  return workspaceEntries(patterns, line, folder).map((entry) => ({ entry, checked: false }));
}

// The sections of a package extension that add dependencies; `peerDependenciesMeta` names none and is passed over.
const EXTENSION_SECTIONS = new Set(["dependencies", "optionalDependencies", "peerDependencies"]);
const EXTENSION_META = "peerDependenciesMeta";

// What `pnpm.packageExtensions` gives (`{ <selector>: { dependencies: { <name>: <value> } } }`, read from `member`): each
// dependency it adds from outside the registry; an extension, a section or a value in any other shape is one it cannot read.
function packageExtensionsFound(extensions, member, members, folder) {
  const unreadable = (at) => ({ entry: unnamedEntry(at?.line ?? null), checked: false });
  if (!isObject(extensions)) return [unreadable(member)];
  const found = [];
  for (const [selector, extension] of Object.entries(extensions)) {
    const selectorMember = members(member?.object, selector);
    if (!isObject(extension)) {
      found.push(unreadable(selectorMember));
      continue;
    }
    for (const [field, section] of Object.entries(extension)) {
      const fieldMember = members(selectorMember?.object, field);
      if (field === EXTENSION_META) continue;
      if (!EXTENSION_SECTIONS.has(field) || !isObject(section)) {
        found.push(unreadable(fieldMember));
        continue;
      }
      for (const dependency of sectionValues(section, members, fieldMember?.object, false)) {
        if (dependency.value === null) found.push({ entry: unreadableNamed(dependency.name, dependency.line), checked: false });
        else append(found, dependencyFound(dependency.name, dependency, { checked: false, overrides: false }, folder));
      }
    }
  }
  return found;
}

// package.json's dependencies in every section that can name a source, and the overrides in `pnpm.overrides` and package
// extensions in `pnpm.packageExtensions`. A section that is not an object is one it cannot read.
function readPackageJson(text, folder = "") {
  const unmarked = withoutBom(text);
  const json = parseJson(unmarked);
  if (!isObject(json)) return [];
  const members = jsonMembers(unmarked);
  const sections = [];
  const found = workspaceFound(json, members, folder);
  for (const [name, value] of Object.entries(json)) {
    const member = members(ROOT_OBJECT, name);
    if (SOURCE_SECTIONS.has(name)) sections.push({ name, value, member, nests: name === "overrides" });
    else if (name === "pnpm" && isObject(value)) {
      if (Object.hasOwn(value, "overrides")) {
        const overrides = members(member?.object, "overrides");
        sections.push({ name: "pnpm.overrides", value: value.overrides, member: overrides, nests: false });
      }
      if (Object.hasOwn(value, "packageExtensions")) {
        const extensions = members(member?.object, "packageExtensions");
        append(found, packageExtensionsFound(value.packageExtensions, extensions, members, folder));
      }
    }
  }
  for (const { name, value, member, nests } of sections) {
    const checked = CHECKED_SECTIONS.has(name);
    if (!isObject(value)) {
      found.push({ entry: unnamedEntry(member?.line ?? null), checked });
      continue;
    }
    for (const dependency of sectionValues(value, members, member?.object, nests)) {
      const packageName = checked ? dependency.name : overrideTarget(dependency.name);
      if (dependency.value === null) found.push({ entry: unreadableNamed(packageName, dependency.line), checked });
      else found.push(...dependencyFound(packageName, dependency, { checked, overrides: OVERRIDE_SECTIONS.has(name) }, folder));
    }
  }
  return manifestEntries(found, (name) => name);
}

module.exports = { readPackageJson, dependencyFound, EXTENSION_META, EXTENSION_SECTIONS, overrideTarget };

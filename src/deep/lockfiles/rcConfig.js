// ABOUTME: Reads .npmrc and .yarnrc (Yarn 1) as npm's ini reader and Yarn's rc reader read them, for the settings that name where
// ABOUTME: installs fetch packages from, load another config file, or turn off certificate checks; auth lines are never read.
"use strict";

const { EXPECTED, UNREADABLE } = require("../packageSources");
const { withoutBom } = require("./shared");
const {
  certificateChecksOff,
  configEntry,
  coveringUnreadable,
  registryEntry,
  registryVerdict,
  trustedCertificatesReplaced,
  unreadableConfig,
} = require("./configEntries");

// A scoped registry key's scope (`@myco:registry` → `@myco`).
const scopeOfKey = (key) => key.slice(0, key.indexOf(":"));

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

// The settings that make npm load another config file, each with the path of that file under the value (`prefix` loads
// `<prefix>/etc/npmrc`).
const CONFIG_POINTERS = new Map([["userconfig", ""], ["globalconfig", ""], ["prefix", "/etc/npmrc"]]);
const NPM_SETTINGS = ["registry", "replace-registry-host", "omit-lockfile-registry-resolved", "strict-ssl", ...CONFIG_POINTERS.keys()];
const NPM_STRICT_SSL_OFF = certificateChecksOff("strict-ssl=false");
// A key that may name a registry setting, however written; one holding a variable may become any key.
const mayNameSetting = (loose, settings) => loose.includes("${") || settings.includes(loose) || loose.endsWith(":registry");

// A scoped registry key as npm and Yarn write one.
const SCOPED_REGISTRY = /^@[A-Za-z0-9._~-]+:registry$/;

// A value as npm's ini reader gives it, in the forms modelled here: unquoted with no escape or quote, up to an ini comment, or
// quoted with no quote or escape inside; null for any other form, or one holding a variable, which npm expands.
function iniValue(raw) {
  const value = raw.trim();
  if (value.includes("${") || value.includes("\\")) return null;
  const quote = value[0];
  if (quote !== '"' && quote !== "'") {
    const uncommented = value.split(/[;#]/, 1)[0].trim();
    return /["']/.test(uncommented) ? null : uncommented;
  }
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

// The settings that supply a certificate authority, alone or after a registry (`//host/:cafile`), each reported whatever its value.
const CA_SETTINGS = new Map([["ca", trustedCertificatesReplaced("ca")], ["cafile", trustedCertificatesReplaced("cafile")]]);
// The certificate authority setting a key names, however written; undefined for any other key.
function caSetting(key) {
  const loose = looseKey(key);
  return CA_SETTINGS.get(loose.slice(loose.lastIndexOf(":") + 1));
}

// The settings read that name no registry for installs.
const OTHER_NPM_SETTINGS = ["replace-registry-host", "omit-lockfile-registry-resolved", "strict-ssl"];

// What one .npmrc registry setting gives, by its key as written, whether it sits in a section, and its value (null when not in a
// form modelled): a pointer to another config file gives the path it names (`follows`), read from the .npmrc's folder, and the
// part npm loads it as (`role`: its user config, or its global config). Any other
// spelling, or a key in a section, is one it cannot read.
function npmSettingEntry(key, inSection, value, line) {
  if (!inSection && CONFIG_POINTERS.has(key)) {
    if (value === null || value === "") return coveringUnreadable(line);
    return { line, follows: `${value}${CONFIG_POINTERS.get(key)}`, role: key === "userconfig" ? "user" : "global" };
  }
  if (!inSection && key === "registry") return registryEntry(line, registryVerdict(value));
  if (!inSection && SCOPED_REGISTRY.test(key)) return registryEntry(line, registryVerdict(value), scopeOfKey(key));
  if (!inSection && key === "replace-registry-host") return configEntry(line, replacedHostVerdict(value));
  if (!inSection && key === "omit-lockfile-registry-resolved") return configEntry(line, omitResolvedVerdict(value));
  if (!inSection && key === "strict-ssl") {
    return configEntry(line, value === "false" ? NPM_STRICT_SSL_OFF : value === "true" ? EXPECTED : UNREADABLE);
  }
  return OTHER_NPM_SETTINGS.includes(looseKey(key)) ? unreadableConfig(line) : coveringUnreadable(line);
}

// A key or value holding a quote or backslash, which npm's ini reader decodes (JSON-parsing a quoted key) and Yarn's rc reader
// too, so it may read as any key.
const DECODED = /["'\\]/;

// .npmrc, read as npm's ini reader reads it: `key=value` lines, `;` and `#` comment lines, `[section]` headers, a key ending at its
// first `;` or `#`. A key holding a quote or backslash is one it cannot read, whatever it names, before auth lines are told apart.
// Only the registry settings, the pointers to other config files, strict-ssl, and ca and cafile (whatever their value) are read; one written in any form not modelled here
// (another spelling of the key, a value with an escape or variable, an array, no value, inside a section) is one it cannot read.
function readNpmrc(text) {
  const out = [];
  let inSection = false;
  rcLines(text).forEach((raw, i) => {
    const trimmed = raw.trim();
    const eq = raw.indexOf("=");
    const key = (eq < 0 ? raw : raw.slice(0, eq)).split(/[;#]/, 1)[0].trim();
    if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) return;
    if (/^\[[^\]]*\]\s*$/.test(raw)) {
      inSection = true;
      return;
    }
    if (DECODED.test(key)) out.push(coveringUnreadable(i + 1));
    else if (isAuthLine(key)) return;
    else if (caSetting(key)) out.push(configEntry(i + 1, caSetting(key)));
    else if (mayNameSetting(looseKey(key), NPM_SETTINGS)) {
      const value = eq < 0 || inSection ? null : iniValue(raw.slice(eq + 1));
      out.push(npmSettingEntry(key, inSection, value, i + 1));
    }
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
// spelling of such a key, an unquoted address, or lines indented under one is one it cannot read, as is a key holding a
// backslash, which Yarn decodes. Other settings and the lines indented under them are passed over.
function readYarnrc(text) {
  const out = [];
  let root = null;
  rcLines(text).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    const key = yarnrcKey(trimmed);
    if (trimmed === "" || trimmed.startsWith("#")) return;
    if (!/^\s/.test(raw) && key.includes("\\")) {
      out.push(coveringUnreadable(line));
      root = { unreadable: true };
      return;
    }
    if (isAuthLine(key)) return;
    if (/^\s/.test(raw)) {
      if (root !== null && !root.unreadable) {
        out.push(coveringUnreadable(line));
        root.unreadable = true;
      }
      return;
    }
    root = null;
    if (!mayNameSetting(looseKey(key), ["registry"])) return;
    const entry = yarnrcEntry(raw.trimEnd(), line);
    out.push(entry);
    root = { unreadable: entry.classified.unreadable === true };
  });
  return out;
}

module.exports = { readNpmrc, readYarnrc };

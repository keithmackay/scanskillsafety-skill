// ABOUTME: Builds the entries config readers give for a setting: one naming where packages come from, a registry for installs
// ABOUTME: that covers a lockfile recording no host, a setting that turns off certificate checks, or a line it cannot read.
"use strict";

const { classifySource, UNREADABLE } = require("../packageSources");

// A config setting that names where packages come from, as a reader read it: `covers` lists the scopes whose registry for installs
// it names (null for the unscoped registry), so a lockfile that records no host is known to be covered by it; `scope` is the one
// scope a scoped setting names, shown with it.
const configEntry = (line, classified, extra = {}) => ({ line, from: "config", classified, ...extra });

// A setting that turns off certificate checks, so what is downloaded can be changed on the way: reported as plain http is, with
// the setting named.
const certificateChecksOff = (setting) =>
  Object.freeze({ expected: false, kind: "http", address: null, text: `${setting} turns off certificate checks` });

// A certificate authority the repository supplies, so a server it vouches for passes as any host: reported as plain http is, with
// the setting named, and the certificate never shown.
const trustedCertificatesReplaced = (setting) =>
  Object.freeze({ expected: false, kind: "http", address: null, text: `${setting} replaces the trusted certificates` });

// What a registry setting names: the official registry, a mirror (host) or plain http; anything else (a path, a git address, text
// that is no address) is one it cannot read.
function registryVerdict(address) {
  const verdict = address === null ? UNREADABLE : classifySource("npm", address);
  return verdict.expected || verdict.kind === "host" || verdict.kind === "http" ? verdict : UNREADABLE;
}

// A line it cannot read where a registry may be named: it covers every package of a lockfile that records no host, since it is
// reported itself.
const coveringUnreadable = (line) => configEntry(line, UNREADABLE, { covers: [null] });
const unreadableConfig = (line) => configEntry(line, UNREADABLE);

// A setting's entry by its verdict: one it cannot read covers a lockfile, as a line naming a registry would.
const configOrCovering = (line, verdict, extra = {}) => (verdict.unreadable ? coveringUnreadable(line) : configEntry(line, verdict, extra));

// A setting naming the registry for installs, or for one scope's packages when `scope` is given.
function registryEntry(line, verdict, scope = null) {
  return configOrCovering(line, verdict, scope === null ? { covers: [null] } : { covers: [scope], scope });
}

module.exports = {
  certificateChecksOff,
  configEntry,
  configOrCovering,
  coveringUnreadable,
  registryEntry,
  registryVerdict,
  trustedCertificatesReplaced,
  unreadableConfig,
};

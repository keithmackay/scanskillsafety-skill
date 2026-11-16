// ABOUTME: Lists what a target runs when it is installed or starts: npm install scripts, setup.py and Python build backends, MCP
// ABOUTME: server commands, hooks, plugin commands and agents, and scripts a SKILL.md names. Facts, not findings.
"use strict";

const { posix } = require("path");
const { isScriptPath, isConfig } = require("../../lib/scriptFiles");
const { baseName, compare, isVendored, parseJson } = require("./util");

const NPM_HOOKS = ["preinstall", "install", "postinstall", "prepare"];

const folderOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const byFileCommandWhen = (a, b) => compare(a.file, b.file) || compare(a.command, b.command) || compare(a.when, b.when);

function mcpServerEntries(file, json) {
  const servers = json && typeof json.mcpServers === "object" && json.mcpServers ? json.mcpServers : {};
  return Object.entries(servers)
    .filter(([, s]) => s && typeof s.command === "string")
    .map(([name, s]) => ({ file, when: `MCP server ${name} starts`, command: [s.command, ...(Array.isArray(s.args) ? s.args : [])].join(" ") }));
}

function hookEntries(file, json) {
  const events = json && typeof json.hooks === "object" && json.hooks ? json.hooks : {};
  const entries = [];
  for (const [event, groups] of Object.entries(events)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group && group.hooks) ? group.hooks : []) {
        if (hook && typeof hook.command === "string") entries.push({ file, when: `hook ${event}`, command: hook.command });
      }
    }
  }
  return entries;
}

function serverPackageEntries(file, json) {
  const packages = json && Array.isArray(json.packages) ? json.packages : [];
  return packages
    .filter((p) => p && typeof p.identifier === "string")
    .map((p) => ({ file, when: "MCP server starts", command: `${p.registryType ?? p.registry_type ?? "package"} package ${p.identifier}` }));
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A path named as a whole: after the start, a space, a quote, a backtick or "(", with at most a "./" or "${VAR}/" in front, and
// followed by the end, a space, a quote, a backtick, ")" or punctuation. So go.py is not named by ergo.py or tools/go.py.
const namesPath = (text, p) =>
  new RegExp(String.raw`(?:^|[\s"'\x60(])(?:\./|\$\{?\w+\}?/)?${escape(p)}(?=$|[\s"'\x60).,;:!?])`, "m").test(text);

// Scripts the target ships that a SKILL.md names, by their path from the skill's folder or from the root. Naming is not proof the
// agent runs them.
function skillScriptEntries(file, text, scripts) {
  const folder = folderOf(file);
  return scripts
    .filter((p) => namesPath(text, p) || (folder && p.startsWith(`${folder}/`) && namesPath(text, p.slice(folder.length + 1))))
    .map((p) => ({ file, when: "the skill names it", command: p }));
}

// A plugin manifest's hooks and mcpServers are either written in it or name config files by their path from the plugin's folder
// (the one holding .claude-plugin): those files' hooks and servers are listed under their own names.
function pluginManifestEntries(file, json, textByPath) {
  const pluginFolder = folderOf(folderOf(file));
  const named = (value) =>
    (typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v) => typeof v === "string") : [])
      .map((ref) => posix.normalize(posix.join(pluginFolder, ref)))
      .filter((p) => textByPath.has(p));
  return [
    ...hookEntries(file, json),
    ...mcpServerEntries(file, json),
    ...named(json && json.hooks).flatMap((p) => hookEntries(p, parseJson(textByPath.get(p)))),
    ...named(json && json.mcpServers).flatMap((p) => mcpServerEntries(p, parseJson(textByPath.get(p)))),
  ];
}

// The same config can be listed twice: named by a manifest and found by its own name.
function withoutRepeats(entries) {
  const seen = new Set();
  return entries.filter((e) => {
    const key = JSON.stringify([e.file, e.when, e.command]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function installTimeEntries(files) {
  // Configs and manifests are read with the script rules but are not programs a skill runs.
  const scripts = files.map((f) => f.path).filter((p) => isScriptPath(p) && !isConfig(p) && !isVendored(p));
  const textByPath = new Map(files.filter((f) => !isVendored(f.path)).map((f) => [f.path, f.text]));
  const entries = [];
  for (const { path, text } of files) {
    if (isVendored(path)) continue;
    const name = baseName(path);
    if (name === "package.json") {
      const scriptsOf = (parseJson(text) || {}).scripts || {};
      for (const hook of NPM_HOOKS) if (typeof scriptsOf[hook] === "string") entries.push({ file: path, when: `npm ${hook}`, command: scriptsOf[hook] });
    } else if (name === "setup.py") entries.push({ file: path, when: "pip install", command: "setup.py runs as Python code" });
    else if (name === "pyproject.toml") {
      const backend = /^\s*build-backend\s*=\s*["']([^"']+)["']/m.exec(text);
      if (backend) entries.push({ file: path, when: "pip install (build backend)", command: backend[1] });
    } else if (name === ".mcp.json") entries.push(...mcpServerEntries(path, parseJson(text)));
    else if (name === "server.json") entries.push(...serverPackageEntries(path, parseJson(text)));
    else if (path.endsWith(".claude-plugin/plugin.json")) entries.push(...pluginManifestEntries(path, parseJson(text), textByPath));
    else if (/(^|\/)hooks\/hooks\.json$/.test(path)) entries.push(...hookEntries(path, parseJson(text)));
    else if (/(^|\/)(commands|agents)\/[^/]+\.md$/.test(path)) {
      entries.push({ file: path, when: "plugin command or agent, given to the agent when used", command: "(its text)" });
    } else if (name === "SKILL.md") entries.push(...skillScriptEntries(path, text, scripts));
  }
  return withoutRepeats(entries.sort(byFileCommandWhen));
}

module.exports = { installTimeEntries };

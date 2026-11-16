// ABOUTME: Lists what a target runs when it is installed or starts: npm install scripts, setup.py and Python build backends, MCP
// ABOUTME: server commands, hooks, plugin commands and agents, and scripts a SKILL.md tells the agent to run. Facts, not findings.
"use strict";

const { isScriptPath } = require("../../lib/scriptFiles");

const NPM_HOOKS = ["preinstall", "install", "postinstall", "prepare"];
const VENDORED = new Set(["node_modules", "vendor"]);

const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
const folderOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const isVendored = (p) => p.split("/").slice(0, -1).some((s) => VENDORED.has(s));

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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

// Paths in a SKILL.md that name a script the target ships, relative to the skill's folder or the root.
function skillScriptEntries(file, text, scripts) {
  const folder = folderOf(file);
  return scripts
    .filter((p) => {
      const relative = folder && p.startsWith(`${folder}/`) ? p.slice(folder.length + 1) : p;
      return text.includes(relative);
    })
    .map((p) => ({ file, when: "the skill tells the agent to run it", command: p }));
}

function installTimeEntries(files) {
  const scripts = files.map((f) => f.path).filter((p) => isScriptPath(p) && !isVendored(p));
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
    else if (path.endsWith(".claude-plugin/plugin.json")) {
      const json = parseJson(text);
      entries.push(...hookEntries(path, json), ...mcpServerEntries(path, json));
    } else if (/(^|\/)hooks\/hooks\.json$/.test(path)) entries.push(...hookEntries(path, parseJson(text)));
    else if (/(^|\/)(commands|agents)\/[^/]+\.md$/.test(path)) {
      entries.push({ file: path, when: "plugin command or agent, given to the agent when used", command: "(its text)" });
    } else if (name === "SKILL.md") entries.push(...skillScriptEntries(path, text, scripts));
  }
  return entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.command < b.command ? -1 : 1));
}

module.exports = { installTimeEntries };

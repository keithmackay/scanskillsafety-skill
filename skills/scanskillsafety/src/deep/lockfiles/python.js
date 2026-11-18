// ABOUTME: Reads the packages in Python lockfiles: poetry.lock and uv.lock package blocks, and the pinned versions in a
// ABOUTME: requirements file, each with its line.
"use strict";

const { found, linesOf } = require("./shared");

// poetry.lock and uv.lock: each [[package]] block's name and version; a block whose source is editable or virtual is the project.
function readPackageBlocks(text) {
  const out = [];
  let block = null;
  let entries = 0;
  const finish = () => {
    if (block && !block.project) entries++;
    if (block && block.name && block.version && !block.project) out.push({ name: block.name, version: block.version, line: block.line });
    block = null;
  };
  linesOf(text).forEach((line, i) => {
    if (line.startsWith("[")) {
      finish();
      if (line.trim() === "[[package]]") block = { name: null, version: null, line: null, project: false };
      return;
    }
    if (!block) return;
    const name = /^name = "([^"]+)"/.exec(line);
    const version = /^version = "([^"]+)"/.exec(line);
    if (name && !block.name) Object.assign(block, { name: name[1], line: i + 1 });
    if (version && !block.version) block.version = version[1];
    if (/^source = \{ *(editable|virtual) *=/.test(line)) block.project = true;
  });
  finish();
  return found(out, entries);
}

const PINNED_REQUIREMENT = /^([A-Za-z0-9._-]+)(\[[^\]]*\])?==([^\s;#]+)/;

function readRequirements(text) {
  const out = [];
  let entries = 0;
  linesOf(text).forEach((line, i) => {
    if (/^\s*[^\s#-]/.test(line)) entries++;
    const match = PINNED_REQUIREMENT.exec(line);
    if (match) out.push({ name: match[1], version: match[3], line: i + 1 });
  });
  return found(out, entries, "no pinned versions in it");
}

module.exports = { readPackageBlocks, readRequirements };

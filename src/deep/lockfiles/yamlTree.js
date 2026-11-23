// ABOUTME: Reads YAML config files (.yarnrc.yml, pnpm-workspace.yaml) strictly, line by line: the root keys a reader asks for as
// ABOUTME: trees by indentation, with anything YAML would read otherwise (anchors, flow maps, block scalars, tabs) unmodelled.
"use strict";

const { append, fieldOf, leadingSpaces, linesOf, startsWithAny, withoutBom } = require("./shared");
const { coveringUnreadable } = require("./configEntries");

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

// A root key's reader (`(root, folder) → entries`, throwing Unmodelled) and what a problem in it gives (`unreadable(line)`): by
// default a line that covers a lockfile recording no host, as one naming a registry would.
const section = (read, unreadable = coveringUnreadable) => ({ read, unreadable });

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
        append(out, block.handler.read(yamlTree(block.root, block.lines), folder));
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

module.exports = { Unmodelled, collectionChildren, flowScalars, readYamlConfig, scalarFields, scalarText, section };

"use strict";
// ABOUTME: Tests making text from a target safe to print: control, format and line or paragraph separator characters replaced,
// ABOUTME: and text cut to a length by whole characters, marked where a caller asks.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { printable, cut } = require("../src/printable");

test("control, format, line separator and paragraph separator characters are replaced with ?", () => {
  assert.equal(printable("a\u001b[2Jb‮c d e\u0007"), "a?[2Jb?c?d?e?");
  assert.equal(printable("plain text: ok"), "plain text: ok");
});

test("cut keeps at most max characters, by whole characters, and adds the mark only when it cut", () => {
  assert.equal(cut("abcdef", 3), "abc");
  assert.equal(cut("abcdef", 3, "…"), "abc…");
  assert.equal(cut("abc", 3, "…"), "abc");
  assert.equal(cut("😀😀😀", 2, "…"), "😀😀…");
});

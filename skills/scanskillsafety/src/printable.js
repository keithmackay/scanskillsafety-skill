// ABOUTME: Makes text from a target (its file paths, lines quoted from it) safe to print: every control and format character is
// ABOUTME: replaced with "?", so a file name cannot reorder, hide or rewrite the output around it.
"use strict";

const printable = (text) => String(text).replace(/[\p{Cc}\p{Cf}]/gu, "?");

module.exports = { printable };

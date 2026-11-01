// ABOUTME: The notice shown when the scan's limits left some of a target's bundled scripts unread, naming the limits, which
// ABOUTME: are findsafeskills' own so a local scan and the site's read the same amount.
"use strict";

const { MAX_FILES_PER_LISTING, MAX_BYTES_PER_FILE, MAX_BYTES_PER_LISTING } = require("../lib/scriptFiles");

const kb = (bytes) => `${(bytes / 1024).toLocaleString("en-US")} KB`;

function partialScriptsNotice() {
  return `Only part of the bundled scripts was scanned: the scan reads up to ${MAX_FILES_PER_LISTING} files, ${kb(MAX_BYTES_PER_FILE)} of each and ${kb(MAX_BYTES_PER_LISTING)} in all.`;
}

module.exports = { partialScriptsNotice };

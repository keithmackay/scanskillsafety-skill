#!/usr/bin/env bash
# ABOUTME: Rebuilds lib/ from the scanner source committed at HEAD in the sibling findsafeskills
# ABOUTME: repo (not its working tree, which may hold another session's unfinished files).
# ABOUTME: Usage: scripts/build-lib.sh [out-dir]   (default: this repo's lib/)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
upstream="${UPSTREAM:-$here/../findsafeskills}"
out="${1:-$here/lib}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$upstream" archive HEAD src/lib/safety tsconfig.safety-skill.json | tar -x -C "$tmp"
# Resolve types (e.g. @types/node for node:crypto) the same way upstream does.
ln -s "$upstream/node_modules" "$tmp/node_modules"
rm -rf "$out.tmp" && mkdir -p "$out.tmp"
"$upstream/node_modules/.bin/tsc" -p "$tmp/tsconfig.safety-skill.json" --outDir "$out.tmp"
rm -rf "$out" && mv "$out.tmp" "$out"
echo "Built $out from findsafeskills $(git -C "$upstream" rev-parse --short HEAD)"

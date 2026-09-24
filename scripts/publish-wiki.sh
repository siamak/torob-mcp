#!/usr/bin/env bash
# Publish wiki/ → GitHub Wiki (siamak/torob-mcp.wiki).
#
# Bootstrap (once): open https://github.com/siamak/torob-mcp/wiki and create the
# first page (any title). After that, this script can push.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/wiki"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ ! -d "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi

# Prefer SSH; fall back to HTTPS with gh token.
REMOTE="git@github.com:siamak/torob-mcp.wiki.git"
if ! git ls-remote "$REMOTE" &>/dev/null; then
  TOKEN="$(gh auth token)"
  REMOTE="https://x-access-token:${TOKEN}@github.com/siamak/torob-mcp.wiki.git"
  if ! git ls-remote "$REMOTE" &>/dev/null; then
    echo "Wiki repo does not exist yet." >&2
    echo "Open https://github.com/siamak/torob-mcp/wiki , create the first page, then re-run:" >&2
    echo "  pnpm wiki:publish" >&2
    exit 1
  fi
fi

git clone --depth 1 "$REMOTE" "$TMP/wiki"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'README.md' \
  "$SRC/" "$TMP/wiki/"

cd "$TMP/wiki"
git add -A
if git diff --cached --quiet; then
  echo "Wiki already up to date."
  exit 0
fi

git -c user.email="wiki@torob-mcp.local" -c user.name="torob-mcp" \
  commit -m "Sync wiki from repository wiki/"
git push origin HEAD:master
echo "Published → https://github.com/siamak/torob-mcp/wiki"

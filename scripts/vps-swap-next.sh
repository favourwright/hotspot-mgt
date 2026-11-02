#!/usr/bin/env bash
#
# Changes the `next` version on the VPS without running npm in the app directory.
#
# `npm install next@x` there, even with --no-save, reconciles the whole tree against
# the VPS's stale package.json: on a partial tree, a rehearsal added about 800 packages
# and changed firebase-admin. This box has 956MB of RAM. So npm runs in an empty folder, where it can
# only produce next and its own dependencies, and just those are copied across.
# Whatever they replace is kept, so --rollback can put it back.
#
# Run on the box (docs/deploy-runbook.md):
#   ssh ... 'bash -s' -- <next-version> <react-version> < scripts/vps-swap-next.sh
#   ssh ... 'bash -s' -- --rollback < scripts/vps-swap-next.sh
#
set -euo pipefail

APP="${APP:-/home/ubuntu/hotspot-mgt}"
WORK="${WORK:-$HOME/.next-swap}"
MODULES="$APP/node_modules"

version() { node -p "require('$MODULES/next/package.json').version"; }

if [ "${1:-}" = "--rollback" ]; then
  [ -d "$WORK/prev/next" ] || { echo "Nothing to roll back to in $WORK/prev" >&2; exit 1; }
  rsync -a --delete "$WORK/prev/next/" "$MODULES/next/"
  rsync -a --exclude=/next/ "$WORK/prev/" "$MODULES/"
  echo "next is now $(version)"
  exit 0
fi

NEXT_VERSION="${1:?next version required}"
REACT_VERSION="${2:?react version required}"

rm -rf "$WORK"
mkdir -p "$WORK/new" "$WORK/prev"
cd "$WORK/new"
npm init -y >/dev/null
npm install --omit=dev --no-audit --no-fund --no-package-lock \
  "next@$NEXT_VERSION" "react@$REACT_VERSION" "react-dom@$REACT_VERSION" >/dev/null

# Fail here rather than half way through the copy.
installed="$(node -p "require('$WORK/new/node_modules/next/package.json').version")"
[ "$installed" = "$NEXT_VERSION" ] || { echo "Installed $installed, expected $NEXT_VERSION" >&2; exit 1; }

cd "$WORK/new/node_modules"
for pkg in $(ls -d @*/* [!@]*); do
  if [ -e "$MODULES/$pkg" ]; then
    mkdir -p "$WORK/prev/$(dirname "$pkg")"
    cp -a "$MODULES/$pkg" "$WORK/prev/$pkg"
  fi
done

rsync -a --delete "$WORK/new/node_modules/next/" "$MODULES/next/"
rsync -a --exclude=/next/ --exclude=/.package-lock.json "$WORK/new/node_modules/" "$MODULES/"
rm -rf "$WORK/new"
echo "next is now $(version)"

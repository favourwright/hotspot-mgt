#!/usr/bin/env bash
#
# Pushes named server-side variables from the local .env.production to the
# VPS's own .env.local.
#
# Source and destination are deliberately different files. Locally,
# .env.production is where the LIVE values live (its twin,
# .env.development.local, holds the test ones). On the VPS there is only
# .env.local, because that is what `next start` reads there at runtime. So
# this is "push the live value of X to the box", not a file sync.
#
# Neither local file is in git and no deploy step copies either, so a variable
# added locally is simply absent in production until someone puts it there.
# That is a silent failure for server-side vars: the build succeeds, the smoke
# tests pass, and the feature that needed it just does nothing.
#
# Deliberately explicit rather than a blanket sync. Some values legitimately
# differ between local and production, and CLOUDFLARE_API_TOKEN is local-only
# by design, so "copy everything missing" would be wrong. You name what to
# push.
#
# SUPERADMIN_EMAIL and ADMIN_EMAIL used to be listed here as examples of
# values that may differ. They may - but the production value must name an
# account that actually exists in the Firebase project the VPS points at.
# The VPS held one that did not, and once the register route began acting on
# that variable it demoted the real superadmin on every sign-in. See
# docs/decisions-and-gotchas.md.
#
# Usage:
#   npm run env:diff                     # which names and values differ, no changes
#   npm run env:push -- CRON_SECRET      # push one or more by name
#
set -euo pipefail

KEY="${SSH_KEY:-$HOME/.ssh/ssh-key-2026-06-06.key}"
HOST="${VPS_HOST:-ubuntu@193.123.183.184}"
REMOTE="/home/ubuntu/hotspot-mgt/.env.local"
LOCAL=".env.production"

[ -f "$LOCAL" ] || { echo "No $LOCAL here. Run from the repo root; see .env.example." >&2; exit 1; }

names() { cut -d= -f1 "$1" | grep -v '^#' | grep -v '^$' | sort -u; }

if [ "${1:-}" = "--diff" ]; then
  echo "Comparing .env.production against the VPS. Values are never printed."
  echo
  local_names=$(names "$LOCAL")
  vps_names=$(ssh -i "$KEY" "$HOST" "cut -d= -f1 $REMOTE | grep -v '^#' | grep -v '^\$' | sort")
  echo "Only in $LOCAL (may need pushing):"
  comm -23 <(echo "$local_names") <(echo "$vps_names") | sed 's/^/  /' || true
  echo
  echo "Only on the VPS (do not delete without checking):"
  comm -13 <(echo "$local_names") <(echo "$vps_names") | sed 's/^/  /' || true

  # Names matching is not the same as values matching, and the difference
  # has already cost an outage: the VPS held a stale SUPERADMIN_EMAIL naming
  # an address with no account, which silently demoted the real superadmin
  # on every sign-in. Both files had the name, so this diff said nothing.
  #
  # Values are compared as SHA-256 hashes and never printed, so this stays
  # safe to run and to paste. A differing hash is a question, not a verdict:
  # some values are *meant* to differ between a developer box and
  # production. Decide each one, as with the names above.
  echo
  echo "Set in both, with DIFFERENT values (hashes only, never the values):"
  hash_cmd='while IFS= read -r l; do case "$l" in \#*|"") continue;; *=*) n="${l%%=*}"; v="${l#*=}"; printf "%s %s\n" "$n" "$(printf "%s" "$v" | tr -d "\"'"'"'" | sha256sum | cut -c1-16)";; esac; done'
  local_hashes=$(eval "$hash_cmd" < "$LOCAL" | sort -u)
  vps_hashes=$(ssh -i "$KEY" "$HOST" "$hash_cmd < $REMOTE" | sort -u)

  drift=$(join <(echo "$local_hashes") <(echo "$vps_hashes") \
    | awk '$2 != $3 { print "  " $1 }')
  if [ -n "$drift" ]; then
    echo "$drift"
  else
    echo "  (none)"
  fi
  exit 0
fi

[ $# -gt 0 ] || { echo "Name at least one variable, e.g. npm run env:push -- CRON_SECRET" >&2; exit 1; }

# Collect the requested lines first, so nothing is sent if one is missing.
payload=""
for var in "$@"; do
  line=$(grep -m1 "^${var}=" "$LOCAL" || true)
  [ -n "$line" ] || { echo "$var is not set in $LOCAL" >&2; exit 1; }
  value="${line#*=}"
  [ -n "$value" ] || { echo "$var is empty in $LOCAL. Fill it in first." >&2; exit 1; }
  payload="${payload}${line}"$'\n'
  echo "will push: $var (${#value} chars)"
done

echo
read -r -p "Push these to $HOST and restart hotspot-mgt? [y/N] " reply
[ "$reply" = "y" ] || [ "$reply" = "Y" ] || { echo "Cancelled."; exit 0; }

# Timestamped backup before any write. Restoring is then a single cp.
ssh -i "$KEY" "$HOST" "cp $REMOTE $REMOTE.bak-\$(date +%Y%m%d-%H%M%S)"

# Remove any existing definition of each var, then append the new one, so
# pushing twice updates in place instead of leaving two lines where the last
# one silently wins.
for var in "$@"; do
  ssh -i "$KEY" "$HOST" "sed -i '/^${var}=/d' $REMOTE"
done

printf '%s' "$payload" | ssh -i "$KEY" "$HOST" "cat >> $REMOTE"

# Server-side vars are read by `next start` at process start, so a restart is
# enough. A NEXT_PUBLIC_* value would need a full rebuild and redeploy, since
# those are compiled into the client bundle.
ssh -i "$KEY" "$HOST" "sudo systemctl restart hotspot-mgt && sleep 3 && sudo systemctl is-active hotspot-mgt"

echo
echo "Pushed. Verifying the names landed:"
ssh -i "$KEY" "$HOST" "for v in $*; do grep -c \"^\${v}=\" $REMOTE | xargs echo \"\$v:\"; done"

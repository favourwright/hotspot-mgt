#!/usr/bin/env bash
#
# Pushes named server-side variables from the local .env.local to the VPS.
#
# `.env.local` is gitignored and no deploy step copies it, so a variable added
# locally is simply absent in production until someone puts it there. That is
# a silent failure for server-side vars: the build succeeds, the smoke tests
# pass, and the feature that needed it just does nothing.
#
# Deliberately explicit rather than a blanket sync. Some values legitimately
# differ between local and production (SUPERADMIN_EMAIL, ADMIN_EMAIL), and
# CLOUDFLARE_API_TOKEN is local-only by design, so "copy everything missing"
# would be wrong. You name what to push.
#
# Usage:
#   npm run env:diff                     # which names differ, no changes
#   npm run env:push -- CRON_SECRET      # push one or more by name
#
set -euo pipefail

KEY="${SSH_KEY:-$HOME/.ssh/ssh-key-2026-06-06.key}"
HOST="${VPS_HOST:-ubuntu@193.123.183.184}"
REMOTE="/home/ubuntu/hotspot-mgt/.env.local"
LOCAL=".env.local"

[ -f "$LOCAL" ] || { echo "No $LOCAL here. Run from the repo root." >&2; exit 1; }

names() { cut -d= -f1 "$1" | grep -v '^#' | grep -v '^$' | sort; }

if [ "${1:-}" = "--diff" ]; then
  echo "Comparing variable NAMES (never values - those legitimately differ)"
  echo
  local_names=$(names "$LOCAL")
  vps_names=$(ssh -i "$KEY" "$HOST" "cut -d= -f1 $REMOTE | grep -v '^#' | grep -v '^\$' | sort")
  echo "Only on your machine (may need pushing):"
  comm -23 <(echo "$local_names") <(echo "$vps_names") | sed 's/^/  /' || true
  echo
  echo "Only on the VPS (do not delete without checking):"
  comm -13 <(echo "$local_names") <(echo "$vps_names") | sed 's/^/  /' || true
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

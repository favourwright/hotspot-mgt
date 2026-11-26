#!/usr/bin/env bash
#
# The external smoke checks from step 4 of docs/deploy-runbook.md, as one
# script so the deploy workflow, its rollback, and a person at a terminal all
# run the same list.
#
# A deploy is not done until every one of these returns 200. The check-slug
# route is the one that matters most: it reads Firestore through
# firebase-admin, so it is 500 while every static page above it stays 200
# when the server cannot load that package.
#
# Each URL gets a few tries, because `next start` takes a moment after
# `systemctl restart` before it answers.
#
# Usage: bash scripts/deploy-smoke.sh
#
set -uo pipefail

URLS=(
  "https://ogawifi.online/"
  "https://ogawifi.online/onboarding"
  "https://ogawifi.online/auth"
  "https://ogawifi.online/api/auth/check-slug?slug=deploy-check"
  # A tenant subdomain: exercises the wildcard cert and proxy.ts routing.
  "https://superadmin.ogawifi.online/"
)

failed=0
for url in "${URLS[@]}"; do
  code=000
  for attempt in 1 2 3 4 5 6; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" || echo 000)
    [ "$code" = "200" ] && break
    sleep 5
  done
  echo "$code  $url"
  [ "$code" = "200" ] || failed=1
done

if [ "$failed" -ne 0 ]; then
  echo "At least one check is not 200. The deploy is not done." >&2
  exit 1
fi
echo "All smoke checks returned 200."

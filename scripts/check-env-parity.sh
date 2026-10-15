#!/usr/bin/env bash
#
# Checks that .env.development.local (test values) and .env.production (live
# values) define the same variable NAMES, each with a non-empty value.
#
# The two files are deliberately twins: same names, different values, so
# nothing has to be toggled by hand before a deploy. That only holds while
# they actually stay in step. A name present in one and missing from the other
# is the failure this catches, and it is worth catching because of which
# direction it fails in: a blank in .env.production builds cleanly, passes
# every smoke test in the runbook, and the feature that needed it just
# silently does nothing in production.
#
# Values are never printed - only names. Run from the repo root.
#
set -euo pipefail

DEV=".env.development.local"
PROD=".env.production"

for f in "$DEV" "$PROD"; do
  [ -f "$f" ] || { echo "Missing $f. Run from the repo root; see .env.example." >&2; exit 1; }
done

# Names with a non-empty value, ignoring comments and blank lines.
filled() { grep -E '^[A-Z_][A-Z0-9_]*=.+' "$1" | cut -d= -f1 | sort -u; }
# Names present at all, so an empty value reads as "missing" below.
declared() { grep -E '^[A-Z_][A-Z0-9_]*=' "$1" | cut -d= -f1 | sort -u; }

dev_filled=$(filled "$DEV")
prod_filled=$(filled "$PROD")

missing_in_prod=$(comm -23 <(echo "$dev_filled") <(echo "$prod_filled"))
missing_in_dev=$(comm -13 <(echo "$dev_filled") <(echo "$prod_filled"))

status=0

if [ -n "$missing_in_prod" ]; then
  status=1
  echo "Set or unset in $PROD, but filled in $DEV:"
  echo "$missing_in_prod" | sed 's/^/  /'
  echo "  ^ these build clean and fail silently in production. Fill them in."
  echo
fi

if [ -n "$missing_in_dev" ]; then
  status=1
  echo "Set or unset in $DEV, but filled in $PROD:"
  echo "$missing_in_dev" | sed 's/^/  /'
  echo "  ^ local dev will behave differently from production here."
  echo
fi

# A stray .env.local outranks .env.production in a production build and
# .env.development.local is what dev should be reading, so it can only cause
# the exact silent mix-up this split exists to prevent.
if [ -f ".env.local" ]; then
  status=1
  echo "A .env.local exists. It is loaded in EVERY environment and outranks"
  echo "$PROD, so its values would be baked into the production build."
  echo "Move what it holds into $DEV (test) or $PROD (live) and delete it."
  echo
fi

if [ "$status" -eq 0 ]; then
  echo "IN STEP: $(echo "$dev_filled" | wc -l | tr -d ' ') variables, filled in both files."
fi

exit "$status"

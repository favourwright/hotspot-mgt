#!/usr/bin/env bash
#
# Prints "NAME HASH" for every variable in an env file, one per line, sorted.
# Never the value: a 16-character SHA-256 prefix stands in for it, so two
# files can be compared by name and value without either being printed.
#
# Quotes are stripped before hashing, as scripts/push-env.sh does, so
# NAME="x" and NAME=x compare equal.
#
# Runs the same locally and on the VPS, which is the point:
#   bash scripts/env-hashes.sh .env.production
#   ssh ... 'bash -s' -- /home/ubuntu/hotspot-mgt/.env.local < scripts/env-hashes.sh
#
set -euo pipefail
# join(1) on the far side needs the same collation as this sort.
export LC_ALL=C

file="${1:?env file required}"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    \#*|"") continue ;;
    *=*)
      name="${line%%=*}"
      value="${line#*=}"
      hash=$(printf '%s' "$value" | tr -d "\"'" | sha256sum | cut -c1-16)
      printf '%s %s\n' "$name" "$hash"
      ;;
  esac
done < "$file" | sort -u

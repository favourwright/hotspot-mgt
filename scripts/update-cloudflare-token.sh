#!/usr/bin/env bash
#
# Pushes CLOUDFLARE_API_TOKEN to the VPS and verifies certificate renewal
# still works with it.
#
# The token is what certbot uses to answer the DNS-01 challenge for the
# wildcard certificate. It is not read by the application, so an invalid one
# breaks nothing visible -- until the certificate silently fails to renew and
# HTTPS stops on every tenant subdomain at once. The dry-run at the end is
# the whole point of this script: it is the only thing that proves the token
# actually works before the real renewal needs it.
#
# Usage: set CLOUDFLARE_API_TOKEN in .env.production, then `npm run cloudflare:token`.

set -euo pipefail

VPS="${VPS_HOST:-ubuntu@193.123.183.184}"
KEY="${VPS_SSH_KEY:-$HOME/.ssh/ssh-key-2026-06-06.key}"
REMOTE_INI="/root/.secrets/cloudflare.ini"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f .env.production ]; then
  CLOUDFLARE_API_TOKEN="$(grep -E '^CLOUDFLARE_API_TOKEN=' .env.production | head -1 | cut -d= -f2- || true)"
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN is not set (env or .env.production)." >&2
  echo "Create one at Cloudflare → My Profile → API Tokens → Create Token:" >&2
  echo "  Zone:DNS:Edit + Zone:Zone:Read, limited to this project's zone." >&2
  exit 1
fi

echo "==> Checking the token against Cloudflare before touching the VPS"
if ! curl -sf -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
     https://api.cloudflare.com/client/v4/user/tokens/verify \
     | grep -q '"status":"active"'; then
  echo "Cloudflare rejected this token, or it is not active. Nothing was changed." >&2
  exit 1
fi

echo "==> Writing ${REMOTE_INI}"
# Piped over stdin rather than passed as an argument: an argument would be
# visible in the VPS process list while the command runs.
printf 'dns_cloudflare_api_token = %s\n' "${CLOUDFLARE_API_TOKEN}" \
  | ssh -i "${KEY}" "${VPS}" \
      "sudo mkdir -p /root/.secrets && sudo tee ${REMOTE_INI} >/dev/null && sudo chmod 600 ${REMOTE_INI}"

echo "==> Verifying renewal end to end (this takes a minute)"
ssh -i "${KEY}" "${VPS}" "sudo certbot renew --dry-run"

echo "==> Done. Renewal is working with the new token."

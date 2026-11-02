#!/usr/bin/env bash
#
# Read-only look at the VPS, answering what nothing in the repo can. Changes nothing,
# and prints names, modes and counts rather than values: no .env contents, no private
# keys (never `wg show dump` or a full wg0.conf). Commands needing root use `sudo -n`,
# and report it instead of hanging if sudo wants a password.
#
# Run it yourself, because it reads production: bash scripts/audit-vps.sh
#
set -uo pipefail

KEY="${VPS_SSH_KEY:-$HOME/.ssh/ssh-key-2026-06-06.key}"

ssh -i "$KEY" ubuntu@193.123.183.184 'bash -s' <<'REMOTE'
APP=/home/ubuntu/hotspot-mgt
section() { printf '\n--- %s\n' "$1"; }

section "OS and patches"
lsb_release -ds 2>/dev/null; uname -r
ubuntu-distro-info --supported 2>/dev/null | tr '\n' ' '; echo
pro status 2>/dev/null | grep -E 'esm-|^Account|not attached' | head -6
/usr/lib/update-notifier/apt-check --human-readable 2>/dev/null
echo "unattended-upgrades: $(systemctl is-active unattended-upgrades 2>/dev/null)"
[ -f /var/run/reboot-required ] && echo "REBOOT REQUIRED" || echo "no reboot pending"

section "Who can read the app and its secrets"
stat -c '%a %U:%G %n' /home/ubuntu "$APP" "$APP/.env.local" "$APP/.next" 2>&1
getfacl -p "$APP/.env.local" 2>/dev/null | grep -vE '^(#|$)'
echo "processes by user for web servers:"; ps -eo user:20,comm | grep -E 'apache2|httpd|nginx|php' | sort -u
echo "accounts with a login shell:"; getent passwd | awk -F: '$7 !~ /(nologin|false|sync)$/ {print "  "$1, $6, $7}'
for user in www-data apache; do
  id "$user" >/dev/null 2>&1 || continue
  sudo -n -u "$user" test -r "$APP/.env.local" && r=YES || r=no
  sudo -n -u "$user" test -r "$APP/.next/BUILD_ID" && b=YES || b=no
  echo "$user can read .env.local: $r, build: $b"
done

section "Secrets present on the box (name and filled or not, never the value)"
for name in HOOK_SECRETS_KEY ROUTER_SECRETS_KEY SUPERADMIN_EMAIL WG_MANAGER_SECRET CRON_SECRET; do
  if grep -qE "^$name=.+" "$APP/.env.local" 2>/dev/null; then echo "$name filled"; else echo "$name absent or blank"; fi
done

section "Privilege"
sudo -n -l 2>&1 | sed -n '/may run/,$p'
sudo -n ls -l /etc/sudoers.d 2>&1 | tail -n +2
for unit in hotspot-mgt wg-manager; do
  echo "$unit: $(systemctl is-active "$unit" 2>/dev/null) $(systemctl show "$unit" -p User -p NoNewPrivileges -p ProtectSystem -p PrivateTmp --value 2>/dev/null | tr '\n' ' ')"
done
stat -c '%a %U:%G %n' /opt/wg-manager /opt/wg-manager/app.py /opt/wg-manager/config.json 2>&1

section "WireGuard: can tenants reach each other?"
sysctl net.ipv4.ip_forward 2>&1
sudo -n iptables -S FORWARD 2>&1
sudo -n grep -E '^(Address|ListenPort|Table|PostUp|PostDown|SaveConfig)' /etc/wireguard/wg0.conf 2>&1
echo "peers: $(sudo -n wg show wg0 peers 2>/dev/null | wc -l)"
echo "allowed ranges wider than one address: $(sudo -n wg show wg0 allowed-ips 2>/dev/null | awk '{for (i = 2; i <= NF; i++) if ($i !~ /\/32$/) n++} END {print n + 0}')"

section "Listening"
sudo -n ss -tlnp 2>&1 | awk '{print $4, $6}' | sed 's/users:((//; s/,pid=.*//'
sudo -n ss -ulnp 2>&1 | awk '{print $4, $6}' | sed 's/users:((//; s/,pid=.*//'
echo "firewall: $(sudo -n ufw status 2>&1 | head -1)"
sudo -n iptables -S INPUT 2>&1

section "SSH"
sudo -n sshd -T 2>&1 | grep -iE '^(port|permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|x11forwarding|maxauthtries|allowusers) '
echo "authorized keys: $(grep -cE '^(ssh|ecdsa|sk-)' ~/.ssh/authorized_keys 2>/dev/null)"
echo "fail2ban: $(systemctl is-active fail2ban 2>/dev/null)"

section "What is deployed"
echo "BUILD_ID $(cat "$APP/.next/BUILD_ID" 2>/dev/null)"
node -p "'next ' + require('$APP/node_modules/next/package.json').version" 2>&1
echo "source maps in the build: $(find "$APP/.next/server" -name '*.map' 2>/dev/null | wc -l)"
echo "top level of the checkout:"; ls -A "$APP" | tr '\n' ' '; echo
du -sh "$APP" 2>/dev/null

section "CSP reports, last 7 days"
sudo -n journalctl -u hotspot-mgt --since '7 days ago' --no-pager 2>/dev/null | grep -c '\[csp\]'
sudo -n journalctl -u hotspot-mgt --since '7 days ago' --no-pager -o cat 2>/dev/null | grep '\[csp\]' | sort | uniq -c | sort -rn | head -20
REMOTE

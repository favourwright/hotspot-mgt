# WireGuard Manager — VPS Setup

## One-time setup

1. SSH into your VPS:
```bash
ssh ubuntu@193.123.183.184
```

2. Copy the wg-manager files to the VPS:
```bash
scp -r ./vps/wg-manager/* ubuntu@193.123.183.184:~/wg-manager/
```

3. On the VPS, run the setup script:
```bash
cd ~/wg-manager
chmod +x setup.sh
./setup.sh
```

4. Copy the generated WG_MANAGER_SECRET and WG_MANAGER_URL to your Next.js .env.local

5. Update platform config via superadmin with your VPS WireGuard public key:
```bash
sudo wg show wg0 public-key
```

## Checking service status

```bash
sudo systemctl status wg-manager
```

## Viewing logs

```bash
sudo journalctl -u wg-manager -f
```

## Restarting

```bash
sudo systemctl restart wg-manager
```

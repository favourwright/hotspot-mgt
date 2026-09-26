#!/bin/bash
set -e

echo "=== WireGuard Manager Setup ==="

# Install Flask
echo "Installing Flask..."
pip3 install flask

# Create service directory
sudo mkdir -p /opt/wg-manager

# Copy service files
sudo cp app.py /opt/wg-manager/app.py
sudo cp wg-manager.service /etc/systemd/system/

# Generate secret key
SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
echo "Generated secret: $SECRET"
echo ""
echo "Add this to your Next.js .env.local:"
echo "WG_MANAGER_SECRET=$SECRET"
echo "WG_MANAGER_URL=http://localhost:51821"
echo ""

# Create config from template
sed "s/REPLACE_WITH_GENERATED_SECRET/$SECRET/" \
  config.json.template > /opt/wg-manager/config.json
sudo chown ubuntu:ubuntu /opt/wg-manager/config.json

# Add ubuntu user to sudoers for wg commands only
echo "ubuntu ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/sbin/wg-quick, /bin/ping" | \
  sudo tee /etc/sudoers.d/wg-manager

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable wg-manager
sudo systemctl start wg-manager

echo "=== Setup Complete ==="
echo "Service status:"
sudo systemctl status wg-manager --no-pager

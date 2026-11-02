#!/usr/bin/env python3
"""
WireGuard Manager Service
Runs on the VPS at localhost:51821
Manages WireGuard peers for tenant routers
"""
import hmac
import json
import os
import re
import subprocess
import ipaddress
import time
from flask import Flask, request, jsonify
from functools import wraps

app = Flask(__name__)

# Load config
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")

def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)

# A WireGuard public key is 32 bytes of base64. Checked before it reaches a
# command line, even though the argument list means no shell ever parses it.
WG_PUBLIC_KEY = re.compile(r"^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$")

def valid_tunnel_ip(value):
    """A literal IPv4 address, so `ping` can never read one as a flag."""
    try:
        ipaddress.IPv4Address(value)
        return True
    except ValueError:
        return False

# Auth decorator
def require_secret(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        secret = request.headers.get("X-WG-Secret") or ""
        expected = load_config().get("secret") or ""
        # An empty configured secret must not match an absent header.
        if not expected or not hmac.compare_digest(secret, expected):
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated

def run_wg_command(args):
    """Run a wg or ip command with sudo"""
    try:
        result = subprocess.run(
            ["sudo"] + args,
            capture_output=True,
            text=True,
            timeout=10
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip()
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Command timed out"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def get_existing_peers():
    """Get all current WireGuard peers and their IPs"""
    result = run_wg_command(["wg", "show", "wg0", "allowed-ips"])
    if not result["success"]:
        return {}
    
    peers = {}
    for line in result["stdout"].splitlines():
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) >= 2:
            public_key = parts[0]
            allowed_ip = parts[1].split("/")[0]
            peers[public_key] = allowed_ip
    
    return peers

def get_next_available_ip(subnet, reserved):
    """Find next available IP in subnet"""
    network = ipaddress.IPv4Network(subnet)
    existing_peers = get_existing_peers()
    used_ips = set(existing_peers.values())
    
    # Add reserved IPs
    for ip in reserved:
        used_ips.add(ip)
    
    for host in network.hosts():
        ip_str = str(host)
        if ip_str not in used_ips:
            return ip_str
    
    return None

def ping_ip(ip, count=3):
    """Check if an IP responds to ping"""
    result = run_wg_command(["ping", "-c", str(count), "-W", "2", ip])
    return result["success"]

def get_handshake_info(ip):
    """Look up the WireGuard handshake state for whichever peer currently
    has this tunnel IP in its allowed-ips, independent of ping. This lets
    callers tell apart two very different failure modes that both show up
    as "not reachable":
      - no handshake ever: the tunnel itself never formed (wrong public key
        or endpoint pasted, UDP 51820 blocked outbound, interface/peer
        command never run on the router)
      - a handshake exists but ping still fails: the encrypted tunnel is up,
        but the router isn't responding on it - almost always the
        `/ip/address add` or firewall-accept command was missed or mistyped
    Returns (handshake_ever_occurred, handshake_age_seconds | None).
    """
    peers = get_existing_peers()
    public_key = next((pk for pk, peer_ip in peers.items() if peer_ip == ip), None)
    if public_key is None:
        return False, None

    result = run_wg_command(["wg", "show", "wg0", "latest-handshakes"])
    if not result["success"]:
        return False, None

    for line in result["stdout"].splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == public_key:
            timestamp = int(parts[1])
            if timestamp == 0:
                return False, None
            age_seconds = max(0, int(time.time()) - timestamp)
            return True, age_seconds

    return False, None

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"success": True, "status": "ok"})

@app.route("/peers", methods=["GET"])
@require_secret
def list_peers():
    """List all current WireGuard peers"""
    peers = get_existing_peers()
    return jsonify({
        "success": True,
        "data": {
            "peers": peers,
            "count": len(peers)
        }
    })

@app.route("/peer/add", methods=["POST"])
@require_secret
def add_peer():
    """Add a new WireGuard peer for a tenant router.
    Body: { publicKey: string }
    Returns: { assignedIp: string }
    """
    data = request.get_json()
    if not data or not data.get("publicKey"):
        return jsonify({
            "success": False,
            "error": "publicKey is required"
        }), 400
    
    public_key = data["publicKey"].strip()
    if not WG_PUBLIC_KEY.match(public_key):
        return jsonify({"success": False, "error": "Invalid publicKey"}), 400
    
    # Check if peer already exists
    existing = get_existing_peers()
    if public_key in existing:
        return jsonify({
            "success": True,
            "data": {
                "assignedIp": existing[public_key],
                "alreadyExists": True
            }
        })
    
    # Load config for subnet and reserved IPs
    config = load_config()
    subnet = config.get("tunnelSubnet", "10.10.10.0/24")
    reserved = config.get("reservedIps", ["10.10.10.1", "10.10.10.2"])
    
    # Find next available IP
    assigned_ip = get_next_available_ip(subnet, reserved)
    if not assigned_ip:
        return jsonify({
            "success": False,
            "error": "No available IPs in subnet"
        }), 500
    
    # Add peer to WireGuard
    result = run_wg_command([
        "wg", "set", "wg0",
        "peer", public_key,
        "allowed-ips", f"{assigned_ip}/32"
    ])
    
    if not result["success"]:
        return jsonify({
            "success": False,
            "error": f"Failed to add peer: {result.get('stderr', 'Unknown error')}"
        }), 500
    
    # Save config permanently
    save_result = run_wg_command(["wg-quick", "save", "wg0"])
    if not save_result["success"]:
        # Peer added but not saved - log but don't fail
        print(f"Warning: peer added but save failed: {save_result.get('stderr')}")
    
    return jsonify({
        "success": True,
        "data": {
            "assignedIp": assigned_ip,
            "alreadyExists": False
        }
    })

@app.route("/peer/remove", methods=["DELETE"])
@require_secret
def remove_peer():
    """Remove a WireGuard peer.
    Body: { publicKey: string }
    """
    data = request.get_json()
    if not data or not data.get("publicKey"):
        return jsonify({
            "success": False,
            "error": "publicKey is required"
        }), 400
    
    public_key = data["publicKey"].strip()
    if not WG_PUBLIC_KEY.match(public_key):
        return jsonify({"success": False, "error": "Invalid publicKey"}), 400
    
    result = run_wg_command([
        "wg", "set", "wg0",
        "peer", public_key,
        "remove"
    ])
    
    if not result["success"]:
        return jsonify({
            "success": False,
            "error": f"Failed to remove peer: {result.get('stderr')}"
        }), 500
    
    run_wg_command(["wg-quick", "save", "wg0"])
    
    return jsonify({"success": True})

@app.route("/peer/status/<path:ip>", methods=["GET"])
@require_secret
def peer_status(ip):
    """Check if a tunnel IP is reachable via ping, and separately report
    the WireGuard handshake state - see get_handshake_info() for why both
    matter: ping alone can't tell "tunnel never formed" apart from
    "tunnel is up but router isn't responding on it".
    """
    if not valid_tunnel_ip(ip):
        return jsonify({"success": False, "error": "Invalid IP"}), 400
    reachable = ping_ip(ip)
    handshake_ever_occurred, handshake_age_seconds = get_handshake_info(ip)
    return jsonify({
        "success": True,
        "data": {
            "ip": ip,
            "reachable": reachable,
            "handshakeEverOccurred": handshake_ever_occurred,
            "handshakeAgeSeconds": handshake_age_seconds
        }
    })

if __name__ == "__main__":
    config = load_config()
    port = config.get("port", 51821)
    # Bind to localhost only - never expose publicly
    app.run(
        host="127.0.0.1",
        port=port,
        debug=False
    )

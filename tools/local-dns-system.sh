#!/usr/bin/env bash
# tools/local-dns-system.sh — wire tools/local-dns.mjs into the macOS system
# resolver, and un-wire it again.
#
# The dev nameserver runs unprivileged on 127.0.0.1:5354 (port 53 needs root;
# verified EACCES for uid 501). macOS's resolver supports a per-domain config
# in /etc/resolver/<zone> whose `nameserver` line may carry a trailing port, so
# the root-owned file is a five-line stub pointing at that unprivileged server.
# No privileged process runs the DNS itself.
#
# Only sainted-word.test is routed here. Everything else keeps going to the
# network resolvers, so browsing is untouched while the server is down — the
# stub is scoped, not a global nameserver override.
#
# Usage:
#   sudo bash tools/local-dns-system.sh install
#   sudo bash tools/local-dns-system.sh uninstall
#   sudo bash tools/local-dns-system.sh status
#   sudo bash tools/local-dns-system.sh status --allow-nonroot   # no sudo needed
#
# Reversibility: `uninstall` removes the one file it created. Nothing else on
# the machine is modified — not /etc/resolv.conf (macOS owns it), not the
# network configuration.

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/tools/local-dns.config.json"

[ -f "$CONFIG" ] || { echo "missing $CONFIG" >&2; exit 1; }

# Read host/port/zone from the same JSON the server reads, so this script
# cannot drift from it.
eval "$(node -e '
  const c = require(process.argv[1]);
  const q = (s) => "'"'"'" + String(s).replace(/[^\w.:-]/g, "") + "'"'"'";
  console.log(`DNS_HOST=${q(c.host || "127.0.0.1")}`);
  console.log(`DNS_PORT=${q(c.port || 5354)}`);
  console.log(`DNS_ZONE=${q(c.zone)}`);
' "$CONFIG")"

RESOLVER_DIR="/etc/resolver"
RESOLVER_FILE="$RESOLVER_DIR/$DNS_ZONE"

ALLOW_NONROOT=0
[ "${1:-}" = "--allow-nonroot" ] && ALLOW_NONROOT=1

require_root() {
  if [ "$ALLOW_NONROOT" -eq 1 ]; then return; fi
  if [ "$(id -u)" -ne 0 ]; then
    echo "needs root: sudo bash tools/local-dns-system.sh $1" >&2
    exit 1
  fi
}

case "${1:-status}" in
  install)
    require_root install
    mkdir -p "$RESOLVER_DIR"
    # search_order 1 keeps this client first for the zone; the search list
    # makes bare hostnames inside the zone resolve without a domain suffix.
    cat > "$RESOLVER_FILE" <<EOF
# Installed by tools/local-dns-system.sh — remove with
#   sudo bash tools/local-dns-system.sh uninstall
# Zone: $DNS_ZONE (RFC 6761 reserved; served by tools/local-dns.mjs)
nameserver $DNS_HOST.$DNS_PORT
search_order 1
search $DNS_ZONE
EOF
    chmod 644 "$RESOLVER_FILE"
    # mDNSResponder caches resolver config; nudge it to re-read.
    dscacheutil -flushcache 2>/dev/null || true
    if [ -x /usr/bin/killall ]; then
      killall -HUP mDNSResponder 2>/dev/null || true
    fi
    echo "installed $RESOLVER_FILE -> $DNS_HOST:$DNS_PORT"
    echo
    echo "start the server:  node tools/local-dns.mjs"
    echo "then:              curl http://$DNS_ZONE:5174/"
    ;;

  uninstall)
    require_root uninstall
    if [ -f "$RESOLVER_FILE" ]; then
      rm -f "$RESOLVER_FILE"
      # rmdir only if empty — /etc/resolver may hold configs from other tools.
      rmdir "$RESOLVER_DIR" 2>/dev/null || true
      dscacheutil -flushcache 2>/dev/null || true
      killall -HUP mDNSResponder 2>/dev/null || true
      echo "removed $RESOLVER_FILE"
    else
      echo "nothing installed ($RESOLVER_FILE absent)"
    fi
    ;;

  status)
    if [ -f "$RESOLVER_FILE" ]; then
      echo "resolver file: present"
      sed 's/^/  /' "$RESOLVER_FILE"
    else
      echo "resolver file: absent ($RESOLVER_FILE)"
    fi
    if node "$ROOT/tools/local-dns.mjs" --probe "$DNS_ZONE" A >/dev/null 2>&1; then
      echo "server: answering on $DNS_HOST:$DNS_PORT"
    else
      echo "server: NOT answering on $DNS_HOST:$DNS_PORT (node tools/local-dns.mjs)"
    fi
    echo "probe: dig +short @$DNS_HOST -p $DNS_PORT $DNS_ZONE A"
    ;;

  *)
    echo "usage: $0 {install|uninstall|status} [--allow-nonroot]" >&2
    exit 2
    ;;
esac

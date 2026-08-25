#!/usr/bin/env bash
set -e

CONFIG_DIR="${HOME}/.config"
CONFIG_FILE="${CONFIG_DIR}/zebrad.toml"
CACHE_DIR="${HOME}/.cache/zebra"
COOKIE_FILE="${CACHE_DIR}/.cookie"

mkdir -p "$CONFIG_DIR"
mkdir -p "$CACHE_DIR"

command="$1"
shift || true

case "$command" in
  install)
    echo "==> Checking for prebuilt zebrad binary via cargo-binstall..."
    if ! command -v cargo-binstall &> /dev/null; then
      echo "Installing cargo-binstall..."
      cargo install cargo-binstall || true
    fi
    echo "Installing zebrad..."
    cargo binstall --no-confirm zebrad || cargo install --locked zebrad
    echo "==> zebrad installed successfully!"
    zebrad --version
    ;;

  init)
    net="${1:-Mainnet}"
    echo "==> Generating Zebra config for $net..."
    zebrad generate -o "$CONFIG_FILE"
    echo "==> Configuring RPC listener and $net..."
    if [ "$net" = "Testnet" ]; then
      cat << 'TOML' > "$CONFIG_FILE"
[network]
network = "Testnet"
listen_addr = "0.0.0.0:18233"

[consensus]
checkpoint_sync = true

[rpc]
listen_addr = "127.0.0.1:18232"
enable_cookie_auth = true
TOML
      echo "Configured for Testnet (RPC: 18232, P2P: 18233)"
    else
      cat << 'TOML' > "$CONFIG_FILE"
[network]
network = "Mainnet"
listen_addr = "0.0.0.0:8233"

[consensus]
checkpoint_sync = true

[rpc]
listen_addr = "127.0.0.1:8232"
enable_cookie_auth = true
TOML
      echo "Configured for Mainnet (RPC: 8232, P2P: 8233)"
    fi
    ;;

  mainnet)
    echo "==> Starting zebrad on Mainnet (RPC: 127.0.0.1:8232)..."
    cat << 'TOML' > "$CONFIG_FILE"
[network]
network = "Mainnet"
listen_addr = "0.0.0.0:8233"

[consensus]
checkpoint_sync = true

[rpc]
listen_addr = "127.0.0.1:8232"
enable_cookie_auth = true
TOML
    export PATH="${HOME}/.cargo/bin:${PATH}"
    exec zebrad -c "$CONFIG_FILE" start
    ;;

  testnet)
    echo "==> Starting zebrad on Testnet (RPC: 127.0.0.1:18232)..."
    cat << 'TOML' > "$CONFIG_FILE"
[network]
network = "Testnet"
listen_addr = "0.0.0.0:18233"

[consensus]
checkpoint_sync = true

[rpc]
listen_addr = "127.0.0.1:18232"
enable_cookie_auth = true
TOML
    export PATH="${HOME}/.cargo/bin:${PATH}"
    exec zebrad -c "$CONFIG_FILE" start
    ;;

  status)
    echo "==> Zebra Process Status:"
    pgrep -a zebrad || echo "No zebrad process currently running."
    if [ -f "$COOKIE_FILE" ]; then
      echo "Cookie file found at: $COOKIE_FILE"
      echo "Auth user: __cookie__"
    fi
    ;;

  stop)
    echo "==> Gracefully shutting down zebrad..."
    pkill -INT zebrad || echo "No zebrad process found."
    ;;

  *)
    echo "Usage: ./scripts/zebrad.sh {install|init|mainnet|testnet|status|stop}"
    exit 1
    ;;
esac

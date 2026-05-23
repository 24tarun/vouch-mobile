#!/bin/bash
# Swap the app icon between two variants.
# Usage:
#   ./scripts/swap-icon.sh rounded   # use applogoicon1_rounded
#   ./scripts/swap-icon.sh square    # use applogoicon2

set -euo pipefail
ASSETS="$(cd "$(dirname "$0")/../assets" && pwd)"

case "${1:-}" in
  rounded|1)
    cp "$ASSETS/icon-rounded.png" "$ASSETS/icon.png"
    echo "Switched to rounded icon (applogoicon1_rounded)"
    ;;
  square|2)
    cp "$ASSETS/icon-square.png" "$ASSETS/icon.png"
    echo "Switched to square icon (applogoicon2)"
    ;;
  *)
    echo "Usage: $0 {rounded|square}  (aliases: 1, 2)"
    exit 1
    ;;
esac

echo "Run 'npx expo prebuild --clean' to apply."

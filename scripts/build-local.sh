#!/bin/bash
# Run iOS and Android EAS builds locally in parallel.
# Usage:
#   ./scripts/build-local.sh              # production (default)
#   ./scripts/build-local.sh preview      # preview profile

set -euo pipefail

PROFILE="${1:-production}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting local builds (profile: $PROFILE)..."

osascript -e "
  tell application \"Terminal\"
    activate
    do script \"cd '$DIR' && eas build --platform ios --profile $PROFILE --local\"
    do script \"cd '$DIR' && eas build --platform android --profile $PROFILE --local\"
  end tell
"

echo "Opened two Terminal windows — iOS and Android builds running."

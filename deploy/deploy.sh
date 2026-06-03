#!/usr/bin/env bash
# Provider dispatcher. Picks a deploy backend by DEPLOY_PROVIDER and hands off to
# deploy/providers/<provider>.sh. Swapping hosting is "change one variable":
#
#   DEPLOY_PROVIDER=ssh-docker   -> any host with Docker + SSH (default)
#   DEPLOY_PROVIDER=fly          -> Fly.io
#
# To add a provider, drop a new script in deploy/providers/ and document the env
# vars it needs. Each provider reads everything it needs from the environment.
set -euo pipefail

PROVIDER="${DEPLOY_PROVIDER:-ssh-docker}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/providers/${PROVIDER}.sh"

if [[ ! -f "$SCRIPT" ]]; then
  echo "Unknown DEPLOY_PROVIDER='$PROVIDER'. Available:" >&2
  ls "$HERE/providers" | sed 's/\.sh$//' | sed 's/^/  - /' >&2
  exit 1
fi

echo "==> Deploying with provider: $PROVIDER"
exec bash "$SCRIPT"

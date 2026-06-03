#!/usr/bin/env bash
# Deploy to any host that has Docker + Docker Compose, over SSH.
#
# Required env:
#   SSH_HOST                target host (e.g. uint8.me)
#   SSH_USER                ssh user (must be able to run docker)
#   SSH_KEY                 private key contents (PEM)
#   DIRECTUS_SECRET         token-signing secret
#   DIRECTUS_ADMIN_PASSWORD initial admin password
#   WEB_IMAGE               registry ref of the web image to run
# Optional env (with defaults):
#   SSH_PORT=22
#   DEPLOY_DIR=~/directus-node-starter
#   DIRECTUS_VERSION=11  DIRECTUS_PORT=8097  WEB_PORT=8098
#   DIRECTUS_ADMIN_EMAIL=admin@example.com
#   DIRECTUS_PUBLIC_URL=http://<SSH_HOST>:<DIRECTUS_PORT>
#   GHCR_USER / GHCR_TOKEN  -> docker login on the host before pull (for private images)
set -euo pipefail

: "${SSH_HOST:?SSH_HOST required}"
: "${SSH_USER:?SSH_USER required}"
: "${SSH_KEY:?SSH_KEY required}"
: "${DIRECTUS_SECRET:?DIRECTUS_SECRET required}"
: "${DIRECTUS_ADMIN_PASSWORD:?DIRECTUS_ADMIN_PASSWORD required}"
: "${WEB_IMAGE:?WEB_IMAGE required}"

SSH_PORT="${SSH_PORT:-22}"
DEPLOY_DIR="${DEPLOY_DIR:-directus-node-starter}"
DIRECTUS_VERSION="${DIRECTUS_VERSION:-11}"
DIRECTUS_PORT="${DIRECTUS_PORT:-8097}"
WEB_PORT="${WEB_PORT:-8098}"
DIRECTUS_ADMIN_EMAIL="${DIRECTUS_ADMIN_EMAIL:-admin@example.com}"
DIRECTUS_PUBLIC_URL="${DIRECTUS_PUBLIC_URL:-http://${SSH_HOST}:${DIRECTUS_PORT}}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# --- ssh plumbing -------------------------------------------------------------
KEYFILE="$(mktemp)"; chmod 600 "$KEYFILE"
printf '%s\n' "$SSH_KEY" > "$KEYFILE"
KNOWN="$(mktemp)"
cleanup() { rm -f "$KEYFILE" "$KNOWN" "$ENVFILE" 2>/dev/null || true; }
trap cleanup EXIT

SSH_OPTS=(-i "$KEYFILE" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KNOWN")
remote() { ssh -p "$SSH_PORT" "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "$@"; }

# --- render the host .env -----------------------------------------------------
ENVFILE="$(mktemp)"
cat > "$ENVFILE" <<EOF
DIRECTUS_VERSION=${DIRECTUS_VERSION}
DIRECTUS_PORT=${DIRECTUS_PORT}
WEB_PORT=${WEB_PORT}
WEB_IMAGE=${WEB_IMAGE}
DIRECTUS_SECRET=${DIRECTUS_SECRET}
DIRECTUS_ADMIN_EMAIL=${DIRECTUS_ADMIN_EMAIL}
DIRECTUS_ADMIN_PASSWORD=${DIRECTUS_ADMIN_PASSWORD}
DIRECTUS_PUBLIC_URL=${DIRECTUS_PUBLIC_URL}
EOF

echo "==> Target: $SSH_USER@$SSH_HOST:$SSH_PORT  dir=$DEPLOY_DIR"
remote "mkdir -p '$DEPLOY_DIR'"

echo "==> Copying compose file + env"
scp -P "$SSH_PORT" "${SSH_OPTS[@]}" \
  "$HERE/docker-compose.deploy.yml" "$SSH_USER@$SSH_HOST:$DEPLOY_DIR/docker-compose.yml"
scp -P "$SSH_PORT" "${SSH_OPTS[@]}" \
  "$ENVFILE" "$SSH_USER@$SSH_HOST:$DEPLOY_DIR/.env"

# Optional registry login on the host (needed only for private images).
if [[ -n "${GHCR_TOKEN:-}" && -n "${GHCR_USER:-}" ]]; then
  echo "==> docker login ghcr.io on host"
  remote "echo '$GHCR_TOKEN' | docker login ghcr.io -u '$GHCR_USER' --password-stdin"
fi

echo "==> Pull + up"
remote "cd '$DEPLOY_DIR' && docker compose pull && docker compose up -d --remove-orphans && docker image prune -f"

echo "==> Deployed. web=http://$SSH_HOST:$WEB_PORT  directus=http://$SSH_HOST:$DIRECTUS_PORT/admin"

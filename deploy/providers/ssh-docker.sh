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
#   DIRECTUS_VERSION=11
#   DIRECTUS_ADMIN_EMAIL=admin@example.com
#   DIRECTUS_PUBLIC_URL     public URL of Directus (e.g. https://cms.example.com)
#   GHCR_USER / GHCR_TOKEN  -> docker login on the host before pull (for private images)
#
# Reverse proxy:
#   STACK_CADDY=true        also deploy a Caddy on 80/443 (vhost + auto-HTTPS) for
#                           a FRESH host. Requires APP_DOMAIN + CMS_DOMAIN.
#     APP_DOMAIN, CMS_DOMAIN, ACME_EMAIL, HTTP_PORT=80, HTTPS_PORT=443
#   STACK_CADDY unset/false the host already has a reverse proxy; this deploys the
#                           web/directus containers with no published ports and
#                           you point your existing proxy at them over the
#                           directus-node-starter_default network.
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
DIRECTUS_ADMIN_EMAIL="${DIRECTUS_ADMIN_EMAIL:-admin@example.com}"
DIRECTUS_PUBLIC_URL="${DIRECTUS_PUBLIC_URL:-http://${SSH_HOST}}"
STACK_CADDY="${STACK_CADDY:-false}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# --- ssh plumbing -------------------------------------------------------------
KEYFILE="$(mktemp)"; chmod 600 "$KEYFILE"
printf '%s\n' "$SSH_KEY" > "$KEYFILE"
KNOWN="$(mktemp)"
ENVFILE="$(mktemp)"
cleanup() { rm -f "$KEYFILE" "$KNOWN" "$ENVFILE" 2>/dev/null || true; }
trap cleanup EXIT

SSH_OPTS=(-i "$KEYFILE" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KNOWN")
remote() { ssh -p "$SSH_PORT" "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "$@"; }
copy()   { scp -P "$SSH_PORT" "${SSH_OPTS[@]}" "$1" "$SSH_USER@$SSH_HOST:$2"; }

# --- render the host .env -----------------------------------------------------
cat > "$ENVFILE" <<EOF
DIRECTUS_VERSION=${DIRECTUS_VERSION}
WEB_IMAGE=${WEB_IMAGE}
DIRECTUS_SECRET=${DIRECTUS_SECRET}
DIRECTUS_ADMIN_EMAIL=${DIRECTUS_ADMIN_EMAIL}
DIRECTUS_ADMIN_PASSWORD=${DIRECTUS_ADMIN_PASSWORD}
DIRECTUS_PUBLIC_URL=${DIRECTUS_PUBLIC_URL}
EOF

# Compose invocation differs by proxy mode.
COMPOSE="docker compose"
if [[ "$STACK_CADDY" == "true" ]]; then
  : "${APP_DOMAIN:?APP_DOMAIN required when STACK_CADDY=true}"
  : "${CMS_DOMAIN:?CMS_DOMAIN required when STACK_CADDY=true}"
  cat >> "$ENVFILE" <<EOF
APP_DOMAIN=${APP_DOMAIN}
CMS_DOMAIN=${CMS_DOMAIN}
ACME_EMAIL=${ACME_EMAIL:-}
HTTP_PORT=${HTTP_PORT:-80}
HTTPS_PORT=${HTTPS_PORT:-443}
EOF
  COMPOSE="docker compose -f docker-compose.yml -f docker-compose.caddy.yml"
fi

echo "==> Target: $SSH_USER@$SSH_HOST:$SSH_PORT  dir=$DEPLOY_DIR  stack_caddy=$STACK_CADDY"
remote "mkdir -p '$DEPLOY_DIR'"

echo "==> Copying compose file(s) + env"
copy "$HERE/docker-compose.deploy.yml" "$DEPLOY_DIR/docker-compose.yml"
copy "$ENVFILE" "$DEPLOY_DIR/.env"
if [[ "$STACK_CADDY" == "true" ]]; then
  copy "$HERE/docker-compose.caddy.yml" "$DEPLOY_DIR/docker-compose.caddy.yml"
  copy "$HERE/Caddyfile" "$DEPLOY_DIR/Caddyfile"
fi

# Optional registry login on the host (needed only for private images).
if [[ -n "${GHCR_TOKEN:-}" && -n "${GHCR_USER:-}" ]]; then
  echo "==> docker login ghcr.io on host"
  remote "echo '$GHCR_TOKEN' | docker login ghcr.io -u '$GHCR_USER' --password-stdin"
fi

echo "==> Pull + up"
# Pull is best-effort (registries blip — e.g. Docker Hub timeouts). Retry a few
# times, then bring the stack up regardless: `up -d` re-pulls anything missing,
# and already-pulled images (the freshly-published web tag) are used as-is.
remote "cd '$DEPLOY_DIR' && \
  for n in 1 2 3; do $COMPOSE pull && break || { echo \"pull attempt \$n failed, retrying\"; sleep 5; }; done; \
  $COMPOSE up -d --remove-orphans && docker image prune -f"

if [[ "$STACK_CADDY" == "true" ]]; then
  echo "==> Deployed. frontend=https://${APP_DOMAIN}  directus=https://${CMS_DOMAIN}/admin"
else
  echo "==> Deployed (no published ports). Point your reverse proxy at the"
  echo "    web (:8080) and directus (:8055) containers on directus-node-starter_default."
fi

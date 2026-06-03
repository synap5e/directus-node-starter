#!/usr/bin/env bash
# Deploy to Fly.io. This is the second reference provider showing the dispatcher
# is host-agnostic: same workflow, different DEPLOY_PROVIDER.
#
# Fly runs each service as its own app (no docker-compose). You deploy two apps:
# Directus (with a volume + sqlite, or swap to Fly Postgres) and the web backend.
#
# Required env:
#   FLY_API_TOKEN          Fly auth token (set as a GitHub secret)
#   FLY_WEB_APP            web app name        (e.g. dns-web-staging)
#   FLY_DIRECTUS_APP       directus app name   (e.g. dns-directus-staging)
#   WEB_IMAGE              registry ref of the web image to deploy
# Optional:
#   FLY_REGION=iad
#   DIRECTUS_PUBLIC_URL    https://<FLY_DIRECTUS_APP>.fly.dev
#
# First-time setup (run once, locally):
#   flyctl apps create "$FLY_DIRECTUS_APP"
#   flyctl apps create "$FLY_WEB_APP"
#   flyctl volumes create directus_data -a "$FLY_DIRECTUS_APP" --size 5 -r "$FLY_REGION"
#   flyctl secrets set -a "$FLY_DIRECTUS_APP" SECRET=... ADMIN_EMAIL=... ADMIN_PASSWORD=...
# Then CI runs the deploy below on every push.
set -euo pipefail

: "${FLY_API_TOKEN:?FLY_API_TOKEN required}"
: "${FLY_WEB_APP:?FLY_WEB_APP required}"
: "${FLY_DIRECTUS_APP:?FLY_DIRECTUS_APP required}"
: "${WEB_IMAGE:?WEB_IMAGE required}"

FLY_REGION="${FLY_REGION:-iad}"
DIRECTUS_VERSION="${DIRECTUS_VERSION:-11}"
DIRECTUS_PUBLIC_URL="${DIRECTUS_PUBLIC_URL:-https://${FLY_DIRECTUS_APP}.fly.dev}"
export FLY_API_TOKEN

if ! command -v flyctl >/dev/null 2>&1; then
  echo "Installing flyctl..."
  curl -L https://fly.io/install.sh | sh
  export PATH="$HOME/.fly/bin:$PATH"
fi

echo "==> Deploy Directus app: $FLY_DIRECTUS_APP"
flyctl deploy -a "$FLY_DIRECTUS_APP" \
  --image "directus/directus:${DIRECTUS_VERSION}" \
  --region "$FLY_REGION" \
  --ha=false \
  --detach

echo "==> Deploy web app: $FLY_WEB_APP"
flyctl deploy -a "$FLY_WEB_APP" \
  --image "$WEB_IMAGE" \
  --region "$FLY_REGION" \
  --env "DIRECTUS_URL=https://${FLY_DIRECTUS_APP}.fly.dev" \
  --env "DIRECTUS_PUBLIC_URL=${DIRECTUS_PUBLIC_URL}" \
  --ha=false \
  --detach

echo "==> Deployed. web=https://${FLY_WEB_APP}.fly.dev  directus=${DIRECTUS_PUBLIC_URL}/admin"

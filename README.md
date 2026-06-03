# directus-node-starter

A small, complete, **deployable** template:

> A custom frontend served by a **Node.js backend**, backed by a **Directus**
> headless CMS, shipped as two containers, with **provider-swappable CI/CD** and a
> staging environment.

The example frontend is a painting gallery (Alpine.js), but the interesting part
is the shape: a Node backend you own sitting in front of Directus, and a deploy
pipeline that targets a plain Docker host today and Fly.io (or anything else)
tomorrow by changing one variable.

```
                     ┌─────────────────────────── host ───────────────────────────┐
  Browser ──:8098──> │  web (Node/Express)                directus (CMS)            │
                     │   • serves the frontend            • admin UI + REST/GraphQL │
                     │   • proxies /cms/* ──────────────> • SQLite + local files    │
                     │   • /healthz, /app-config.js          (public on :8097)      │
  Browser ──:8097──> │ ───────────────────────────────────^ (admin, direct)        │
                     └─────────────────────────────────────────────────────────────┘
```

- **web** (`./web`): Express app. Serves the static frontend from `web/public`,
  proxies `/cms/*` to Directus (same-origin, no CORS), exposes `/healthz`, and
  injects runtime config at `/app-config.js`. This is the seam to grow real
  backend logic (auth, entitlements, signed media) for gated content.
- **directus**: official image, public-facing. The initial admin is created from
  env (`DIRECTUS_ADMIN_EMAIL` / `DIRECTUS_ADMIN_PASSWORD`) on first boot. Public
  read permissions are the trust boundary for public content.

## Run it locally

```bash
cp .env.example .env
# edit .env: set DIRECTUS_SECRET (openssl rand -hex 32) and DIRECTUS_ADMIN_PASSWORD
docker compose up --build
```

- Frontend: <http://localhost:8098>
- Directus admin: <http://localhost:8097/admin>

A bare Directus has no `Artworks` collection yet, so the gallery loads empty.
Create the content model in the admin (Settings → Data Model → create collection
`Artworks` with fields `title`, `image`, `description`, `sold`, `portrait`,
`sort`, `published`), then grant the **Public** policy read on `Artworks` and
`directus_files`. The frontend expects `GET /cms/items/Artworks` and images at
`/cms/assets/{id}?key=thumbnail-500`.

## Deploy (CI/CD)

`.github/workflows/ci-cd.yml`:

1. **build** — builds `web/` and pushes `ghcr.io/<owner>/<repo>/web` (tags:
   `sha`, `staging`, `latest`) on every push to `main`.
2. **deploy** — runs `./deploy/deploy.sh` against the GitHub **`staging`**
   environment. Pushes to `main` deploy automatically; `workflow_dispatch` lets
   you deploy on demand.

### Swapping the hosting provider

`deploy/deploy.sh` dispatches on the `DEPLOY_PROVIDER` repository variable:

| `DEPLOY_PROVIDER` | Script | Target |
|---|---|---|
| `ssh-docker` (default) | `deploy/providers/ssh-docker.sh` | any host with Docker + SSH |
| `fly` | `deploy/providers/fly.sh` | Fly.io |

To change hosting, set the `DEPLOY_PROVIDER` variable and that provider's
env/secrets (below). To add a host type, drop `deploy/providers/<name>.sh` and
list its required env at the top of the file.

### Configuration (GitHub → Settings → Environments → `staging`)

Stored as **variables** (non-secret) and **secrets**:

**Variables**

| Name | Example | Used by |
|---|---|---|
| `DEPLOY_PROVIDER` | `ssh-docker` | dispatcher |
| `SSH_HOST` | `uint8.me` | ssh-docker |
| `SSH_USER` | `simon` | ssh-docker |
| `SSH_PORT` | `22` | ssh-docker |
| `DEPLOY_DIR` | `directus-node-starter` | ssh-docker |
| `DIRECTUS_PORT` | `8097` | both |
| `WEB_PORT` | `8098` | both |
| `DIRECTUS_PUBLIC_URL` | `http://uint8.me:8097` | both |
| `DIRECTUS_ADMIN_EMAIL` | `admin@example.com` | both |
| `DIRECTUS_VERSION` | `11` | both |
| `FLY_WEB_APP` / `FLY_DIRECTUS_APP` / `FLY_REGION` | — | fly |

**Secrets**

| Name | Used by |
|---|---|
| `SSH_KEY` (private key) | ssh-docker |
| `DIRECTUS_SECRET` | both |
| `DIRECTUS_ADMIN_PASSWORD` | both |
| `FLY_API_TOKEN` | fly |

`GITHUB_TOKEN` is provided automatically and is used so the target host can
`docker login ghcr.io` and pull the image (works for private packages too).

### Manual deploy from your machine

The same script works locally — export the env and run it:

```bash
export DEPLOY_PROVIDER=ssh-docker SSH_HOST=uint8.me SSH_USER=simon \
       SSH_KEY="$(cat ~/.ssh/your_deploy_key)" \
       WEB_IMAGE=ghcr.io/<owner>/directus-node-starter/web:staging \
       DIRECTUS_SECRET=... DIRECTUS_ADMIN_PASSWORD=... \
       DIRECTUS_PUBLIC_URL=http://uint8.me:8097 DIRECTUS_PORT=8097 WEB_PORT=8098
./deploy/deploy.sh
```

## Layout

```
web/                     Node backend + frontend (public/)
  server.js              express: static + /cms proxy + /healthz + /app-config.js
  public/index.html      the gallery frontend
docker-compose.yml       local stack (builds web)
docker-compose.deploy.yml stack used on the host (pulls web image)
deploy/
  deploy.sh              provider dispatcher (DEPLOY_PROVIDER)
  providers/ssh-docker.sh
  providers/fly.sh
.github/workflows/ci-cd.yml
```

## Notes

- **Secrets**: `DIRECTUS_SECRET` must stay stable across restarts or all
  sessions/tokens are invalidated. Set a real `DIRECTUS_ADMIN_PASSWORD`; the
  Directus demo default is not safe for a public instance.
- **Persistence**: Directus state lives in named volumes
  (`directus-database`, `directus-uploads`, `directus-extensions`). Back these up.
- **Scaling out**: swap `DB_CLIENT`/storage env to Postgres + S3 when SQLite +
  local files isn't enough.

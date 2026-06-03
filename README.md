# directus-node-starter

A small, complete, **deployable** template:

> A custom frontend served by a **Node.js backend**, backed by a **Directus**
> headless CMS, shipped as two containers, with **provider-swappable CI/CD** and a
> staging environment.

The example frontend is a generic **articles** demo (Alpine.js) — a list of
articles and a reader view — but the interesting part is the shape: a Node
backend you own sitting in front of Directus, and a deploy pipeline that targets
a plain Docker host today and Fly.io (or anything else) tomorrow by changing one
variable. Swap the `Articles` collection for your own content model and you have
your own site.

```
                     ┌─────────────────────────── host ───────────────────────────┐
  Browser ───:80───> │  web (Node/Express)                directus (CMS)            │
                     │   • serves the frontend            • admin UI + REST/GraphQL │
                     │   • proxies /cms/* ──────────────> • SQLite + local files    │
                     │   • /healthz, /app-config.js          (public on :8055)      │
  Browser ──:8055──> │ ───────────────────────────────────^ (admin, direct)        │
                     └─────────────────────────────────────────────────────────────┘
```

Ports are env-configurable. On a fresh host the frontend defaults to **80** and
Directus to **8055**. (Override them only where those ports are taken — the live
`uint8.me` staging uses `8098`/`8097` because something else already owns 80.)

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

- Frontend: <http://localhost:8080>
- Directus admin: <http://localhost:8055/admin>

A bare Directus has no `Articles` collection yet, so the frontend shows an empty
state. Seed the demo content (creates the `Articles` collection, grants the
**Public** policy read on published items, and inserts a few sample articles):

```bash
DIRECTUS_URL=http://localhost:8055 \
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD="$(grep DIRECTUS_ADMIN_PASSWORD .env | cut -d= -f2)" \
node scripts/seed-directus.mjs
```

The script is idempotent — re-running it skips anything that already exists.

### The content model

The frontend reads `GET /cms/items/Articles` (newest first) and renders a card
grid + a reader view. The `Articles` collection (created by the seed) has:

| Field | Type | Purpose |
|---|---|---|
| `title` | string (required) | headline |
| `summary` | text | card blurb |
| `body` | rich-text HTML | article content (rendered in the reader) |
| `author` | string | byline |
| `published_date` | timestamp | sort + display |
| `status` | string (`published`/`draft`/`archived`) | **Public read is filtered to `published`** |
| `slug`, `sort` | string / integer | URL hint, manual ordering |

The collection name is configurable via the `CMS_COLLECTION` env var on the web
container (default `Articles`); the frontend picks it up from `/app-config.js`.

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

Any Docker + SSH host works with the default `ssh-docker` provider unchanged —
including an AWS EC2 instance. See
[docs/deploy-aws-free-tier.md](docs/deploy-aws-free-tier.md) for a step-by-step
free-tier walkthrough (launch EC2, install Docker + swap, repoint the `staging`
environment).

### TLS / CDN with Cloudflare (free)

To put a hostname + free TLS in front: with the frontend on port 80 you can
orange-cloud it directly, but the cleanest free path is **Cloudflare Tunnel** —
no open inbound ports, and it also covers the Directus admin (on :8055, which
Cloudflare's proxy can't serve directly). See
[docs/cloudflare.md](docs/cloudflare.md). An optional `cloudflared` overlay is
provided in `docker-compose.cloudflared.yml`.

### Configuration (GitHub → Settings → Environments → `staging`)

Stored as **variables** (non-secret) and **secrets**:

**Variables** (port columns show fresh-host defaults; the live `uint8.me` staging
overrides `WEB_PORT=8098` / `DIRECTUS_PORT=8097` because 80 is already taken there)

| Name | Example | Used by |
|---|---|---|
| `DEPLOY_PROVIDER` | `ssh-docker` | dispatcher |
| `SSH_HOST` | `uint8.me` | ssh-docker |
| `SSH_USER` | `simon` | ssh-docker |
| `SSH_PORT` | `22` | ssh-docker |
| `DEPLOY_DIR` | `directus-node-starter` | ssh-docker |
| `DIRECTUS_PORT` | `8055` (fresh host) | both |
| `WEB_PORT` | `80` (fresh host) | both |
| `DIRECTUS_PUBLIC_URL` | `http://your-host:8055` | both |
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
export DEPLOY_PROVIDER=ssh-docker SSH_HOST=your-host SSH_USER=ubuntu \
       SSH_KEY="$(cat ~/.ssh/your_deploy_key)" \
       WEB_IMAGE=ghcr.io/<owner>/directus-node-starter/web:staging \
       DIRECTUS_SECRET=... DIRECTUS_ADMIN_PASSWORD=... \
       DIRECTUS_PUBLIC_URL=http://your-host:8055
       # ports default to 80 (frontend) / 8055 (directus); set WEB_PORT/DIRECTUS_PORT to override
./deploy/deploy.sh
```

## Layout

```
web/                     Node backend + frontend (public/)
  server.js              express: static + /cms proxy + /healthz + /app-config.js
  public/index.html      the articles frontend (list + reader)
scripts/seed-directus.mjs  idempotent: creates Articles collection + perms + samples
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
  All content (the `Articles` collection, permissions, sample data) lives there —
  if you remove the volumes you start from a bare Directus again, so re-run
  `node scripts/seed-directus.mjs` to recreate the collection + permissions and
  repopulate the demo articles.
- **Scaling out**: swap `DB_CLIENT`/storage env to Postgres + S3 when SQLite +
  local files isn't enough.

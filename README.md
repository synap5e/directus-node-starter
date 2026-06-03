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
                       ┌───────────────────────── host ─────────────────────────┐
                       │                                                         │
  https://APP_DOMAIN ─►│ caddy ─► web (Node/Express)        directus (CMS)       │
  https://CMS_DOMAIN ─►│ :80/:443  • serves the frontend    • admin UI + API     │
        (auto-HTTPS,   │  └──────► • proxies /cms/* ──────► • SQLite + files     │
         vhost by Host)│  └─────────────────────────────►^ (admin, CMS_DOMAIN)  │
                       └─────────────────────────────────────────────────────────┘
```

A single **Caddy** is the entry point: it terminates TLS (automatic HTTPS) and
routes by hostname — `APP_DOMAIN` → the frontend, `CMS_DOMAIN` → Directus. The
app containers publish **no** host ports; no port juggling. Two ways to get a
proxy in front (see [Deploy](#deploy-cicd)):

- **Fresh host** → the stack's own Caddy (`docker-compose.caddy.yml`), on 80/443.
- **Host that already runs a proxy** (e.g. `uint8.me`'s Caddy) → point it at the
  `web` / `directus` containers; don't run a second proxy.

- **web** (`./web`): Express app. Serves the static frontend from `web/public`,
  proxies `/cms/*` to Directus (same-origin, no CORS), exposes `/healthz`, and
  injects runtime config at `/app-config.js`. This is the seam to grow real
  backend logic (auth, entitlements, signed media) for gated content.
- **directus**: official image, reached via `CMS_DOMAIN` through the proxy. The
  initial admin is created from env (`DIRECTUS_ADMIN_EMAIL` /
  `DIRECTUS_ADMIN_PASSWORD`) on first boot. Public read permissions are the trust
  boundary for public content.
- **caddy** (deploy only): single TLS entry + vhost router. Local dev skips it and
  just publishes ports 8080/8055.

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
free-tier walkthrough.

### Reverse proxy: two modes

The deploy base (`docker-compose.deploy.yml`) runs `web` + `directus` with **no
published ports** — something must sit in front and route by hostname.

1. **Fresh host — let the stack run Caddy.** Set `STACK_CADDY=true` plus
   `APP_DOMAIN` / `CMS_DOMAIN` (and DNS for both → the host, ports 80/443 open).
   The provider also deploys `docker-compose.caddy.yml`, and Caddy gets automatic
   HTTPS for both hostnames. Done.

2. **Host already has a proxy — point it at the containers.** Leave
   `STACK_CADDY` unset and set `PROXY_NETWORK` to the network your proxy is on.
   Deploy attaches `web` (:8080) / `directus` (:8055) to that external network
   (via `docker-compose.proxy-net.yml`) with no public ports; add two vhosts to
   your existing proxy. This is how `uint8.me` runs — its Caddy is on the shared
   `internal` network and proxies `articles.uint8.me` → `web:8080`,
   `cms.uint8.me` → `directus:8055`. Example Caddy blocks are in
   [docs/reverse-proxy.md](docs/reverse-proxy.md).

For free TLS via Cloudflare (orange-cloud or Tunnel) instead of/around Caddy, see
[docs/cloudflare.md](docs/cloudflare.md).

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
| `STACK_CADDY` | `true` (fresh host) / unset (existing proxy) | ssh-docker |
| `APP_DOMAIN` | `articles.example.com` | caddy mode |
| `CMS_DOMAIN` | `cms.example.com` | caddy mode |
| `ACME_EMAIL` | `you@example.com` | caddy mode (optional) |
| `DIRECTUS_PUBLIC_URL` | `https://cms.example.com` | both |
| `DIRECTUS_ADMIN_EMAIL` | `admin@example.com` | both |
| `DIRECTUS_VERSION` | `11` | both |
| `SMOKE_URL` | `https://articles.example.com/healthz` | post-deploy check |
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
# Fresh host with the stack's own Caddy (vhost + auto-HTTPS):
export DEPLOY_PROVIDER=ssh-docker SSH_HOST=your-host SSH_USER=ubuntu \
       SSH_KEY="$(cat ~/.ssh/your_deploy_key)" \
       WEB_IMAGE=ghcr.io/<owner>/directus-node-starter/web:staging \
       DIRECTUS_SECRET=... DIRECTUS_ADMIN_PASSWORD=... \
       STACK_CADDY=true APP_DOMAIN=articles.example.com CMS_DOMAIN=cms.example.com \
       DIRECTUS_PUBLIC_URL=https://cms.example.com
./deploy/deploy.sh
# (omit STACK_CADDY/APP_DOMAIN/CMS_DOMAIN to deploy behind a proxy you already run)
```

## Layout

```
web/                     Node backend + frontend (public/)
  server.js              express: static + /cms proxy + /healthz + /app-config.js
  public/index.html      the articles frontend (list + reader)
scripts/seed-directus.mjs  idempotent: creates Articles collection + perms + samples
docker-compose.yml       local stack (builds web, publishes 8080/8055)
docker-compose.deploy.yml deploy base (pulls web image, no published ports)
docker-compose.caddy.yml  fresh-host overlay: adds Caddy (vhost + auto-HTTPS)
docker-compose.proxy-net.yml existing-proxy overlay: join PROXY_NETWORK (durable)
Caddyfile                 vhost routes for the stack Caddy (APP_DOMAIN/CMS_DOMAIN)
deploy/
  deploy.sh              provider dispatcher (DEPLOY_PROVIDER)
  providers/ssh-docker.sh   STACK_CADDY toggles the Caddy overlay
  providers/fly.sh
docs/reverse-proxy.md    the two proxy modes + existing-Caddy integration
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

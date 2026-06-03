# Reverse proxy & vhosts

The deploy base (`docker-compose.deploy.yml`) runs `web` and `directus` with **no
published host ports**. A reverse proxy sits in front and routes by hostname:

- `APP_DOMAIN` → `web:8080` — the frontend (its `/cms/*` calls are proxied on to
  Directus internally by the Node backend, so reading content is same-origin)
- `CMS_DOMAIN` → `directus:8055` — the Directus admin + API

This replaces the old "publish odd host ports" approach. Pick one of two modes.

## Mode 1 — fresh host: let the stack run Caddy

Use the Caddy overlay. It puts a Caddy on 80/443 with **automatic HTTPS** and the
vhost routing from the repo `Caddyfile`.

Requirements:
- DNS `A`/`AAAA` records for `APP_DOMAIN` and `CMS_DOMAIN` → the host.
- Ports 80 and 443 open and free on the host.

Via CI (the `ssh-docker` provider): set environment variables
`STACK_CADDY=true`, `APP_DOMAIN`, `CMS_DOMAIN`, optional `ACME_EMAIL`.

Manually:

```bash
echo "APP_DOMAIN=articles.example.com"  >> .env
echo "CMS_DOMAIN=cms.example.com"       >> .env
echo "ACME_EMAIL=you@example.com"       >> .env
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

For local HTTPS, use `*.localhost` names (`articles.localhost` / `cms.localhost`)
— Caddy serves them with its own local CA, no public DNS needed.

## Mode 2 — host already runs a proxy: point it at the containers

If the host already has Caddy/Traefik/Nginx on 80/443, don't run a second proxy.
Deploy the base **plus the proxy-net overlay**, which attaches `web`/`directus` to
the external network your proxy is already on — so the proxy resolves them by
container name, and the membership is reapplied on every deploy (no fragile
manual `docker network connect`).

Set `PROXY_NETWORK` to that network's name (CI: a `staging` variable; the
ssh-docker provider adds the overlay automatically when it's set and
`STACK_CADDY` isn't `true`). Manually:

```bash
PROXY_NETWORK=internal docker compose \
  -f docker-compose.yml -f docker-compose.proxy-net.yml up -d
```

Find your proxy's network with `docker inspect <proxy> --format '{{json .NetworkSettings.Networks}}'`.

### Example: integrate with an existing Caddy (this is how `uint8.me` runs)

`uint8.me`'s Caddy is already on a shared network called `internal`, so the stack
joins it via `PROXY_NETWORK=internal`. Then add two site blocks to the existing
Caddyfile and reload. The host Caddy does TLS via the Cloudflare DNS challenge
(a `*.uint8.me` wildcard), so the subdomains get certificates automatically:

```caddy
articles.uint8.me {
	import cloudflare_tls
	reverse_proxy http://directus-node-starter-web-1:8080 {
		header_up Host {http.request.host}
	}
}

cms.uint8.me {
	import cloudflare_tls
	reverse_proxy http://directus-node-starter-directus-1:8055 {
		header_up Host {http.request.host}
	}
}
```

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy caddy reload   --config /etc/caddy/Caddyfile --adapter caddyfile
```

(`directus-node-starter-web-1` / `-directus-1` are the Compose container names;
they're stable across redeploys. The stack joins `internal` via the proxy-net
overlay, so no `docker network connect` is needed on the Caddy side. Set
`DIRECTUS_PUBLIC_URL=https://cms.uint8.me` so admin deep-links and Directus's
`PUBLIC_URL` are correct.)

### Example: Nginx

```nginx
server {
  server_name articles.example.com;
  location / { proxy_pass http://directus-node-starter-web-1:8080; proxy_set_header Host $host; }
}
server {
  server_name cms.example.com;
  location / { proxy_pass http://directus-node-starter-directus-1:8055; proxy_set_header Host $host; }
}
```

(Nginx in a container reaches the services the same way — via the shared external
network from the proxy-net overlay. On the host with ports published you'd instead
`proxy_pass` to `127.0.0.1:<port>`, but the no-ports + shared-network approach
avoids exposing anything publicly.)

## Notes

- **Connectivity is declared, not hand-wired.** The proxy-net overlay attaches
  `web`/`directus` to your proxy's existing network on every deploy, so there's
  no `docker network connect` to remember or to re-run when the proxy container is
  recreated. (If you instead connected the proxy to the stack's own network by
  hand, that connection would be lost when the proxy is recreated.)
- Redeploying the app stack recreates the `web`/`directus` containers (new IPs);
  Caddy/Nginx proxying **by container name** re-resolves automatically. Proxying
  by IP would break — always use the names.
- Directus behind TLS uses secure cookies (`COOKIE_SECURE=true` by default in the
  deploy base). If you front it with plain HTTP, set `COOKIE_SECURE=false`.
- Whichever proxy terminates TLS should forward `X-Forwarded-Proto` (Caddy and
  Nginx do by default) so Directus generates correct URLs.

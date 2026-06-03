# Putting Cloudflare (free) in front

Cloudflare's free plan gives you DNS, a global CDN/cache, DDoS protection, and
free TLS. There are two ways to use it here — read the gotcha first.

## The port gotcha

Cloudflare's **proxied (orange-cloud) HTTP/HTTPS only works on a fixed set of
ports**. The supported ones are:

- HTTP: `80, 8080, 8880, 2052, 2082, 2086, 2095`
- HTTPS: `443, 2053, 2083, 2087, 2096, 8443`

The **frontend on port 80** (the default on a fresh host) is on that list, so you
*can* orange-cloud it directly. The catch is the **Directus admin on `:8055`**,
which is *not* a supported proxied port — so to put the admin behind Cloudflare
you need a Tunnel or a reverse proxy. (If you deployed on non-standard ports like
`8097`/`8098`, neither is supported and this applies to both services.)

| Option | What it needs | Best when |
|---|---|---|
| **A. Cloudflare Tunnel** (recommended) | a `cloudflared` container; **no open inbound ports** | you want free TLS for *both* frontend and admin with the least fuss and the tightest firewall |
| **B. Orange-cloud + host reverse proxy** | a proxy (Caddy/Nginx/Traefik) on `80/443` on the host | you already run a reverse proxy / want standard ports |

Tunnel is the cleaner free path and is what the rest of this doc covers.

## Option A — Cloudflare Tunnel

`cloudflared` makes an **outbound** connection to Cloudflare and maps public
hostnames to your internal services. Nothing listens on a public port; you can
close the published ports (`80`/`8055`, or whatever you used) and even keep `22`
locked down entirely. Works the same on uint8.me, EC2, or anywhere.

### 1. Add your domain + create a tunnel

1. Add your domain to Cloudflare (free plan) and switch its nameservers.
2. **Zero Trust dashboard** → Networks → **Tunnels** → Create a tunnel →
   *Cloudflared* → name it → **copy the token**.

### 2. Run cloudflared next to the stack

It must share the compose network (`directus-node-starter_default`) so it can
reach `web` and `directus` by name. Two ways:

**Standalone container** (no pipeline changes — simplest on the deployed host):

```bash
docker run -d --name cloudflared --restart unless-stopped \
  --network directus-node-starter_default \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate run --token <YOUR_TUNNEL_TOKEN>
```

**Or via the compose overlay** in this repo:

```bash
echo 'CLOUDFLARE_TUNNEL_TOKEN=<YOUR_TUNNEL_TOKEN>' >> .env
docker compose -f docker-compose.yml -f docker-compose.cloudflared.yml up -d
```

### 3. Map public hostnames (ingress)

In the tunnel's **Public Hostnames**, add two routes pointing at the internal
service URLs (cloudflared resolves these over the shared docker network):

| Hostname | Service (type → URL) |
|---|---|
| `app.example.com` | `HTTP` → `web:8080` |
| `cms.example.com` | `HTTP` → `directus:8055` |

Cloudflare creates the DNS records and serves both over HTTPS automatically.

- The **frontend** is `https://app.example.com`. Its data calls go same-origin to
  `https://app.example.com/cms/...`, which the Node backend proxies to Directus —
  so no CORS and no second hostname needed for reading content.
- The **admin** is `https://cms.example.com/admin`.

### 4. Tell the app its public URLs

Set `DIRECTUS_PUBLIC_URL` to the CMS hostname so admin deep-links and Directus's
own `PUBLIC_URL` are correct, then redeploy:

```bash
REPO=<owner>/directus-node-starter
gh variable set DIRECTUS_PUBLIC_URL --env staging --repo $REPO --body "https://cms.example.com"
```

If admin login over HTTPS doesn't "stick" (cookie issues behind the proxy), add
these to the Directus service env and redeploy:

```
REFRESH_TOKEN_COOKIE_SECURE=true
SESSION_COOKIE_SECURE=true
REFRESH_TOKEN_COOKIE_SAME_SITE=lax
SESSION_COOKIE_SAME_SITE=lax
```

### 5. Close the public ports (optional but recommended)

With the tunnel doing the serving, you no longer need the published ports
(`80`/`8055`) exposed. Either bind them to localhost or drop the `ports:` blocks
from the compose on the host, and tighten the firewall / security group to
outbound-only (plus SSH).

## Option B — Orange-cloud + host reverse proxy

If you'd rather keep classic DNS proxying: run a reverse proxy on the host
listening on `443` (e.g. Caddy with automatic Let's Encrypt, or Cloudflare
Origin Certificates + "Full (strict)" SSL), proxy `/` to `web:8080`, point an
orange-clouded `A`/`CNAME` record at the host, and set `DIRECTUS_PUBLIC_URL` to
your HTTPS hostname. The frontend already defaults to `:80`, so this mostly just
adds TLS + the admin route in front of the existing setup.

## What Cloudflare's free plan buys you here

- Free TLS (edge certs) without managing certificates on the host.
- CDN caching for the static frontend assets (`/static/*`) and, if you add
  cache rules, for the read-only `/cms/items/*` and `/cms/assets/*` responses.
- DDoS protection and a hostname instead of a bare IP:port.
- With Tunnel: no public inbound ports, so the origin's attack surface is just
  the outbound tunnel.

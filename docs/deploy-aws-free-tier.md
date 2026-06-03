# Deploying to AWS Free Tier

The cleanest free-tier fit for this stack is a single **EC2** instance running
Docker. It is just another "Docker host with SSH", so the existing
`ssh-docker` provider deploys to it with **no code changes** — you only repoint
the GitHub `staging` environment at the new host.

> Why EC2 and not ECS/Fargate/App Runner? Those are harder to keep inside the
> free tier for a small always-on stateful service, and they would need a
> different provider. EC2 maps 1:1 onto what we already have.

## What "free tier" gives you (check the current terms)

AWS free tier has changed over time, so confirm against your account:

- **Legacy 12-month free tier** (older accounts): 750 hrs/month of a
  `t2.micro`/`t3.micro` (1 vCPU, **1 GB RAM**), 30 GB EBS, 15 GB/month egress.
- **Newer credit-based free tier** (accounts created ~mid-2025+): a pool of
  credits ($100–200) valid for 6 months rather than always-free EC2 hours.

Either way a `t3.micro` runs this stack. 1 GB RAM is tight for Directus + Node,
so **add swap** (below). If you want predictable pricing instead, **Lightsail**
($5–7/mo, 3 months free) is a simpler alternative and still a Docker+SSH host.

## 1. Launch the instance

EC2 → Launch instance:

- **AMI**: Amazon Linux 2023 (or Ubuntu 24.04).
- **Type**: `t3.micro` (free-tier eligible in most regions; `t2.micro` in some).
- **Key pair**: create/download one (you can use it directly, or add a dedicated
  deploy key later — see step 4).
- **Storage**: 8–30 GB gp3 (Directus SQLite + uploads live here, in Docker
  volumes).
- **Security group** (inbound):
  | Port | Source | Why |
  |------|--------|-----|
  | 22 | your IP (or `0.0.0.0/0` with key-only auth) | SSH + CI deploy |
  | 8097 | `0.0.0.0/0` | Directus (public) |
  | 8098 | `0.0.0.0/0` | web / frontend |

  Note: GitHub Actions runners use a wide, changing IP range, so to let CI SSH
  in you either allow 22 from `0.0.0.0/0` (key-only auth makes this acceptable
  for a demo) or self-host a runner. Don't enable password SSH.

**Elastic IP**: allocate one and associate it with the instance so the public
address survives stop/start. It's free *while attached to a running instance*
(charged only when unattached). Without it, the public IP changes on every
stop/start and you'd have to update the GitHub vars each time.

## 2. Install Docker + Compose + swap

SSH in (`ssh -i your-key.pem ec2-user@<elastic-ip>`), then:

```bash
# --- Amazon Linux 2023 ---
sudo dnf -y install docker
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
# Compose v2 plugin (AL2023 doesn't ship it):
DOCKER_CONFIG=/usr/local/lib/docker
sudo mkdir -p $DOCKER_CONFIG/cli-plugins
sudo curl -fsSL \
  https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o $DOCKER_CONFIG/cli-plugins/docker-compose
sudo chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose

# --- 2 GB swap (important on a 1 GB instance) ---
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# log out / back in so the docker group applies, then verify:
docker compose version
```

(Ubuntu: `sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2`
and the same swap + `usermod -aG docker ubuntu` steps.)

## 3. Point the `staging` environment at EC2

In **GitHub → repo → Settings → Environments → `staging`**, update:

**Variables**

| Name | Value |
|------|-------|
| `DEPLOY_PROVIDER` | `ssh-docker` *(unchanged)* |
| `SSH_HOST` | the Elastic IP (or its public DNS) |
| `SSH_USER` | `ec2-user` (Amazon Linux) or `ubuntu` (Ubuntu) |
| `SSH_PORT` | `22` |
| `DEPLOY_DIR` | `directus-node-starter` |
| `DIRECTUS_PUBLIC_URL` | `http://<elastic-ip>:8097` |
| `DIRECTUS_PORT` / `WEB_PORT` | `8097` / `8098` |

**Secrets**

| Name | Value |
|------|-------|
| `SSH_KEY` | the private key whose public half is on the instance (step 4) |
| `DIRECTUS_SECRET`, `DIRECTUS_ADMIN_PASSWORD` | unchanged |

CLI equivalent:

```bash
REPO=<owner>/directus-node-starter
gh variable set SSH_HOST --env staging --repo $REPO --body "<elastic-ip>"
gh variable set SSH_USER --env staging --repo $REPO --body "ec2-user"
gh variable set DIRECTUS_PUBLIC_URL --env staging --repo $REPO --body "http://<elastic-ip>:8097"
gh secret  set SSH_KEY  --env staging --repo $REPO < ./deploy-key   # PEM private key
```

## 4. Deploy key

CI authenticates with `SSH_KEY`. Either reuse the instance's `.pem`, or (better)
add a dedicated deploy key:

```bash
ssh-keygen -t ed25519 -f ./deploy-key -N ""
ssh -i your-key.pem ec2-user@<elastic-ip> \
  "echo '$(cat ./deploy-key.pub)' >> ~/.ssh/authorized_keys"
gh secret set SSH_KEY --env staging --repo $REPO < ./deploy-key
```

## 5. Deploy

Push to `main` (or run the `ci-cd` workflow manually). The pipeline builds the
web image, then the `ssh-docker` provider copies the compose file + a rendered
`.env` to the instance and runs `docker compose pull && up -d`. The image is
pulled from GHCR using `GITHUB_TOKEN`, so it works even for private packages.

Verify:

- Frontend: `http://<elastic-ip>:8098`
- Directus admin: `http://<elastic-ip>:8097/admin`

Then seed content (bare Directus starts empty):

```bash
DIRECTUS_URL=http://<elastic-ip>:8097 \
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=<your-password> \
node scripts/seed-directus.mjs
```

## Caveats / cost control

- **No HTTPS here.** Ports 8097/8098 are plain HTTP. For anything real, put a
  reverse proxy (Caddy/Traefik/Nginx) with a domain in front for TLS, and stop
  publishing 8097/8098 to the world — proxy `/` to the web container and, if you
  want public admin, `/admin` to Directus.
- **RAM**: 1 GB + 2 GB swap is enough for the demo but not heavy use. Move to
  `t3.small` (paid) or switch Directus to Postgres/RDS if you outgrow SQLite.
- **Egress**: free-tier data-transfer-out is capped (15 GB or 100 GB/month
  depending on tier). Image-heavy traffic can exceed it.
- **Stop when idle** to save EC2 hours/credits — but keep the Elastic IP
  associated (or release it) to avoid the unattached-EIP charge. Docker volumes
  persist across stop/start on the same EBS root volume.
- **Region**: pick one close to your users; free-tier eligibility for
  `t2`/`t3.micro` varies by region.

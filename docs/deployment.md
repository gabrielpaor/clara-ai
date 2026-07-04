# Deployment guide

How to take Clara from `docker compose up` on a laptop to a production
deployment — including an honest accounting of what's free and what isn't.

## The free-tier reality check

| Component | Free forever? | Notes |
| --- | --- | --- |
| Next.js dashboard | ✅ Vercel Hobby | But serverless has no disk — see storage refactor below |
| PostgreSQL + pgvector | ✅ Neon / Supabase free tier | Both support pgvector |
| n8n | ❌ not really | Railway trial credit expires; Render free tier **sleeps**, which kills the Gmail poller. Real options: ~$5/mo VPS or Railway hobby, n8n Cloud (paid), or Oracle Cloud's always-free ARM VM (free but real sysadmin work) |
| Gemini API | ✅ free tier | Rate-limited; expect occasional 503s (Clara retries them) |
| Gmail API | ✅ | OAuth consent stays in "Testing" mode for a personal project |
| File storage | ✅ Cloudflare R2 (10GB) | Needed once the app leaves a machine with a disk |

**Recommended production topology** (≈ $5/month total):

```
Vercel (dashboard + API)  ──►  Neon Postgres (+pgvector)
        │  webhooks / callbacks
        ▼
n8n on a small VPS or Railway  ──►  Gemini API / Gmail API
        │
        ▼
Cloudflare R2 (invoice files)
```

## The one required code change: file storage

`web/src/lib/storage.ts` was deliberately written as a two-function
interface (`saveInvoiceFile`, `readInvoiceFile`) against local disk.
Serverless platforms have no persistent disk, so production needs an
S3-compatible implementation (R2/S3/Supabase Storage) behind the same
interface. Nothing else in the codebase touches the filesystem.

## Environment matrix

| Variable | Local | Production |
| --- | --- | --- |
| `DATABASE_URL` | docker Postgres | Neon connection string (pooled) |
| `N8N_WEBHOOK_URL` | `http://localhost:5678/webhook` | `https://n8n.yourdomain.com/webhook` |
| `APP_URL` | `http://localhost:3000` | `https://clara.yourdomain.com` |
| n8n → app URLs (in workflow JSON) | `host.docker.internal:3000` | the public app URL |
| `WEBHOOK_URL` (n8n env) | unset | n8n's public URL, so registered webhooks are reachable |
| `INTERNAL_API_KEY`, `SESSION_SECRET`, `N8N_ENCRYPTION_KEY` | dev values | **rotate — never reuse dev secrets** |

## Gmail OAuth

1. Google Cloud Console → project → enable **Gmail API**
2. OAuth consent screen: External, add your address as a **Test user**
   (personal projects never need Google's full verification)
3. Credentials → OAuth client (Web application) → redirect URI:
   `https://<your-n8n-host>/rest/oauth2-credential/callback`
   (locally: `http://localhost:5678/rest/oauth2-credential/callback`)
4. Paste client id/secret into n8n's **Clara Gmail** credential → Sign in

## Security hardening checklist (before real traffic)

- [ ] Rotate `INTERNAL_API_KEY`, `SESSION_SECRET`, `N8N_ENCRYPTION_KEY`
- [ ] Replace the seeded admin user; bcrypt cost ≥ 12 stays
- [ ] HTTPS everywhere (Vercel/managed n8n handle this; VPS → Caddy/Traefik)
- [ ] Put n8n behind auth (it ships with owner login; consider SSO/VPN too)
- [ ] Keep `/api/internal/*` unlisted in any public API docs; the shared
      secret is the gate, but don't advertise the doors
- [ ] Tighten `INGEST_ALLOWED_SENDERS` to real vendor addresses only
- [ ] Postgres backups (Neon has PITR on paid; pg_dump cron is free)
- [ ] Set n8n `EXECUTIONS_DATA_MAX_AGE` so execution logs don't grow forever
- [ ] Review Gemini data-usage terms for your invoice data; for sensitive
      volumes consider paid tier (no training on API data) or a local model

## Deploying the pieces

**Database (Neon):** create project → enable pgvector (`CREATE EXTENSION
vector;` runs via the committed migration) → `npx prisma migrate deploy`
(not `migrate dev` — no shadow DB games in prod) → `npx prisma db seed`.

**Dashboard (Vercel):** import the repo, root directory `web/`, set env
vars, deploy. `npx next typegen` runs in the build.

**n8n (VPS/Railway):** run the same two containers from
`docker-compose.yml` (or Railway's n8n template + managed Postgres). Set
`WEBHOOK_URL` to the public URL. Import workflows with
`scripts/import-workflows.sh`, update the three `host.docker.internal`
URLs in the workflow JSON to the public app URL first.

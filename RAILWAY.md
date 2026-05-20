# Deploying to Railway

This service is a single Node.js container (Express + Socket.io + React/Vite + SQLite). It's built from `Dockerfile`; Railway picks it up automatically because `railway.json` sets `builder: "DOCKERFILE"`.

## TL;DR — minimum working deploy

1. **Create the service** — connect this repo to Railway, branch `claude/integrate-railway-deployment-w8wBd` (or the merged branch once it's in main).
2. **Set two variables**:
   - `SESSION_SECRET` — anything random; generate with `openssl rand -base64 32`. (The server will boot without it and warn loudly, but production sessions will not be secure.)
   - `GEMINI_API_KEY` — get a free key at https://aistudio.google.com.
3. **Click Deploy.** Build takes 3–5 minutes (apt-installs Chromium + GPU/font libs).
4. **Generate a public domain** in Railway Settings → Networking → Generate Domain.
5. Visit the domain. You should see the React UI. `GET /api/health` returns `{"status":"ok",…}`.

That's the entire happy path. **Don't set `DB_PATH` or `ENABLE_WHATSAPP` on the first deploy** — defaults work.

## When to add a persistent volume

The default `DB_PATH=./wizard.db` lives **inside the container**, which means **every redeploy wipes the database**. That's fine for first-deploy smoke testing. For real use:

1. Railway → your service → Settings → Volumes → New Volume, mount path `/data`.
2. Add env vars:
   - `DB_PATH=/data/wizard.db`
   - `WA_SESSION_PATH=/data/wa_session` (if you'll turn on WhatsApp)
3. Redeploy.

The server now **auto-creates** the parent directory if it doesn't exist, so you can set `DB_PATH=/data/wizard.db` before the volume is attached — it'll just live in ephemeral storage until you mount the volume. No more `Cannot open database because the directory does not exist` crash on boot.

## All environment variables (in priority order)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SESSION_SECRET` | yes (production) | `smiley-wizard-secret` | Boot proceeds with a warning if unset. |
| `GEMINI_API_KEY` | recommended | _none_ | First-choice AI for `/api/ai-chat` and `/api/ai-agent`. Free tier: 1,500/day. |
| `GEMINI_API_KEY_2` | optional | _none_ | Second key, used when key 1 hits rate limit. Doubles daily ceiling. |
| `GROK_API_KEY` | optional | _none_ | Fallback when Gemini fails. |
| `GROQ_API_KEY` | optional | _none_ | Last-resort AI fallback. |
| `ALLOWED_ORIGIN` | optional | `*` | Restrict Socket.io CORS in production to your actual domain. |
| `NODE_ENV` | optional | `development` | Set to `production` for secure cookies. |
| `PORT` | (auto) | `3000` | Railway sets this automatically. The server binds to `0.0.0.0:$PORT`. |
| `DB_PATH` | optional | `./wizard.db` | Set to `/data/wizard.db` only if a volume is mounted at `/data`. |
| `WA_SESSION_PATH` | optional | `./wa_session` | Same caveat as `DB_PATH`. |
| `ENABLE_WHATSAPP` | optional | `false` | Turn on only after the volume is attached, otherwise the QR session is lost on every restart. |
| `PLAYWRIGHT_EXECUTABLE_PATH` | (set in Dockerfile) | `/usr/bin/chromium` | Override only if Chromium lives elsewhere. |
| `CHROME_PATH` | (set in Dockerfile) | `/usr/bin/chromium` | Same. |
| `WEBHOOK_SECRET` | optional | _none_ | If set, `/api/webhooks/myfatoorah` verifies the `X-MyFatoorah-Signature` HMAC. |
| `TELEGRAM_BOT_TOKEN` | optional | _none_ | If set, the long-poll loop starts and listens for `/hunt`, `/status`, `/recent`, `/export`. |
| `HUNT_FETCH_RETRIES` | optional | `2` | Retries on transient search-engine fetch failures. |
| `HUNT_ENRICH_CONCURRENCY` | optional | `4` | Parallel enrichment workers per hunt. |

## Healthcheck

`railway.json` is wired to:

```
healthcheckPath: /api/health
healthcheckTimeout: 300
```

`GET /api/health` returns `{"status":"ok","uptime":<sec>}` with no DB dependency, so it stays up even if migrations are still running.

For deeper diagnostics, `GET /api/stats` returns:

```json
{
  "total_merchants": { "count": 0 },
  "total_leads":     { "count": 0 },
  "runtime": {
    "inFlightHunts": 0,
    "totalHuntsCompleted": 0,
    "totalHuntsFailed": 0,
    "lastSuccess": null,
    "lastError":   null,
    "uptimeSec":   12,
    "nodeMemMb":   180
  }
}
```

## Common failure modes and what they look like

| Symptom | Cause | Fix |
| --- | --- | --- |
| Build fails at `apt-get install chromium` | Mirror flake | Retry. Apt installs are network-bound. |
| Build fails at `npm ci` | Lockfile drift | `npm install` locally, commit the updated lockfile. |
| Container exits ~5s after boot, no obvious error | `DB_PATH` points at a path whose parent doesn't exist | Fixed in this branch (auto-mkdir). If you see this on an older branch, set `DB_PATH=./wizard.db` and redeploy. |
| Healthcheck timeout | Server logs show "WARNING: NODE_ENV=production but SESSION_SECRET is not set" but otherwise looks fine | Healthcheck doesn't depend on session — check if the listener log appeared. If not, the issue is earlier. |
| `whatsapp-web.js` errors at boot | `ENABLE_WHATSAPP=true` but Chromium not found, or `WA_SESSION_PATH` parent missing | Both are now auto-handled. Otherwise check the `[WhatsApp] Chrome path:` log line. |
| `429` from Telegram | `TELEGRAM_BOT_TOKEN` is shared with another running instance | Only one process per bot token. The long-poll loop self-throttles to 10s on persistent failures. |
| UI returns "App not built" | Image didn't run `npm run build` | Should never happen with the Dockerfile in this repo — `RUN npm run build` is at line ~26. If you see this, your Dockerfile drifted. |

## Importing the 493 leads

After the first successful deploy:

```bash
# 1. Open a Railway shell on the service (Service → Settings → Shell)
# 2. Run the importer
npx tsx scripts/importLeads.ts <path-to-your-xlsx>
# Expected:
#   rows read:    493
#   inserted:     476
#   duplicates:   13
#   skipped:      4
#   errors:       0
```

You can re-run safely — canonical-id dedup means re-runs report all rows as duplicates instead of doubling the data.

## Verifying the proposal feature end-to-end

```bash
# Get any lead's merchant_id
curl -s https://<your-railway-domain>/api/leads?limit=1 | jq '.[0].merchant_id'

# Hit /api/proposal with that id
curl -s https://<your-railway-domain>/api/proposal/<merchant-id> | jq '.proposal.commercialAnalysis'
# Expect: { tier, setupFeeAed: { min, max, recommended }, localRate, intlRate, settlement, rationale, upliftEstimate }
```

Or open the UI → click any merchant card → use the three buttons (📲 WhatsApp · ✉️ Email · 📄 Proposal).

# FiroStatus handover runbook

How to keep [firostatus.com](https://firostatus.com/) running, or take it over. MIT licensed — anyone with Node ≥ 22.5 and outbound TLS to Electrum `:50002` can operate it.

**Uptime commitment:** panagot will keep the production board online for **at least 12 months** from FCS M1 go-live (domain + hosting line in the grant), then **6–12 months** beyond that on a best-effort basis while the community still uses the feed. If handover happens earlier, this runbook is the whole ops surface.

## What runs

| Piece | Role |
|-------|------|
| `server.js` | Always-on process: light probes ~45s, anon-set sweep ~5 min, JSON API, dashboard |
| `lib/probe.js` `REGISTRY` | Curated public Electrum hosts (no scanning) |
| `data/` | SQLite history + last-good anon-set cache (gitignored) |
| Reverse proxy | HTTPS for `firostatus.com` → `PORT` (default 3000) |

No npm production dependencies. `npm start` is `node server.js`.

## Running cost (order of magnitude)

| Item | Typical |
|------|---------|
| Domain | ~$10–15 / year |
| Always-on Node host with egress to `:50002` | ~$5–12 / month (small VPS or equivalent shared Node) |
| Alerting | Free (Telegram bot / generic webhook) |

The M1 budget included a **$200 hosting line** (domain + 12 months). After that year, cost is a single small always-on host.

## Start / restart

```bash
cd /path/to/Firostatus
# optional: cp .env.example .env  and fill alert channels
PORT=3000 node server.js
```

Process manager: systemd, PM2, or the host’s Node app supervisor. Keep a single instance — two processes would double-probe the fleet.

Health:

```bash
curl -sS https://firostatus.com/api/health | jq '{ok,uptime_s,summary,history}'
curl -sS https://firostatus.com/api/ci | jq '{ok,spark_ok,max_lag,reasons}'
```

Expect `anonset_source` of `live` or `live_refreshing` on `/api/status`.

## Environment

See [`.env.example`](../.env.example). None are required for the public board.

| Variable | Purpose |
|----------|---------|
| `PORT` | Listen port (default 3000) |
| `PUBLIC_ORIGIN` | Links inside alert text (default `https://firostatus.com`) |
| `ALERT_TELEGRAM_BOT_TOKEN` / `ALERT_TELEGRAM_CHAT_ID` | Telegram bot DM / channel |
| `ALERT_WEBHOOK_URL` | Generic JSON POST |
| `ALERT_TOKEN` | Required for `POST /api/alerts/test` when not on loopback |
| `ALERT_COOLDOWN_MS` | Per-event cooldown (default 30 min) |
| `FIRO_TRUST_PROXY` | `1` to rate-limit operator checks by `X-Forwarded-For` |

Never commit `.env`.

## Data to back up

Copy `data/` periodically (SQLite + caches). History is how 24h/7d uptime and setHash windows are built. Losing it does not stop live probes; it resets durable charts.

## DNS / domain

`firostatus.com` should stay pointed at the always-on host. On handover: transfer the registrar account (or update NS) and the GitHub [`firostatus/Firostatus`](https://github.com/firostatus/Firostatus/tree/main) repo admin to the new operator. TLS is whatever the reverse proxy already uses.

## Registry changes

Public hosts are opt-in. Operators verify on `/operators`, then open a PR against `lib/probe.js` (see `CONTRIBUTING.md`). Do not scan the internet for Electrum ports.

## Alerting

Configure one channel in `.env`, restart, then from the host:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/alerts/test \
  -H 'content-type: application/json' \
  -d '{"note":"handover test"}'
```

UI: `/alerts`. Cooldown avoids a flood when a host flaps.

## Upstream Spark check

`scripts/spark-health-check.js` exits 0 when `spark_ok` is true (`npm run check:spark`). Optional local CI helper — not an upstream wallet PR.

## Who to ping

- Ops email: [admin@firostatus.com](mailto:admin@firostatus.com)
- Source: [github.com/firostatus/Firostatus](https://github.com/firostatus/Firostatus/tree/main)
- FCS / forum: [proposal](https://funding.firo.org/proposals/zz-noimg3-panagot) · [thread](https://forum.firo.org/t/fcs-proposal-zz-noimg3/4350)

If the original operator is unreachable, the MIT tree plus this runbook is sufficient to stand up a replacement origin and cut DNS.

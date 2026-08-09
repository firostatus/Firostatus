# Deploy FiroStatus (firostatus.com)

Node.js **≥ 22.5** (needs `node:sqlite`). No production npm dependencies — API uses Node built-ins.

**Production:** [https://firostatus.com](https://firostatus.com/). UI is the dashboard in `public/`.

## Upload & run

```bash
unzip firostatus-deploy.zip -d firostatus
cd firostatus
PORT=3000 node server.js
```

Or from a clone:

```bash
git clone https://gitlab.com/panagiotispollis/firostatus.git
cd firostatus
npm start
```

Point the reverse proxy (or cPanel Node app) at the Node process with HTTPS for **firostatus.com**.

UI routes are path-based (`/overview`, `/backends`, `/spark`, `/developers`, `/roadmap`, `/about`, `/backend/:id`). Ensure the proxy forwards those paths to Node.

## Hosting requirements

- Always-on Node process (not serverless-only)
- **Outbound TCP 50002** (TLS) to public Firo Electrum hosts
- Writable `data/` for SQLite history

Shared hosting can work if egress to `:50002` is allowed.

## What runs

| Piece | Role |
|-------|------|
| `server.js` | Always-on Electrum/Spark probes + JSON API + serves `public/` |
| `public/` | Production dashboard |
| `data/` | Created at runtime (SQLite history) — do not commit |
| `docs/VERIFY.md` | CFC / community verifier curls |

## Pack a deploy zip (optional)

```bash
npm run pack:deploy
# -> Desktop/firostatus-deploy.zip
```

## Verify

```bash
curl -sS https://firostatus.com/api/ci | jq '{ok, spark_ok, notes}'
curl -sS https://firostatus.com/api/status | jq '{summary, anonset_source}'
curl -sS https://firostatus.com/api/health | jq '{ok, history}'
```

Expect `anonset_source: "live"` (or `live_refreshing` / `last_good` during a sweep). Prefer `spark_ok` over green-count when interpreting fleet health.

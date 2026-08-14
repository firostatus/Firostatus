# Firo Spark Sync Monitor

Community **health dashboard + JSON API** for the public **Firo Electrum backends** that light and mobile wallets sync through.

**Flagship question (answered live):** *Can wallets complete a Spark sync on these public backends?*

Height-only monitors can show a host as healthy while Spark sync still stalls. This project measures the Spark path itself: full **anonymity-set fetch cost** (time / size / coins), fleet-wide **`setHash` consistency**, tip lag, and TLS expiry — with privacy-safe probes only.

| | |
|--|--|
| **Live (production)** | [firostatus.com](https://firostatus.com/) |
| **Funding** | [FCS proposal](https://funding.firo.org/proposals/zz-noimg3-panagot) · [Forum](https://forum.firo.org/t/fcs-proposal-zz-noimg3/4350) |
| **License** | [MIT](LICENSE) |
| **Source** | [github.com/firostatus/Firostatus](https://github.com/firostatus/Firostatus/tree/main) (MIT) |
| **Author** | Pan (`panagot`) |

```bash
npm start   # optional local always-on · Node.js ≥ 22.5 → http://localhost:3000
```

![Spark fleet badge](https://firostatus.com/api/badge)

---

## Table of contents

1. [Why this exists](#why-this-exists)
2. [What you get in the UI](#what-you-get-in-the-ui)
3. [What it probes](#what-it-probes)
4. [Status model](#status-model)
5. [Architecture](#architecture)
6. [Run locally (always-on)](#run-locally-always-on)
7. [Public JSON API](#public-json-api)
8. [CI and embeds](#ci-and-embeds)
9. [Curated registry](#curated-registry)
10. [Production](#production)
11. [Roadmap / FCS](#roadmap--fcs)
12. [Docs map](#docs-map)
13. [Privacy](#privacy)
14. [Contributing](#contributing)

---

## Why this exists

Firo light and mobile wallets (Campfire, Stack Wallet, Electrum-Firo, …) sync Spark through public **ElectrumX** hosts — not by talking to a full node directly.

When Spark sync is slow or fails, teams need a shared answer:

- Is the backend offline or far behind tip?
- Is it serving a **divergent or stale** anonymity set (`setHash` mismatch)?
- Is the **full anon-set download** too slow for mobile (often tens of MB / tens of seconds)?
- Is TLS about to expire?

Existing height trackers miss that Spark path. This monitor **downloads the active Spark anonymity set** from each curated host, times it, fingerprints it, and cross-checks the fleet.

**Who it is for**

| Audience | Use |
|----------|-----|
| Wallet / SDK / mobile teams | Default-list review, CI gates (`spark_ok`), incident triage |
| ElectrumX operators | Serve cost, setHash drift, TLS countdown |
| Firo community | Shared transparency when Spark sync stalls |

**Who it is not for**

- An in-wallet “pick a server” UI (wallets keep their own client)
- A privacy guarantee for user funds (ops health board only)
- A replacement for a wallet Electrum SDK

---

## What you get in the UI

Open the dashboard tabs:

| Tab | Highlights |
|-----|------------|
| **Overview** | Live fleet strip, **Spark sync answer** (usable / agreement / best reliable / risk), durable Chart.js series (tip lag, fleet mix, anon-set), glance table, SQLite uptime, **fleet scorecard**, **one-click compare**, TLS strip, status timeline, setHash incidents |
| **Backends** | Full table sorted critical → healthy · **search** · status filter · **wallet `used_by` filter** · **Diagnose** drawer on yellow/red · optional RTT/trend columns |
| **Spark health** | Anon-set ranking, growth charts, bandwidth compare (same setHash, different MB), setHash divergence windows |
| **Operators** | Listed host vs fleet (TLS, tip, Spark, fetch) · light live probe · listing via issue / merge request |
| **Alerts** | On-board event log · Telegram / webhook for the maintainer · `/api/ci` for CI |
| **Developers** | Routes, field glossary, `spark_ok`-first CI, embed kit, ElectrumX → JSON field map, live `/api/ci` chips |
| **Roadmap** | FCS milestones + live M1 checklist |
| **About** | What this is, status model, privacy, operators & alerts |

**Per-backend detail** (`#/backend/:id`): reliability verdict, fail-reason chips, vs-fleet compare, status ribbon, durable history charts, setHash windows for that host, copy connect / page link / jq curls.

**Diagnose drawer** (yellow/red): likely cause, wallet tips vs operator checks, raw signal, copyable OpenSSL / API reproduce snippet.

---

## What it probes

Privacy-safe **public Electrum JSON-RPC over TLS** only:

| Method | Fields derived |
|--------|----------------|
| `server.version` | reachability, version, TLS cert expiry |
| `blockchain.headers.subscribe` | height, lag vs fleet reference tip |
| `spark.getsparklatestcoinid` | Spark coin group id + fleet agreement |
| `spark.getsparkanonymityset` | fetch ms / MB / coins / `setHash` / consistency |

No addresses, keys, transactions, or wallet traffic are sent or stored.

**Reference tip:** highest height that at least two backends agree on (one forked host cannot skew the fleet).  
**Spark / setHash consensus:** modal values across measured hosts.  
**Anon-set “slow” band:** fleet-relative (about **1.75× median**, floor **20s**) — not a fake absolute 15s cutoff when the whole fleet is ~30s.

---

## Status model

| Status | Meaning |
|--------|---------|
| **green** | Reachable, ≤2 blocks behind, Spark id + setHash match, probe RTT &lt;3s from this monitor, TLS ≥14 days |
| **yellow** | Lagging, slow RTT, missing Spark id, Spark / setHash mismatch, TLS &lt;14 days, or slow/failed anon-set vs fleet band |
| **red** | Unreachable, &gt;100 blocks behind, or TLS expired |

**Reliable default?** (scorecard) = green · Spark+setHash OK · not slow vs fleet band · TLS OK · (24h uptime ≥95% when history exists).

Probe RTT is **secondary** and **single-region** — useful for ops, not a ranking of user-device latency.

---

## Architecture

Shared probe core: `lib/probe.js`. Shared UI: `public/index.html` + `public/enhance.js`.

```
Browser ──► /api/status | /api/history | /api/ci | /api/check | /api/alerts | …
                 │
            server.js (always-on)
         light probes + anon sweeps + alerts
           SQLite /api/history
                 │
            lib/probe.js
```

| | Light probes | Anon-set | History |
|--|--------------|----------|---------|
| **Production / `npm start`** | Live (~45s) | Live sweeps (~5 min) · `anonset_source: live` | SQLite → `/api/history` |

---

## Run locally (always-on)

**Requirements:** Node.js **≥ 22.5** (uses built-in `node:sqlite`). No `npm install` dependencies.

```bash
git clone https://github.com/firostatus/Firostatus.git
cd Firostatus
npm start
# → http://localhost:3000
# optional: copy .env.example to .env for Telegram / webhook alerts
```

| Path | Role |
|------|------|
| `server.js` | Always-on poller + static UI + API |
| `lib/probe.js` | Registry + Electrum/Spark probes + snapshot builder |
| `lib/history.js` | SQLite samples, fleet series, setHash events, uptime |
| `lib/apiMeta.js` | `/api/docs` glossary, registry, deep links |
| `lib/alerts.js` | Telegram / webhook alerts + on-host event log |
| `lib/selfcheck.js` | Operator self-check (private IPs rejected) |
| `public/index.html` | Dashboard |
| `public/enhance.js` | Charts, scorecard, compare, diagnose, analytics |
| `data/history.sqlite` | Created at runtime (**gitignored**) |

---

## Public JSON API

| Route | Purpose |
|-------|---------|
| [`GET /api/status`](https://firostatus.com/api/status) | Full fleet snapshot (+ `meta`, `used_by`, anonset, TLS) |
| [`GET /api/spark`](https://firostatus.com/api/spark) | Compact Spark consensus |
| [`GET /api/ci`](https://firostatus.com/api/ci) | Pass/fail JSON — HTTP **200** when `ok`, **503** when not |
| [`GET /api/docs`](https://firostatus.com/api/docs) | Field glossary, registry, Electrum→field map, deep links |
| [`GET /api/badge`](https://firostatus.com/api/badge) | SVG fleet health badge |
| [`GET /api/health`](https://firostatus.com/api/health) | Liveness (uptime, sample_count) |
| `GET /api/history` | Durable series + uptime + setHash events (**always-on only**) |
| `GET /api/alerts` | Alert channel booleans + recent deliveries |
| `POST /api/check` | Operator self-check (light probe, SSRF-safe) |

Machine-readable docs: [/api/docs](https://firostatus.com/api/docs) · human notes: [`docs/API.md`](docs/API.md)

### Example: status

```bash
curl -sS https://firostatus.com/api/status \
  | jq '{summary, spark_sethash_consensus, anonset_source,
         endpoints: [.endpoints[] | {id, name, status, lag, used_by, spark_consistent, anonset}]}'
```

### Example: spark_ok-first CI (recommended for Spark path)

```bash
# Spark path health (tip lag alone should not fail this check)
curl -sS https://firostatus.com/api/ci | jq -e '.spark_ok == true'

# Strict tip + Spark gate (curl -f fails on HTTP 503)
curl -sS -f https://firostatus.com/api/ci | jq '{ok, spark_ok, max_lag, reasons}'
```

| Field | Meaning |
|-------|---------|
| `spark_ok` | No red hosts; Spark coin id + setHash agree |
| `ok` | `spark_ok` **and** `max_lag ≤ 2` |

### Example: history (always-on)

```bash
curl -sS 'https://firostatus.com/api/history?hours=24&limit=200' \
  | jq '{sample_count, fleet_pct_24h: .uptime.fleet_pct_24h,
         events: (.events.sethash | length),
         last: .points[-1]}'
```

---

## CI and embeds

**Badge (README / status page):**

```markdown
[![Firo Spark fleet](https://firostatus.com/api/badge)](https://firostatus.com/)
```

**Deep links** (production: https://firostatus.com)

| Link | Target |
|------|--------|
| `/overview` | Overview |
| `/spark` | Spark health |
| `/backends` | Backends table |
| `/developers` | Developers |
| `/operators` | Operator self-check |
| `/alerts` | Fleet event log · Telegram / webhook |
| `/backend/mathnodes` | Per-host detail (registry id) |

Registry ids and deep links also appear under `/api/docs`.

---

## Curated registry

Hosts live in `lib/probe.js` (`REGISTRY`). No internet scanning — opt-in curated list only.

Each endpoint includes **`used_by`**: wallets known to ship or list that host (Campfire, Stack Wallet, Electrum-Firo). Tags are informational, not exclusive — users can override servers in-wallet.

Default SSL port: **50002**.

---

## Production

| | |
|--|--|
| **Public board** | [firostatus.com](https://firostatus.com/) — always-on Node (`server.js` + `public/`) |
| **Source (MIT)** | [github.com/firostatus/Firostatus](https://github.com/firostatus/Firostatus/tree/main) |
| **Anon-set** | Continuous sweeps · `anonset_source: live` (or last-good while refreshing) |
| **History** | SQLite via `/api/history` |
| **Verifier curls** | [`docs/VERIFY.md`](docs/VERIFY.md) |

---

## Roadmap / FCS

Funded via the **Firo Crowdfunding System** — about **$2,000** (in FIRO), 50/50 milestones, paid after verification.

| Milestone | Focus |
|-----------|--------|
| **M1** | Always-on production: domain, MIT source, live dashboard + API + history, forum launch |
| **M2** | Ops: alerting, operator self-check, decision surfaces, handover |

Proposal archive: [`docs/PROPOSAL.md`](docs/PROPOSAL.md) · live checklist: dashboard **Roadmap** tab.

---

## Docs map

| Doc | Contents |
|-----|----------|
| [`docs/VERIFY.md`](docs/VERIFY.md) | CFC / community verifier curls |
| [`docs/API.md`](docs/API.md) | Human API notes |
| [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) | Probe rules, scoring, uptime definition |
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | Runbook, cost, 12-month uptime commitment |
| [`docs/PROPOSAL.md`](docs/PROPOSAL.md) | Historical FCS proposal text |
| [`DEPLOY.md`](DEPLOY.md) | Always-on deploy notes |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to propose registry / docs changes |

---

## Privacy

- Probes use **public Electrum methods only**.
- **No** wallet addresses, keys, transactions, or personal data.
- This board is **ops health for the curated fleet** — not a wallet and not a privacy guarantee for funds.
- CORS is open (`*`) so browser tools and status pages can read the JSON feed.

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

Typical contributions:

- Registry corrections / new opt-in public Electrum hosts (with operator permission)
- Methodology clarifications
- Docs and CI examples for wallet teams

---

## License

[MIT](LICENSE) © 2026 panagot.

Free, reusable public good under FCS requirements. Not affiliated with the Firo Core organization solely by linking to upstream Firo repositories.

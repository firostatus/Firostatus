# Firo Spark Sync Monitor — Public Light-Wallet Backend Health Dashboard

> **Archive note:** Historical FCS proposal text (as submitted). For live verification use [firostatus.com](https://firostatus.com/), [`docs/VERIFY.md`](VERIFY.md), and this repository’s README. Production runs always-on Node (`server.js` + `public/`), not a serverless preview.

**Category:** Infrastructure / Wallets  
**Total requested:** $2,000 USD (paid in FIRO at the exchange rate on approval, per FCS convention)  
**Duration:** ~3 weeks of work, completed within 1 month of funding  
**License:** MIT (Firo Project) — all code open-sourced  
**Author:** panagot

---

## tl;dr

A neutral, always-on health dashboard + public JSON API for the **Firo Electrum backends that light and mobile wallets sync through**. Flagship: **Spark anonymity-set fetch health** (serve time, size) and **`setHash` consistency**, plus chain lag. Probe RTT is secondary / single-region.

This is the metric header-height monitors miss and it is the real reason mobile Spark syncs stall.

---

## The problem

Firo light and mobile wallets do not talk to a full node directly — they sync through **public Electrum backends** (`electrumx*.firo.org`, `firo.stackwallet.com`, `firo.mathnodes.com`, …). When a Spark sync is slow or fails, users and wallet developers cannot tell whether the fault is:

- a backend that is offline or lagging,
- a backend serving **stale or inconsistent Spark state**, or
- the wallet itself.

Existing monitors (e.g. 1209k-style trackers) only check **header height**. Firo’s mobile sync pain is the **Spark anonymity set**: a backend can look healthy on height while serving a slow, oversized, or inconsistent set. This proposal funds a public **anon set fetch + `setHash` cross check** for the Firo community: wallet developers, Electrum operators, and anyone who needs a shared Spark backend signal.

**Firo Spark Sync Monitor answers one question:** *Can a wallet actually complete a Spark sync on this backend right now?*

---

## What makes this different — measured, not hypothetical

The prototype already fully downloads each backend's Spark anonymity set for the active coin group and times it. Live numbers from the current fleet (active coin group **10**):

| Metric | Measured value |
|--------|----------------|
| Anonymity-set size (active group) | **~19,300 coins** |
| Download size per full fetch | **~20–32 MB** (Firo Core 32 MB vs Stack Wallet / MathNodes ~20 MB for the same consensus set) |
| Full-set serve time | **~20s – 44s** (median ~36s; measured from this monitor; grows with the set) |
| `setHash` consistency | Cross-checked fleet-wide — catches hosts serving a divergent set |

Two insights fall straight out of this and neither is visible in any existing tool:

1. **Serve time of 15–40s+ is the mobile-sync bottleneck**, and it grows as the Spark set grows — data Firo core devs can use for roadmap decisions.
2. **The same anonymity set is served at wildly different byte sizes** (32 MB vs 18 MB) depending on operator — a concrete bandwidth-efficiency signal for operators.

Cross-checking `setHash` also catches a backend serving a **different / forked** anonymity set — not just one that is offline.

---

## What exists today (prototype)

A self-contained prototype (Node.js, built-ins only) already:

- Polls the full curated Firo Electrum fleet over TLS
- Measures height, lag vs reference tip, latency, and software version
- Cross-checks the active Spark coin-group id (`spark.getsparklatestcoinid`) fleet-wide
- Runs the throttled **anon-set fetch-health** probe (`spark.getsparkanonymityset`) described above
- Serves a live, chart-rich dashboard (fleet health over time, latency charts, per-backend sparklines, Spark-health cards) + a public JSON API (`/api/status`; durable `/api/history` is a funded milestone)

All probes are **privacy-safe**: `server.version`, `blockchain.headers.subscribe`, `spark.getsparklatestcoinid`, `spark.getsparkanonymityset`. No addresses, no keys, no wallet traffic, ever. Source published MIT at kickoff.

---

## What this delivers

| Capability | Description |
|------------|-------------|
| Curated registry | Public Firo Electrum backends, in version control — no internet scanning |
| Privacy-safe probes | Height, probe RTT, version |
| Spark coin-group consistency | `spark.getsparklatestcoinid` cross-checked across the fleet |
| **Anon-set fetch health** | Full-set fetch time, size, and `setHash` consistency — the flagship metric |
| Reference comparison | Lag vs fleet reference chain tip |
| Status classification | Green / yellow / red by lag, latency, and Spark consistency |
| Durable history | Multi-day uptime %, historical charts |
| Public JSON API | Machine-readable status + history feeds |

**Who benefits:** Firo wallet and mobile developers validating backend integrity and defaults; Electrum operators catching Spark issues before user reports; the wider community via a public dashboard and `/api/status` + `/api/docs`. Complements Electrumx wallet clients (one host at a time) by publishing fleet wide Spark health.

---

## What this is *not*

- Not operating or competing with any Electrum backend
- Not port scanning, and never touching addresses, keys, or wallet traffic
- Not a block explorer or P2P network monitor

---

## Project timeline & milestones

Total **$2,000**, split 50/50. Work begins on funding and completes **within one month**.

### Milestone 1 — Always-on production · $1,000 · Week 1

Released at kickoff (covers domain + 12 months hosting + the core production build). Not only hardening — continuous Spark fleet probes on always-on hosting.

**Deliverables**
- Public **open-source GitHub repo** (MIT) with README, methodology docs, contribution guide
- **Own domain + HTTPS + always-on VPS hosting** (12 months prepaid)
- **Production dashboard** for the full Firo Electrum fleet: reachability, height, lag vs reference tip, latency, software version
- **Spark coin-group consistency** cross-checked fleet-wide
- **Anon-set fetch-health** live (fetch time, size/coins, `setHash` consistency)
- **Durable history storage** (SQLite/Postgres) → real 24h / 7d uptime %
- **Public read-only JSON API** (`/api/status`, `/api/docs`, `/api/history`) + concrete curl / CI examples
- **Firo forum thread** + short launch write-up

**Acceptance:** Live public URL; repo public under MIT; API returning real fleet data; anon-set fetch-health populated for all backends; continuous history being recorded.

### Milestone 2 — Ops, decision tools & upstream · $1,000 · Weeks 2–3

Released on delivery. Ops tooling plus decision surfaces so wallet teams can act, not only watch.

**Deliverables**
- **Per-backend detail pages** with historical charts (24h / 7d / 30d): height, lag, latency, anon-set fetch time
- **Anon-set growth tracker** — coin-count / MB / fetch-time trended over time
- **Opt-in alerting** (Telegram / Discord / webhook) for red status, Spark / `setHash` mismatch, or lag spikes
- **Operator tooling** — "add / verify your server" flow + privacy-safe self-check page
- **Embed kits** — README + status-page snippets for the already-live `/api/badge` (and docs embeds)
- **Wallet scorecard** — short ranked table (Spark-consistent · anon-set ms/MB · tip lag · uptime %) for default-server review
- **One-click compare** — side-by-side Spark id, `setHash`, fetch MB/ms, and lag across 2–3 backends
- **Public Spark incident / transparency log** (e.g. `setHash` divergence windows)
- **Expand Developers docs** — deeper ElectrumX + Spark method examples beyond the live Developers tab (complements wallet SDKs; does not replace them)
- **Upstream contribution(s)** — at least one PR to Firo wallet/docs (e.g. Spark health-check script)
- **Sustainability + handover** — documented running cost, 6–12 month uptime commitment, runbook

**Acceptance:** Detail pages + 30-day charts live; scorecard + compare usable on the public site; alerting demonstrable within one poll cycle; ≥1 upstream PR opened/merged; handover doc + incident log published.

---

## Roadmap

```
Funding approved
   │
   ▼
Week 1  ── Milestone 1 · Always-on production ($1,000, prepaid)
   │        domain · VPS · MIT repo · full dashboard · anon-set health · durable history · API · forum thread
   │
Week 2  ─┐
Week 3  ─┴ Milestone 2 · Ops, decision tools & upstream ($1,000)
            detail pages · growth tracker · alerting · operator self-check · embeds
            wallet scorecard · one-click compare · incident log · ElectrumX/Spark docs
            upstream PR · handover

  ✔ Fully complete within 1 month of funding
```

---

## Budget ($2,000 total)

| Item | USD |
|------|-----|
| M1 — production engineering + deploy | 800 |
| M2 — ops, decision tools, alerting, upstream | 1,000 |
| Domain + VPS hosting (12 months) | 200 |
| **Total** | **2,000** |

Paid in FIRO at the exchange rate on approval. All work MIT licensed on GitHub.

---

## Quick acceptance checklist

- [ ] Public MIT repo + live domain (M1)
- [ ] All backends probed for height, lag, latency, Spark id, anon-set fetch health (M1)
- [ ] Public JSON API + durable history (M1)
- [ ] Per-backend detail pages + 30-day charts (M2)
- [ ] Anon-set growth tracker (M2)
- [ ] Opt-in alerting demonstrated (M2)
- [ ] ≥1 upstream PR + handover doc + incident log (M2)

---

## Sustainability & handover

Running cost is a single small VPS + domain, covered for 12 months by this grant. Because everything is MIT and documented, the monitor can be maintained or taken over by anyone — including the Firo team. A runbook and low-cost hosting profile ship in M2 so it outlives the grant.

---

## Updates & expiration

Milestone completion reports will be posted to the FCS proposal and the forum thread. If not fully funded within a reasonable window, the proposal can be withdrawn or revised; any escrowed funds are handled per FCS rules.

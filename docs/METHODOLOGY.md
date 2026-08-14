# Methodology

How Firo Spark Sync Monitor measures the public Electrum fleet.

## Privacy

Only public Electrum RPC methods are used:

| Method | Purpose |
|--------|---------|
| `server.version` | Reachability, software version |
| TLS handshake | Peer certificate expiry (`tls_valid_to`, `tls_days_left`) |
| `blockchain.headers.subscribe` | Chain tip height |
| `spark.getsparklatestcoinid` | Active Spark coin-group id |
| `spark.getsparkanonymityset` | Full anon-set fetch time, size, `setHash` |

No addresses, keys, transactions, or wallet traffic are sent or stored.

## Registry

Backends are a **curated list** in version control (`lib/probe.js` → `REGISTRY`). The monitor does not port-scan the internet.

## Reference tip

`reference` is the highest height reported by **at least two** backends (majority-safe). A single forked or misreporting host that is ahead cannot mark the whole fleet as lagging. If no pair agrees, fall back to the maximum height.

## Spark consensus

- `spark_consensus` — modal `spark.getsparklatestcoinid` across reachable backends  
- `spark_sethash_consensus` — modal anon-set `setHash` across successful full-set measurements  
- Per-host `spark_consistent` / `anonset.consistent` compare against those modes  

## Anon-set fetch health

On the always-on server (`server.js`):

- Full `spark.getsparkanonymityset` download per host  
- Sequential (one host at a time) so memory never buffers 6 × ~30 MB  
- ~45s budget per host; cadence ~5 minutes  
- Records wall time (`ms`), coins, bytes/MB, and `setHash`  

Production ([firostatus.com](https://firostatus.com/)) uses continuous live sweeps (`anonset_source: "live"`).

## Status colors

| Status | Meaning |
|--------|---------|
| **green** | Reachable; lag ≤ 2; Spark id present and matching; setHash matching when measured; probe RTT **not a fleet outlier**; TLS cert ≥ 14 days left |
| **yellow** | Lag &gt; 2, RTT outlier vs fleet, missing/mismatched Spark id, setHash mismatch, or TLS &lt; 14 days |
| **red** | Unreachable, lag &gt; 100, or TLS certificate **expired** |

`setHash` mismatch alone yields **yellow** even at lag 0 with matching Spark coin id. Per-host reasons appear in `endpoints[].status_reasons`.

## Probe RTT

`latency_ms` is stamped when tip height arrives (not when Spark id returns), so a slow `getsparklatestcoinid` does not inflate RTT. It is **secondary** and from this monitor’s region only — not a global user-device ranking.

**Yellow band (fleet-relative):** `max(5000, round(2.5 × median probe RTT))` ms. When the whole monitor region is slow, hosts are not all painted yellow. Exposed as `stats.probe_rtt_yellow_threshold_ms`.

## Durable history & uptime

Always-on path stores each light-poll snapshot in SQLite (`data/history.sqlite` via Node `node:sqlite`). Public `/api/history` reports `db: "data/history.sqlite"` (relative) — never absolute host paths.

**Uptime definition (strict):**  

```
uptime % = 100 × (samples with status = green) / (all samples in window)
```

Yellow and red samples count as down. Reported for fleet and per endpoint over **24h** and **7d** via `GET /api/history`. This is **not** a wallet-availability SLA; prefer `/api/ci` `spark_ok` for Spark health.

Session charts in the browser are separate (localStorage) and are labeled as session-only.

## CI gate (`/api/ci`)

| Field | Rule |
|-------|------|
| `spark_ok` | No red hosts; Spark coin id + setHash consistent |
| `ok` | `spark_ok` **and** `max_lag ≤ 2` |
| `notes` | Informational when `ok` but some hosts are ops-yellow |

HTTP **200** when `ok`, else **503**. Mild lag alone can yield `spark_ok: true` with `ok: false`. Badge text prefers **spark ok** over green-count.

## Operator self-check

`POST /api/check` runs the **light** probe only (version, headers, Spark coin id). It does not download the anonymity set. Private / loopback / metadata targets are rejected. Listing a host on the public board still requires a PR to `REGISTRY` in `lib/probe.js`.

## Alerting

The always-on process records fleet events (red host, Spark/`setHash` divergence, lag spike, TLS expiry) and can POST to Telegram or a generic webhook. Channels are env-only (see `.env.example`). `GET /api/alerts` never returns secrets.


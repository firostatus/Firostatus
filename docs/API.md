# Firo Spark Sync Monitor · JSON API

For Firo developers, wallet teams, Electrum operators, and tooling authors.

**Production:** [https://firostatus.com](https://firostatus.com/)  
Human guide: [Developers](https://firostatus.com/developers)  
Machine reference: [`/api/docs`](https://firostatus.com/api/docs) · verifier: [`/docs/VERIFY.md`](https://firostatus.com/docs/VERIFY.md)

## Routes

| Route | Purpose |
|-------|---------|
| `GET /api/status` | Full fleet snapshot |
| `GET /api/spark` | Compact Spark consensus |
| `GET /api/ci` | Pass or fail (HTTP 200 / 503) |
| `GET /api/docs` | Machine readable field glossary |
| `GET /api/badge` | SVG badge (prefers spark ok) |
| `GET /api/history` | Durable SQLite time series + 24h/7d uptime % |
| `GET /api/health` | Liveness (process uptime, sample_count; no filesystem paths) |

## How this relates to Electrumx / wallet SDKs

Wallet Electrum clients (and TypeScript / mobile SDKs) talk to **one host** and do real Spark sync for the user.

This API watches the **curated public fleet** and publishes tip freshness, Spark coin group agreement, `setHash` consistency, and full anon-set fetch cost (ms / MB / coins) ? so teams need not each re-download tens of MB just to compare backends.

**Complement, not a replacement.** See `meta.complements` and `meta.not_for` on `/api/status` and `/api/docs`.

### Not for

- In-wallet ?pick a server? UI
- Replacing a wallet Electrum / Spark SDK
- Ranking hosts by user-device RTT (probe RTT is from this monitor only)
- Authoritative chain state (full nodes remain authoritative)

## Flagship fields

Prefer these over height-only checks:

| Field | Why it matters |
|-------|----------------|
| `spark_consensus` / `endpoints[].spark_consistent` | Coin group agreement across the fleet |
| `spark_sethash_consensus` / `endpoints[].anonset.setHash` | Same anonymity set identity |
| `endpoints[].anonset.ms` / `.mb` / `.coins` | Mobile Spark sync cost |
| `endpoints[].lag` | Tip freshness vs majority-safe reference |
| `endpoints[].latency_ms` | Secondary probe RTT from this monitor only |
| `endpoints[].status_reasons` | Why yellow/red (ops vs Spark) |
| `endpoints[].tls_valid_to` / `tls_days_left` | Peer TLS certificate expiry |

## Durable history (`GET /api/history`)

Available on production ([firostatus.com](https://firostatus.com/)) and any always-on `server.js`. Not on limited serverless previews.

| Query | Default | Meaning |
|-------|---------|---------|
| `hours` | `168` (7d) | Lookback window for `points` (max 720) |
| `id` | all | Filter `points` to one registry id |
| `limit` | `3000` | Max points returned |

Uptime is **strict green %**: share of stored samples with `status=green` over 24h and 7d (fleet + per endpoint). Yellow/red count as down ? not a wallet SLA. Prefer `/api/ci` `spark_ok` for Spark health.

```bash
curl -sS https://firostatus.com/api/history \
  | jq '{storage, db, sample_count, recording_since, uptime_note, uptime}'

curl -sS 'https://firostatus.com/api/history?id=stackwallet&hours=24' \
  | jq '{uptime: .uptime.endpoints.stackwallet, n: (.points|length)}'
```

## Examples

### Fleet snapshot (Spark-focused)

```bash
curl -sS https://firostatus.com/api/status \
  | jq '{summary, spark_sethash_consensus, endpoints: [.endpoints[] | {name, lag, spark_consistent, anonset}]}'
```

### Compact consensus poll

```bash
curl -sS https://firostatus.com/api/spark \
  | jq '{checked_at, spark_consensus, spark_sethash_consensus, summary, inconsistent}'
```

### CI gate (fail on Spark-unhealthy fleet)

`/api/ci` returns HTTP **200** when `ok` is true, else **503**.

| Field | Meaning |
|-------|---------|
| `spark_ok` | No red hosts; Spark coin id + setHash consistent |
| `ok` | `spark_ok` **and** `max_lag ? 2` (green tip band) |
| `notes` | Ops-yellow context when `ok` is still true |
| `reasons` | Why `ok` is false |

```bash
curl -sS -f https://firostatus.com/api/ci \
  | jq '{ok, spark_ok, max_lag, yellow, notes, reasons, green, red}'
```

For Spark-only gates in CI, check `spark_ok` instead of relying on HTTP status / `ok`.

### GitHub Actions sketch

```yaml
- name: Firo Spark fleet healthy
  run: curl -sS -f https://firostatus.com/api/ci
```

### List inconsistent hosts

```bash
curl -sS https://firostatus.com/api/status \
  | jq '[.endpoints[]
      | select(.spark_consistent == false
          or (.anonset != null and .anonset.consistent == false))
      | {name, lag, spark_consistent, anonset}]'
```

### README badge

```markdown
[![Firo Spark fleet](https://firostatus.com/api/badge)](https://firostatus.com/)
```

## Privacy

Public Electrum methods only: `server.version`, `blockchain.headers.subscribe`, `spark.getsparklatestcoinid`, `spark.getsparkanonymityset`. No addresses, keys, transactions, or wallet traffic. CORS is open (`*`).

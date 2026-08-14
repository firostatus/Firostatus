# Verifier cheatsheet — FiroStatus

Live board: https://firostatus.com

## Gates that matter

| Check | Expect |
|-------|--------|
| `anonset_source` | `"live"` or `"live_refreshing"` (mid-sweep) — both mean always-on |
| `/api/ci` → `spark_ok` | `true` |
| `/api/ci` → `ok` | `true` when tip lag ≤ 2 |
| `/api/history` → `storage` | `"sqlite"` and growing `sample_count` |
| `/api/history` → `db` | relative `data/history.sqlite` (no absolute host paths) |

Yellow hosts can still mean **ops** (tip lag, probe RTT outlier vs fleet, TLS &lt;14d). That does **not** by itself fail `spark_ok`.

## Curls

```bash
curl -sS -f https://firostatus.com/api/ci | jq '{ok,spark_ok,max_lag,green,yellow,red,notes,reasons}'
curl -sS https://firostatus.com/api/spark | jq '{anonset_source,summary,spark_consensus,spark_sethash_consensus,stats}'
curl -sS https://firostatus.com/api/status | jq '{anonset_source,summary,stats:{max_lag,reachable,anonset_ms,anonset_mb,probe_rtt_yellow_threshold_ms}}'
curl -sS 'https://firostatus.com/api/history?hours=24' | jq '{storage,db,sample_count,recording_since,uptime_note,uptime:{fleet_pct_24h},cache}'
# Equivalent (default window): curl -sS https://firostatus.com/api/history | jq '{storage,db,sample_count,uptime:{fleet_pct_24h}}'
curl -sS https://firostatus.com/api/health | jq '{ok,node,history,summary}'
```

Badge: `![Spark](https://firostatus.com/api/badge)`

## Milestone 2 (ops)

```bash
curl -sS https://firostatus.com/api/alerts | jq '{configured,any,triggers}'
curl -sS -X POST https://firostatus.com/api/check \
  -H 'content-type: application/json' \
  -d '{"host":"electrumx.firo.org","port":50002}' \
  | jq '{ok,host,height,vs_fleet}'
node scripts/spark-health-check.js
```

UI: `/operators`, `/alerts`. Runbook: [`docs/HANDOVER.md`](HANDOVER.md).

## Hosting honesty

Production today is always-on Node behind the domain host (shared hosting with outbound Electrum `:50002` allowed). Prefer describing it as **always-on**, not necessarily a dedicated VPS, unless/until you migrate.

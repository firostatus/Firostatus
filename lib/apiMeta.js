// Shared API metadata for /api/status and /api/docs.
// Audience: Firo community, developers, operators, and tooling authors.

const API_META = {
  name: 'Firo Spark Sync Monitor',
  version: 1,
  purpose:
    'Shared fleet telemetry for public Firo Electrum backends: tip freshness, Spark coin group and setHash consistency, and anonymity set fetch health.',
  audience: ['firo_community', 'wallet_and_mobile_developers', 'electrum_operators', 'core_and_tooling'],
  complements:
    'Wallet Electrum clients talk to one host. This API watches the curated public fleet so the Firo community can share tip and Spark health without each app re downloading a full anon set for monitoring.',
  not_for: [
    'in_wallet_server_picker',
    'replace_wallet_electrum_or_spark_sdk',
    'user_device_rtt_ranking',
    'authoritative_chain_state',
  ],
  endpoints: {
    '/api/status': 'Full fleet snapshot with lag, Spark consistency, and anon set health.',
    '/api/spark': 'Compact Spark consensus and inconsistent endpoint ids.',
    '/api/ci': 'Pass or fail JSON (HTTP 200 when ok=true: spark_ok and max_lag≤2; else 503). Use spark_ok for Spark-only gates.',
    '/api/docs': 'Machine readable field reference and usage notes.',
    '/api/badge': 'Embeddable SVG fleet health badge (prefers spark ok over green-count).',
    '/api/health': 'Liveness: process uptime, last snapshot, sqlite sample_count (no filesystem paths).',
    '/api/history': 'Durable SQLite time series + 24h/7d uptime % (always-on server). Query: ?hours=&id=&limit=',
  },
  probes: [
    { method: 'server.version', why: 'reachability, TLS, software version, cert expiry' },
    { method: 'blockchain.headers.subscribe', why: 'height and lag vs majority safe fleet tip' },
    { method: 'spark.getsparklatestcoinid', why: 'active Spark coin group id, cross checked fleet wide' },
    {
      method: 'spark.getsparkanonymityset',
      why: 'full anon set fetch time, size (MB and coins), and setHash consistency',
    },
  ],
  privacy: 'No addresses, keys, transactions, or wallet traffic. Public Electrum methods only.',
  latency_note:
    'latency_ms is probe RTT from this monitor only. Secondary to lag and Spark consistency. Not user device RTT.',
}

const STATUS_FIELDS = {
  checked_at: 'ISO timestamp when light probes finished for this response',
  reference: 'Majority safe fleet tip height (highest height at least two backends agree on)',
  spark_consensus: 'Modal spark.getsparklatestcoinid across reachable backends',
  spark_sethash_consensus: 'Modal anon set setHash across measured backends',
  anonset_checked_at: 'When the last full anon set sweep finished',
  anonset_source: 'How anon set figures were produced (snapshot or live)',
  summary: '{ total, green, yellow, red } fleet counts',
  stats: 'Aggregates for lag, probe RTT, and anon set median ms / MB / coins',
  endpoints: 'Per backend rows (see endpoint_fields)',
  meta: 'Purpose, audience, probe methods, and status rules',
}

const ENDPOINT_FIELDS = {
  id: 'Stable registry id',
  name: 'Display name',
  operator: 'Operator label',
  used_by: 'Wallets known to ship or list this host (Campfire, Stack Wallet, Electrum-Firo, …)',
  host: 'Electrum TLS host',
  port: 'Electrum TLS port (usually 50002)',
  ok: 'Light probe succeeded',
  height: 'Reported chain tip',
  lag: 'Blocks behind fleet reference',
  latency_ms: 'Probe RTT from this monitor (secondary metric)',
  version: 'ElectrumX version string',
  tls_valid_to: 'Peer TLS certificate expiry (ISO), when available',
  tls_days_left: 'Whole days until tls_valid_to (negative if expired)',
  spark_latest_coin_id: 'Active Spark coin group id',
  spark_consistent: 'Whether spark_latest_coin_id matches spark_consensus',
  anonset: '{ ok, ms, coins, mb, setHash, group, consistent, error } or null if not measured yet',
  status: 'green | yellow | red from lag, Spark consistency, probe RTT, and TLS cert rules',
  error: 'Light probe error string if any',
}

const EXAMPLE_USES = [
  'Alert when a public backend has spark_consistent=false or anonset.consistent=false',
  'Triage whether a Spark sync issue is an app bug or a backend serving a slow or divergent set',
  'Compare anonset.mb and anonset.ms across operators before publishing recommended backends',
  'Embed /api/badge or poll /api/status and /api/ci for docs and status pages',
]

function docsPayload() {
  // Lazy require avoids circular import with probe.js consumers.
  let registry = []
  try {
    registry = require('./probe').REGISTRY.map((e) => ({
      id: e.id,
      name: e.name,
      host: e.host,
      port: e.port,
      operator: e.operator,
      used_by: e.used_by || [],
      detail: `/backend/${e.id}`,
    }))
  } catch {
    registry = []
  }
  return {
    ...API_META,
    status_fields: STATUS_FIELDS,
    endpoint_fields: ENDPOINT_FIELDS,
    example_uses: EXAMPLE_USES,
    registry,
    electrum_field_map: {
      'server.version': ['version', 'tls_valid_to', 'tls_days_left'],
      'blockchain.headers.subscribe': ['height', 'lag'],
      'spark.getsparklatestcoinid': ['spark_latest_coin_id', 'spark_consistent', 'spark_consensus'],
      'spark.getsparkanonymityset': [
        'anonset.ms',
        'anonset.mb',
        'anonset.coins',
        'anonset.setHash',
        'anonset.consistent',
        'spark_sethash_consensus',
      ],
    },
    deep_links: {
      overview: '/overview',
      spark: '/spark',
      backends: '/backends',
      developers: '/developers',
      roadmap: '/roadmap',
      about: '/about',
      backend_detail: '/backend/:id',
      badge: '/api/badge',
      ci: '/api/ci',
      history: '/api/history',
    },
    example_curl:
      'curl -sS https://firostatus.com/api/status | jq "{summary, spark_sethash_consensus, endpoints: [.endpoints[] | {name, lag, spark_consistent, anonset}]}"',
    live_status: '/api/status',
  }
}

function statusMeta() {
  return {
    purpose: API_META.purpose,
    audience: API_META.audience,
    complements: API_META.complements,
    not_for: API_META.not_for,
    docs: '/api/docs',
    spark: '/api/spark',
    ci: '/api/ci',
    latency_note: API_META.latency_note,
    probe_region: 'single region monitor host',
    probes: {
      light: ['server.version', 'blockchain.headers.subscribe', 'spark.getsparklatestcoinid'],
      heavy: ['spark.getsparkanonymityset'],
    },
    status_rules: {
      green_max_lag: 2,
      yellow_probe_rtt_ms: 'fleet-relative: max(5000, 2.5× median probe RTT)',
      red_lag: 100,
      yellow_tls_days_left: 14,
      red_tls_expired: true,
      note: 'green requires Spark coin id present and matching; setHash match when anonset measurement exists. setHash mismatch alone yields yellow even at lag 0. TLS cert <14 days → yellow; expired → red.',
    },
    history: {
      route: '/api/history',
      storage: 'sqlite on always-on server (data/history.sqlite)',
      uptime_definition: 'percent of samples with status=green (strict)',
    },
    vs_height_only: {
      height_only: ['ok', 'height', 'lag'],
      spark_extra: ['spark_latest_coin_id', 'spark_consistent', 'anonset.*', 'spark_sethash_consensus'],
    },
  }
}

function sparkSummary(snapshot) {
  const eps = snapshot.endpoints || []
  return {
    checked_at: snapshot.checked_at,
    anonset_checked_at: snapshot.anonset_checked_at,
    anonset_source: snapshot.anonset_source || null,
    reference: snapshot.reference,
    spark_consensus: snapshot.spark_consensus,
    spark_sethash_consensus: snapshot.spark_sethash_consensus,
    summary: snapshot.summary,
    stats: {
      max_lag: snapshot.stats && snapshot.stats.max_lag,
      anonset_ms: snapshot.stats && snapshot.stats.anonset_ms,
      anonset_mb: snapshot.stats && snapshot.stats.anonset_mb,
      anonset_coins: snapshot.stats && snapshot.stats.anonset_coins,
      anonset_slow: snapshot.stats && snapshot.stats.anonset_slow,
      reachable: snapshot.stats && snapshot.stats.reachable,
    },
    inconsistent: eps
      .filter((e) => e.spark_consistent === false || (e.anonset && e.anonset.consistent === false))
      .map((e) => e.id),
    meta: {
      purpose: 'Compact Spark fleet consensus for CI and docs',
      docs: '/api/docs',
      full: '/api/status',
    },
  }
}

function ciSummary(snapshot) {
  const eps = snapshot.endpoints || []
  const sm = snapshot.summary || { total: 0, green: 0, yellow: 0, red: 0 }
  const maxLag = (snapshot.stats && snapshot.stats.max_lag) || 0
  const warming = !!snapshot.polling || !eps.length
  const inconsistent = eps.some(
    (e) => e.spark_consistent === false || (e.anonset && e.anonset.consistent === false),
  )
  const sparkOk = !warming && !inconsistent && sm.red === 0
  // Strict gate: Spark-healthy AND tip within green lag band (≤2). Mild lag
  // alone yields ok=false with spark_ok=true — that is intentional.
  const ok = sparkOk && maxLag <= 2
  const reasons = []
  if (warming) reasons.push('fleet snapshot still warming up')
  if (sm.red > 0) reasons.push(`${sm.red} backend(s) red (unreachable or tip lag > 100)`)
  if (inconsistent) reasons.push('Spark coin id or setHash disagrees across the fleet')
  if (!warming && maxLag > 2) reasons.push(`max_lag=${maxLag} exceeds green band (≤2)`)
  const notes = []
  if (ok && sm.yellow > 0) {
    notes.push(
      `${sm.yellow} yellow (ops): tip lag / probe RTT outlier / TLS <14d — not a Spark gate failure; see status_reasons`,
    )
  }
  const st = snapshot.stats || {}
  if (st.probe_rtt_yellow_threshold_ms != null) {
    notes.push(`probe RTT yellow band <=${st.probe_rtt_yellow_threshold_ms}ms (fleet-relative)`)
  }
  return {
    ok,
    spark_ok: sparkOk,
    max_lag: maxLag,
    green: sm.green,
    yellow: sm.yellow,
    red: sm.red,
    total: sm.total,
    reasons: ok ? [] : reasons,
    notes,
    spark_consensus: snapshot.spark_consensus,
    spark_sethash_consensus: snapshot.spark_sethash_consensus,
    checked_at: snapshot.checked_at,
    anonset_source: snapshot.anonset_source || null,
    anonset_checked_at: snapshot.anonset_checked_at,
    meta: {
      purpose: 'Pass or fail fleet Spark health for CI and status pages',
      gates: {
        spark_ok: 'no red hosts; Spark coin id + setHash consistent',
        ok: 'spark_ok and max_lag ≤ 2 (green tip band)',
      },
      yellow_note:
        'Yellow is ops degradation (lag, RTT outlier vs fleet, TLS <14d). CI ok/spark_ok can still pass.',
      docs: '/api/docs',
      full: '/api/status',
    },
  }
}

module.exports = { API_META, docsPayload, statusMeta, sparkSummary, ciSummary }

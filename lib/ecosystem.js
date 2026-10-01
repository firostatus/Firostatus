// Ecosystem pulse — Names registry + digest beyond Electrum fleet probes.
// Privacy-safe: public explorer / optional local node RPC. No wallet scanning.
// Never invents "% FIRO in Spark" — amounts in Spark stay private.

const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')

const BLOCKS_PER_DAY = 576
const NAMES_URL = process.env.FIRO_NAMES_URL || 'https://explorer.firo.org/api/sparknames'
const EXPLORER_STATUS_URL =
  process.env.FIRO_EXPLORER_STATUS_URL || 'https://explorer.firo.org/insight-api-zcoin/status'
const FIRONAMES_ORIGIN = (process.env.FIRONAMES_ORIGIN || 'https://fironames.com').replace(/\/$/, '')
const FIRONAMES_LEDGER_URL = `${FIRONAMES_ORIGIN}/api/stats/ledger`
const FIRONAMES_EVENTS_URL = `${FIRONAMES_ORIGIN}/api/stats/events`
const FIRONAMES_HISTORY_URL = `${FIRONAMES_ORIGIN}/api/stats/history`
const FIRONAMES_HEALTH_URL = `${FIRONAMES_ORIGIN}/api/health`
const NOTICES_PATH = path.join(__dirname, '..', 'config', 'notices.json')

const cache = {
  names: null,
  namesAt: 0,
  explorer: null,
  explorerAt: 0,
  utxo: null,
  utxoAt: 0,
  fironames: null,
  fironamesAt: 0,
  localNode: null,
  localNodeAt: 0,
  rpcTip: null,
  rpcTipAt: 0,
  rpcCoinId: null,
  rpcCoinIdAt: 0,
}

const NAMES_TTL_MS = 15 * 60_000
const EXPLORER_TTL_MS = 2 * 60_000
const UTXO_TTL_MS = 6 * 60_000
const FIRONAMES_TTL_MS = 10 * 60_000
const LOCAL_NODE_TTL_MS = 60_000
const RPC_TIP_TTL_MS = 45_000

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { timeout: timeoutMs || 20_000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(raw))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

function rpcConfigured() {
  return Boolean(process.env.FIRO_RPC_URL && process.env.FIRO_RPC_USER && process.env.FIRO_RPC_PASSWORD)
}

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    if (!rpcConfigured()) {
      reject(new Error('rpc not configured'))
      return
    }
    let u
    try {
      u = new URL(process.env.FIRO_RPC_URL)
    } catch (e) {
      reject(e)
      return
    }
    const body = JSON.stringify({
      jsonrpc: '1.0',
      id: 'firostatus',
      method,
      params: params || [],
    })
    const auth = Buffer.from(
      `${process.env.FIRO_RPC_USER}:${process.env.FIRO_RPC_PASSWORD}`,
      'utf8',
    ).toString('base64')
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname || '/',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Basic ${auth}`,
        },
        timeout: 120_000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (j.error) reject(new Error(j.error.message || 'rpc error'))
            else resolve(j.result)
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('rpc timeout'))
    })
    req.write(body)
    req.end()
  })
}

function loadNotices() {
  try {
    if (!fs.existsSync(NOTICES_PATH)) return []
    const raw = JSON.parse(fs.readFileSync(NOTICES_PATH, 'utf8'))
    const list = Array.isArray(raw) ? raw : raw.notices || []
    const now = Date.now()
    return list
      .filter((n) => n && n.title && (!n.until || Date.parse(n.until) > now))
      .map((n) => ({
        id: n.id || null,
        level: n.level || 'info',
        title: String(n.title),
        body: n.body ? String(n.body) : '',
        href: n.href || null,
        until: n.until || null,
      }))
  } catch (e) {
    console.error('[ecosystem] notices read failed', e && e.message)
    return []
  }
}

function summarizeNames(rows, tipHeight) {
  const tip = Number(tipHeight) || 0
  const all = Array.isArray(rows) ? rows : []
  const active = []
  const expired = []
  const lengthHist = {}
  let short = 0
  let due7 = 0
  let due30 = 0
  let withInfo = 0
  const soon = []

  for (const row of all) {
    const name = row && row.name != null ? String(row.name) : ''
    if (!name) continue
    const validUntil = Number(row.validUntil)
    const L = Math.min(20, name.length)
    lengthHist[L] = (lengthHist[L] || 0) + 1
    const blocksLeft = Number.isFinite(validUntil) && tip ? validUntil - tip : null
    const isExpired = blocksLeft != null ? blocksLeft <= 0 : false
    const entry = {
      name,
      validUntil: Number.isFinite(validUntil) ? validUntil : null,
      blocksLeft,
      daysLeft:
        blocksLeft != null ? Math.max(0, Math.round(blocksLeft / BLOCKS_PER_DAY)) : null,
      hasAdditionalInfo: Boolean(row.additionalInfo && String(row.additionalInfo).trim()),
    }
    if (entry.hasAdditionalInfo) withInfo++
    if (isExpired) {
      expired.push(entry)
      continue
    }
    active.push(entry)
    if (L <= 5) short++
    if (blocksLeft != null && blocksLeft <= 7 * BLOCKS_PER_DAY) due7++
    if (blocksLeft != null && blocksLeft <= 30 * BLOCKS_PER_DAY) {
      due30++
      soon.push(entry)
    }
  }

  soon.sort((a, b) => (a.blocksLeft || 0) - (b.blocksLeft || 0))

  return {
    tip_height: tip || null,
    total: all.length,
    active: active.length,
    expired: expired.length,
    short_le5: short,
    due_7d: due7,
    due_30d: due30,
    with_additional_info: withInfo,
    length_histogram: lengthHist,
    expiring_soon: soon.slice(0, 24).map((n) => ({
      name: n.name,
      days_left: n.daysLeft,
      blocks_left: n.blocksLeft,
      valid_until: n.validUntil,
    })),
    methodology:
      'Public Spark Names registry fields only (name, validUntil, optional additionalInfo). No stealth balances.',
    source: NAMES_URL,
  }
}

async function refreshNames(force) {
  const now = Date.now()
  if (!force && cache.names && now - cache.namesAt < NAMES_TTL_MS) return cache.names
  let rpcTip = null
  let explorerRows = null
  let localRows = null
  let source = 'explorer'

  try {
    explorerRows = await fetchJson(NAMES_URL, 45_000)
  } catch (e) {
    console.error('[ecosystem] names fetch failed', e && e.message)
  }

  if (rpcConfigured()) {
    try {
      if (!cache.rpcTip || now - cache.rpcTipAt > RPC_TIP_TTL_MS) {
        cache.rpcTip = await rpcCall('getblockcount')
        cache.rpcTipAt = now
      }
      rpcTip = Number(cache.rpcTip) || null
      try {
        localRows = await rpcCall('getsparknames')
      } catch (e) {
        console.error('[ecosystem] local getsparknames failed', e && e.message)
      }
      if (!explorerRows && Array.isArray(localRows)) {
        source = 'local_rpc'
      }
      if (!cache.rpcCoinId || now - cache.rpcCoinIdAt > NAMES_TTL_MS) {
        try {
          cache.rpcCoinId = await rpcCall('getsparklatestcoinid')
          cache.rpcCoinIdAt = now
        } catch (_) {
          /* optional */
        }
      }
    } catch (e) {
      console.error('[ecosystem] rpc enrich failed', e && e.message)
    }
  }

  const rows = Array.isArray(explorerRows)
    ? explorerRows
    : Array.isArray(localRows)
      ? localRows
      : null
  if (!Array.isArray(explorerRows) && Array.isArray(localRows)) source = 'local_rpc'

  // Expiry math must use a tip aligned with the registry source.
  // Prefer explorer tip when names came from explorer (local RPC can lag a few blocks).
  let tip = null
  try {
    const st = await refreshExplorer(false)
    const exTip = st && st.blocks != null ? Number(st.blocks) : null
    if (source === 'explorer' && exTip != null) tip = exTip
    else if (rpcTip != null) tip = rpcTip
    else tip = exTip
  } catch (_) {
    tip = rpcTip
  }

  const summary = summarizeNames(rows || [], tip)
  summary.source = rows ? source : null
  summary.ok = Array.isArray(rows)
  summary.spark_coin_group = cache.rpcCoinId != null ? cache.rpcCoinId : null
  summary.checked_at = new Date().toISOString()

  const explorerCount = Array.isArray(explorerRows) ? explorerRows.length : null
  const localCount = Array.isArray(localRows) ? localRows.length : null
  let localActive = null
  if (Array.isArray(localRows) && tip != null) {
    localActive = summarizeNames(localRows, tip).active
  }
  summary.cross_check = {
    explorer_ok: Array.isArray(explorerRows),
    local_ok: Array.isArray(localRows),
    explorer_total: explorerCount,
    local_total: localCount,
    explorer_active: Array.isArray(explorerRows) ? summary.active : null,
    local_active: localActive,
    delta_total:
      explorerCount != null && localCount != null ? localCount - explorerCount : null,
    agree:
      explorerCount != null && localCount != null ? explorerCount === localCount : null,
    note:
      'Compares explorer.firo.org/api/sparknames vs local getsparknames. A small delta can mean tip lag or explorer delay.',
  }

  cache.names = summary
  cache.namesAt = now
  return summary
}

function formatHashrate(hps) {
  const n = Number(hps)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TH/s'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GH/s'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MH/s'
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' kH/s'
  return Math.round(n) + ' H/s'
}

async function refreshLocalNode(force) {
  if (!rpcConfigured()) {
    return {
      ok: false,
      available: false,
      note: 'Not configured (normal on firostatus.com). Ecosystem uses public explorer + fironames.com only.',
    }
  }
  const now = Date.now()
  if (!force && cache.localNode && now - cache.localNodeAt < LOCAL_NODE_TTL_MS) {
    return cache.localNode
  }
  const out = {
    ok: false,
    available: true,
    checked_at: new Date().toISOString(),
  }
  try {
    const [chain, net, mem, mine] = await Promise.all([
      rpcCall('getblockchaininfo').catch((e) => ({ __err: e && e.message })),
      rpcCall('getnetworkinfo').catch((e) => ({ __err: e && e.message })),
      rpcCall('getmempoolinfo').catch((e) => ({ __err: e && e.message })),
      rpcCall('getmininginfo').catch((e) => ({ __err: e && e.message })),
    ])

    if (chain && !chain.__err) {
      const blocks = chain.blocks != null ? Number(chain.blocks) : null
      const headers = chain.headers != null ? Number(chain.headers) : null
      out.sync = {
        chain: chain.chain || null,
        blocks,
        headers,
        headers_behind:
          blocks != null && headers != null ? Math.max(0, headers - blocks) : null,
        verification_progress:
          chain.verificationprogress != null ? Number(chain.verificationprogress) : null,
        pruned: !!chain.pruned,
        difficulty: chain.difficulty != null ? Number(chain.difficulty) : null,
        bestblockhash: chain.bestblockhash || null,
        mediantime: chain.mediantime != null ? Number(chain.mediantime) : null,
      }
      out.ok = true
    } else if (chain && chain.__err) {
      out.sync_error = chain.__err
    }

    if (net && !net.__err) {
      out.network = {
        version: net.version != null ? Number(net.version) : null,
        subversion: net.subversion || null,
        protocolversion: net.protocolversion != null ? Number(net.protocolversion) : null,
        connections: net.connections != null ? Number(net.connections) : null,
        networkactive: net.networkactive != null ? !!net.networkactive : null,
        relayfee: net.relayfee != null ? Number(net.relayfee) : null,
      }
      out.ok = true
    } else if (net && net.__err) {
      out.network_error = net.__err
    }

    if (mem && !mem.__err) {
      out.mempool = {
        size: mem.size != null ? Number(mem.size) : null,
        bytes: mem.bytes != null ? Number(mem.bytes) : null,
        usage: mem.usage != null ? Number(mem.usage) : null,
      }
      out.ok = true
    } else if (mem && mem.__err) {
      out.mempool_error = mem.__err
    }

    if (mine && !mine.__err) {
      const hps = mine.networkhashps != null ? Number(mine.networkhashps) : null
      out.mining = {
        networkhashps: hps,
        networkhashps_human: formatHashrate(hps),
        difficulty: mine.difficulty != null ? Number(mine.difficulty) : null,
        pooledtx: mine.pooledtx != null ? Number(mine.pooledtx) : null,
      }
      out.ok = true
    } else if (mine && mine.__err) {
      out.mining_error = mine.__err
    }
  } catch (e) {
    out.error = e && e.message
  }
  cache.localNode = out
  cache.localNodeAt = now
  return out
}

async function refreshExplorer(force) {
  const now = Date.now()
  if (!force && cache.explorer && now - cache.explorerAt < EXPLORER_TTL_MS) return cache.explorer
  try {
    const j = await fetchJson(EXPLORER_STATUS_URL, 15_000)
    const info = (j && j.info) || j || {}
    cache.explorer = {
      ok: true,
      blocks: info.blocks != null ? Number(info.blocks) : null,
      difficulty: info.difficulty != null ? Number(info.difficulty) : null,
      connections: info.connections != null ? Number(info.connections) : null,
      version: info.version != null ? Number(info.version) : null,
      network: info.network || null,
      source: EXPLORER_STATUS_URL,
      checked_at: new Date().toISOString(),
    }
  } catch (e) {
    cache.explorer = {
      ok: false,
      error: e && e.message,
      checked_at: new Date().toISOString(),
      source: EXPLORER_STATUS_URL,
    }
  }
  cache.explorerAt = now
  return cache.explorer
}

async function refreshUtxo(force) {
  if (!rpcConfigured()) {
    return {
      ok: false,
      available: false,
      note: 'Optional. Set FIRO_RPC_* to enable transparent UTXO snapshot from your node.',
    }
  }
  const now = Date.now()
  if (!force && cache.utxo && now - cache.utxoAt < UTXO_TTL_MS) return cache.utxo
  try {
    const r = await rpcCall('gettxoutsetinfo')
    // Firo gettxoutsetinfo total_amount has historically overcounted vs circulating
    // supply (privacy-protocol artifacts). Publish outs count; keep amount internal-only.
    cache.utxo = {
      ok: true,
      available: true,
      height: r.height,
      txouts: r.txouts,
      transactions: r.transactions,
      total_amount: r.total_amount,
      total_amount_public: false,
      bestblock: r.bestblock,
      checked_at: new Date().toISOString(),
      disclaimer:
        'UTXO outs from local gettxoutsetinfo. Do not treat total_amount as circulating supply or "% not in Spark". Firo RPC totals can overcount.',
    }
  } catch (e) {
    cache.utxo = {
      ok: false,
      available: true,
      error: e && e.message,
      checked_at: new Date().toISOString(),
    }
  }
  cache.utxoAt = now
  return cache.utxo
}

async function refreshFironames(force) {
  const now = Date.now()
  if (!force && cache.fironames && now - cache.fironamesAt < FIRONAMES_TTL_MS) {
    return cache.fironames
  }
  const out = {
    ok: false,
    origin: FIRONAMES_ORIGIN,
    checked_at: new Date().toISOString(),
  }
  try {
    const [ledger, events, history, health] = await Promise.all([
      fetchJson(FIRONAMES_LEDGER_URL, 25_000).catch((e) => ({ __err: e && e.message })),
      fetchJson(FIRONAMES_EVENTS_URL, 20_000).catch((e) => ({ __err: e && e.message })),
      fetchJson(FIRONAMES_HISTORY_URL, 20_000).catch((e) => ({ __err: e && e.message })),
      fetchJson(FIRONAMES_HEALTH_URL, 10_000).catch((e) => ({ __err: e && e.message })),
    ])

    if (ledger && !ledger.__err && ledger.ok !== false) {
      out.ledger = {
        tip_height: ledger.tipHeight != null ? Number(ledger.tipHeight) : null,
        total: ledger.total != null ? Number(ledger.total) : null,
        active: ledger.active != null ? Number(ledger.active) : null,
        expired: ledger.expired != null ? Number(ledger.expired) : null,
        ever: ledger.ever != null ? Number(ledger.ever) : null,
        peak_active: ledger.peakActive != null ? Number(ledger.peakActive) : null,
        peak_day: ledger.peakDay || null,
        monthly: Array.isArray(ledger.monthly) ? ledger.monthly.slice(-6) : [],
      }
      out.ok = true
    } else if (ledger && ledger.__err) {
      out.ledger_error = ledger.__err
    }

    if (events && !events.__err && Array.isArray(events.events)) {
      out.events = events.events.slice(0, 12).map((e) => ({
        type: e.t || e.type || null,
        name: e.name || null,
        height: e.height != null ? Number(e.height) : null,
      }))
      out.events_tip = events.tipHeight != null ? Number(events.tipHeight) : null
      out.ok = true
    } else if (events && events.__err) {
      out.events_error = events.__err
    }

    if (history && !history.__err && Array.isArray(history.points) && history.points.length) {
      const latest = history.points[history.points.length - 1]
      out.history_latest = {
        day: latest.day || null,
        tip_height: latest.tipHeight != null ? Number(latest.tipHeight) : null,
        total: latest.total != null ? Number(latest.total) : null,
        active: latest.active != null ? Number(latest.active) : null,
        expired: latest.expired != null ? Number(latest.expired) : null,
        short_count: latest.shortCount != null ? Number(latest.shortCount) : null,
        source: latest.source || null,
      }
      out.history_days = history.days != null ? Number(history.days) : null
      out.ok = true
    } else if (history && history.__err) {
      out.history_error = history.__err
    }

    if (health && !health.__err) {
      out.health = {
        ok: !!health.ok,
        service: health.service || null,
        claims_db: !!health.claims_db,
        members_db: !!health.members_db,
        smtp: !!(health.smtp && health.smtp.enabled),
      }
      out.ok = out.ok || !!health.ok
    } else if (health && health.__err) {
      out.health_error = health.__err
    }
  } catch (e) {
    out.error = e && e.message
  }
  cache.fironames = out
  cache.fironamesAt = now
  return out
}

function buildDigest(snapshot, names, explorer, utxo, fironames, localNode) {
  const sm = (snapshot && snapshot.summary) || { total: 0, green: 0, yellow: 0, red: 0 }
  const st = (snapshot && snapshot.stats) || {}
  const eps = (snapshot && snapshot.endpoints) || []
  // Same gate as /api/ci (avoids digest inventing a second spark_ok definition).
  const { ciSummary } = require('./apiMeta')
  const ci = snapshot ? ciSummary(snapshot) : { spark_ok: false }
  const sparkOk = !!ci.spark_ok

  let worst = null
  for (const e of eps) {
    const a = e.anonset
    if (a && a.ok && a.ms != null) {
      if (!worst || a.ms > worst.ms) worst = { name: e.name, ms: a.ms, mb: a.mb }
    }
  }
  const tlsWarn = eps
    .filter((e) => e.tls_days_left != null && e.tls_days_left < 30)
    .map((e) => ({ name: e.name, days: e.tls_days_left }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 5)

  const lines = []
  lines.push('FiroStatus weekly digest')
  lines.push(
    `Fleet: ${sm.green}g / ${sm.yellow}y / ${sm.red}r of ${sm.total} | spark_ok=${sparkOk}`,
  )
  if (st.max_lag != null) lines.push(`Max tip lag: ${st.max_lag} blocks`)
  if (st.anonset_ms != null) lines.push(`Median anon-set fetch: ${Math.round(st.anonset_ms)} ms`)
  if (worst) lines.push(`Slowest anon-set: ${worst.name} | ${Math.round(worst.ms)} ms`)
  if (snapshot && snapshot.spark_sethash_consensus) {
    lines.push(`setHash consensus: ${String(snapshot.spark_sethash_consensus).slice(0, 16)}...`)
  }
  if (names && names.ok) {
    lines.push(
      `Spark Names (live registry): ${names.active} active | ${names.due_30d} due <=30d | ${names.short_le5} short (<=5)`,
    )
  }
  if (names && names.cross_check && names.cross_check.local_ok && names.cross_check.explorer_ok) {
    const cc = names.cross_check
    const status = cc.agree ? 'match' : `delta ${cc.delta_total > 0 ? '+' : ''}${cc.delta_total}`
    lines.push(
      `Names cross-check: explorer ${cc.explorer_total} | local node ${cc.local_total} (${status})`,
    )
  }
  if (fironames && fironames.ok && fironames.ledger) {
    const L = fironames.ledger
    const peak =
      L.peak_active != null
        ? ` | peak ${L.peak_active}${L.peak_day ? ' on ' + L.peak_day : ''}`
        : ''
    lines.push(
      `fironames.com ledger: ${L.active != null ? L.active : '?'} active / ${L.expired != null ? L.expired : '?'} expired | ever ${L.ever != null ? L.ever : '?'}${peak}`,
    )
  }
  if (explorer && explorer.ok && explorer.blocks != null) {
    lines.push(`Explorer tip: ${explorer.blocks}`)
  }
  if (localNode && localNode.ok && localNode.sync) {
    const s = localNode.sync
    const n = localNode.network || {}
    const m = localNode.mining || {}
    const mp = localNode.mempool || {}
    const syncPct =
      s.verification_progress != null
        ? (Number(s.verification_progress) * 100).toFixed(2) + '%'
        : null
    lines.push(
      `Local node: tip ${s.blocks != null ? s.blocks : '?'}${
        syncPct ? ' | sync ' + syncPct : ''
      }${n.connections != null ? ' | peers ' + n.connections : ''}${
        m.networkhashps_human ? ' | hashrate ~' + m.networkhashps_human : ''
      }${mp.size != null ? ' | mempool ' + mp.size + ' tx' : ''}`,
    )
  }
  if (utxo && utxo.ok && utxo.txouts != null) {
    lines.push(
      `Transparent UTXO outs: ${utxo.txouts} (local node; amount omitted, not circulating supply)`,
    )
  }
  if (tlsWarn.length) {
    lines.push('TLS <30d: ' + tlsWarn.map((t) => `${t.name} ${t.days}d`).join(', '))
  }
  lines.push('Board: https://firostatus.com | Names: https://fironames.com')
  lines.push('No "% supply in Spark". Amounts stay private.')

  return {
    generated_at: new Date().toISOString(),
    spark_ok: sparkOk,
    fleet: sm,
    text: lines.join('\n'),
    forum_markdown:
      '**FiroStatus digest**\n\n```\n' +
      lines.join('\n') +
      '\n```\n\n' +
      '[firostatus.com](https://firostatus.com) | [fironames.com](https://fironames.com)',
  }
}

async function ecosystemPayload(snapshot) {
  const [names, explorer, utxo, fironames, localNode] = await Promise.all([
    refreshNames(false),
    refreshExplorer(false),
    refreshUtxo(false),
    refreshFironames(false),
    refreshLocalNode(false),
  ])
  const notices = loadNotices()
  const digest = buildDigest(snapshot, names, explorer, utxo, fironames, localNode)
  return {
    checked_at: new Date().toISOString(),
    notices,
    names,
    fironames,
    chain: {
      explorer,
      local_rpc: rpcConfigured(),
      local_node: localNode,
      spark_coin_group: names.spark_coin_group,
      transparent_utxo: utxo,
    },
    digest,
    links: {
      fironames: FIRONAMES_ORIGIN,
      fironames_stats: `${FIRONAMES_ORIGIN}/stats`,
      fironames_directory: `${FIRONAMES_ORIGIN}/directory`,
      fironames_ledger: FIRONAMES_LEDGER_URL,
      fironames_events: FIRONAMES_EVENTS_URL,
      sparknames_marketing: 'https://sparknames.firo.org/',
      explorer_names: NAMES_URL,
      board: process.env.PUBLIC_ORIGIN || 'https://firostatus.com',
    },
    disclaimers: [
      'Spark coin amounts are private; this board never claims % of supply locked in Spark.',
      'Live Names counts prefer explorer.firo.org/api/sparknames. fironames.com ledger/history/events may lag the live tip.',
      ...(localNode && localNode.ok
        ? [
            'Local getsparknames is used for explorer-vs-local cross-check (and as fallback). Local node sync / peers / mempool / hashrate come from FIRO_RPC_*. UTXO total_amount is not shown as supply (can overcount on Firo).',
          ]
        : []),
    ],
  }
}

function digestPayload(snapshot) {
  return ecosystemPayload(snapshot).then((eco) => eco.digest)
}

function kickBackgroundRefresh() {
  refreshNames(true).catch(() => {})
  refreshExplorer(true).catch(() => {})
  refreshFironames(true).catch(() => {})
  if (rpcConfigured()) {
    refreshLocalNode(true).catch(() => {})
    setTimeout(() => refreshUtxo(true).catch(() => {}), 5_000)
  }
}

module.exports = {
  ecosystemPayload,
  digestPayload,
  loadNotices,
  kickBackgroundRefresh,
  refreshNames,
  refreshFironames,
  refreshLocalNode,
}

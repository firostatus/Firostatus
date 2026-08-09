/* Firo Spark Sync Monitor — charts + ops visual enhance (Chart.js CDN) */
(function (global) {
  'use strict'

  var charts = {}
  var COLORS = {
    green: '#3fa66a',
    yellow: '#d4a017',
    red: '#d64545',
    ember: '#e85d2a',
    ember2: '#f0a35a',
    cyan: '#5eb8b0',
    muted: '#9a9186',
    grid: 'rgba(46,41,36,.85)',
    text: '#f2ebe3',
  }
  var PALETTE = ['#e85d2a', '#5eb8b0', '#d4a017', '#3fa66a', '#c47a9a', '#7aa2c4', '#d64545', '#f0a35a']

  function destroy(id) {
    if (charts[id]) {
      try { charts[id].destroy() } catch (e) {}
      delete charts[id]
    }
  }

  function chartReady() {
    return typeof global.Chart !== 'undefined'
  }

  function baseOpts(yTitle) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { color: COLORS.muted, boxWidth: 10, font: { family: "'IBM Plex Mono', monospace", size: 10 } },
        },
        tooltip: {
          backgroundColor: '#1c1916',
          titleColor: COLORS.text,
          bodyColor: COLORS.muted,
          borderColor: '#2e2924',
          borderWidth: 1,
          titleFont: { family: "'IBM Plex Sans', sans-serif", size: 12 },
          bodyFont: { family: "'IBM Plex Mono', monospace", size: 11 },
        },
      },
      scales: {
        x: {
          ticks: { color: COLORS.muted, maxTicksLimit: 8, font: { family: "'IBM Plex Mono', monospace", size: 9 } },
          grid: { color: COLORS.grid },
        },
        y: {
          beginAtZero: true,
          title: yTitle ? { display: true, text: yTitle, color: COLORS.muted, font: { family: "'IBM Plex Mono', monospace", size: 10 } } : undefined,
          ticks: { color: COLORS.muted, font: { family: "'IBM Plex Mono', monospace", size: 9 } },
          grid: { color: COLORS.grid },
        },
      },
    }
  }

  function labelTime(iso) {
    if (!iso) return ''
    var d = new Date(iso)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function emptyBox(el, title, sub, href) {
    if (!el) return
    var canvas = el.querySelector('canvas')
    if (canvas) canvas.style.display = 'none'
    el.querySelectorAll('.empty, .chart-loading').forEach(function (n) { n.remove() })
    var d = document.createElement('div')
    d.className = 'empty'
    d.innerHTML =
      '<div class="empty-t">' + title + '</div>' +
      '<div class="empty-s">' + sub + '</div>' +
      (href ? '<a class="tbtn" href="' + href + '">Open ' + (href.replace(/^\//,'') || 'page') + '</a>' : '')
    el.appendChild(d)
  }

  function loadingBox(el, title, sub) {
    if (!el) return
    var canvas = el.querySelector('canvas')
    if (canvas) canvas.style.display = 'none'
    el.querySelectorAll('.empty, .chart-loading').forEach(function (n) { n.remove() })
    var d = document.createElement('div')
    d.className = 'chart-loading'
    d.setAttribute('role', 'status')
    d.innerHTML =
      '<span class="spin"></span>' +
      '<div><div class="empty-t">' + (title || 'Loading chart…') + '</div>' +
      '<div class="empty-s">' + (sub || 'Please wait while SQLite history loads.') + '</div></div>'
    el.appendChild(d)
  }

  function clearEmpty(el) {
    if (!el) return
    el.querySelectorAll('.empty, .chart-loading').forEach(function (n) { n.remove() })
    var canvas = el.querySelector('canvas')
    if (canvas) canvas.style.display = ''
  }

  var DETAIL_CHART_IDS = [
    'd-hist-lag', 'd-hist-rtt', 'd-hist-anon', 'd-hist-mb', 'd-hist-tls',
    'd-hist-height', 'd-hist-coins', 'd-hist-spark', 'd-hist-sparkid',
  ]

  function setDetailChartsLoading(msg, sub) {
    DETAIL_CHART_IDS.forEach(function (cid) {
      var c = document.getElementById(cid)
      if (!c || !c.parentElement) return
      loadingBox(c.parentElement, msg || 'Loading history…', sub || 'Fetching /api/history — first load can take a few seconds.')
    })
    var note = document.getElementById('d-hist-load')
    if (note) {
      note.style.display = ''
      note.innerHTML = '<span class="spin"></span><span>' + (msg || 'Loading durable history — please wait…') + '</span>'
    }
  }

  function clearDetailChartsLoadingNote() {
    var note = document.getElementById('d-hist-load')
    if (note) note.style.display = 'none'
  }

  function renderSeverity(s) {
    var strip = document.getElementById('sevstrip')
    var meta = document.getElementById('sevmeta')
    if (!strip || !meta) return
    var sm = (s && s.summary) || { green: 0, yellow: 0, red: 0, total: 0 }
    var g = sm.green || 0, y = sm.yellow || 0, r = sm.red || 0
    var tot = Math.max(1, g + y + r)
    strip.innerHTML =
      '<i style="flex:' + g + ';background:var(--green)"></i>' +
      '<i style="flex:' + y + ';background:var(--yellow)"></i>' +
      '<i style="flex:' + r + ';background:var(--red)"></i>'
    meta.textContent =
      g + 'g · ' + y + 'y · ' + r + 'r · tip ' + (s && s.reference != null ? Number(s.reference).toLocaleString() : '—') +
      (s && s.anonset_source ? ' · ' + s.anonset_source : '')
  }

  function renderTlsStrip(s) {
    var el = document.getElementById('tls-strip')
    if (!el) return
    var eps = ((s && s.endpoints) || []).slice().sort(function (a, b) {
      var da = a.tls_days_left == null ? 1e9 : a.tls_days_left
      var db = b.tls_days_left == null ? 1e9 : b.tls_days_left
      return da - db
    })
    if (!eps.length) {
      el.innerHTML = '<div class="empty-s">Waiting for TLS probes…</div>'
      return
    }
    el.innerHTML = eps
      .map(function (e) {
        var d = e.tls_days_left
        var cls = d == null ? 'tls-unk' : d < 0 ? 'tls-bad' : d < 14 ? 'tls-warn' : 'tls-ok'
        var lab = d == null ? '—' : d < 0 ? 'exp' : d + 'd'
        return (
          '<a class="tls-cell ' + cls + '" href="/backend/' + encodeURIComponent(e.id) + '" title="' +
          esc(e.name || e.id) + (e.tls_valid_to ? ' · ' + esc(e.tls_valid_to) : '') + '">' +
          '<span class="tls-n">' + esc(e.name || e.id) + '</span><span class="tls-d">' + lab + '</span></a>'
        )
      })
      .join('')
  }

  function percentile(arr, p) {
    var a = arr.filter(function (v) { return v != null && !isNaN(v) }).slice().sort(function (x, y) { return x - y })
    if (!a.length) return null
    var idx = Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))
    return a[idx]
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  function msFmt(n) {
    if (n == null) return '—'
    return n >= 1000 ? (n / 1000).toFixed(1) + 's' : Math.round(n) + ' ms'
  }

  /** Fleet-relative slow band: >1.75× median (floor 20s). Avoids fake “unreliable” at 15s when fleet median is ~30s. */
  function slowThresholdMs(s, hist) {
    var vals = []
    ;((s && s.endpoints) || []).forEach(function (e) {
      if (e.anonset && e.anonset.ok && e.anonset.ms != null) vals.push(e.anonset.ms)
    })
    if (vals.length < 2 && hist && hist.points) {
      hist.points.forEach(function (p) { if (p.anonset_ms != null) vals.push(p.anonset_ms) })
    }
    var med = percentile(vals, 0.5)
    if (med == null) return 45000
    return Math.max(20000, Math.round(med * 1.75))
  }

  function isAnonSlow(ms, thresh) {
    return ms != null && ms > thresh
  }

  function derive(s, hist) {
    var eps = (s && s.endpoints) || []
    var thresh = slowThresholdMs(s, hist)
    var slowShare = 0
    var slowN = 0
    var tipOk = 0, sparkOk = 0, hashOk = 0, hashN = 0, tipN = 0, sparkN = 0
    var usable = []
    var reliable = []
    var worstMs = null, worstName = null
    var tlsVals = []
    eps.forEach(function (e) {
      var a = e.anonset
      if (e.lag != null) { tipN++; if (e.lag <= 2) tipOk++ }
      if (e.spark_consistent != null) { sparkN++; if (e.spark_consistent) sparkOk++ }
      if (a && a.ok) {
        hashN++
        if (a.consistent) hashOk++
        slowN++
        if (isAnonSlow(a.ms, thresh)) slowShare++
        if (a.ms != null && (worstMs == null || a.ms > worstMs)) { worstMs = a.ms; worstName = e.name }
      }
      if (e.tls_days_left != null) tlsVals.push(e.tls_days_left)
      var syncReady =
        (e.lag == null || e.lag <= 2) &&
        e.spark_consistent !== false &&
        (!a || (a.ok && a.consistent !== false && !isAnonSlow(a.ms, thresh)))
      if (syncReady) usable.push(e)
      var up = hist && hist.uptime && hist.uptime.endpoints && hist.uptime.endpoints[e.id]
      // Reliable = sync-safe default candidate. Fetch time uses relative band, not a fake 15s absolute.
      var rel =
        e.status === 'green' &&
        e.spark_consistent !== false &&
        a && a.ok && a.consistent === true &&
        !isAnonSlow(a.ms, thresh) &&
        (e.tls_days_left == null || e.tls_days_left >= 14) &&
        (up == null || up.pct_24h == null || up.pct_24h >= 95)
      if (rel) reliable.push(e)
    })
    var agreeParts = []
    if (tipN) agreeParts.push(tipOk / tipN)
    if (sparkN) agreeParts.push(sparkOk / sparkN)
    if (hashN) agreeParts.push(hashOk / hashN)
    var agreement = agreeParts.length
      ? Math.round(100 * agreeParts.reduce(function (a, b) { return a + b }, 0) / agreeParts.length)
      : null

    var hashBad = eps.some(function (e) { return e.anonset && e.anonset.consistent === false })
    var sparkBad = eps.some(function (e) { return e.spark_consistent === false })
    var maxLag = (s && s.stats && s.stats.max_lag) || 0
    var risk = Math.min(100, Math.round(
      (hashBad ? 40 : 0) +
      (sparkBad ? 25 : 0) +
      15 * Math.min(1, maxLag / 20) +
      10 * Math.min(1, slowN ? slowShare / slowN : 0) +
      (tlsVals.some(function (d) { return d < 14 }) ? 10 : 0)
    ))
    var riskLabel = risk >= 60 ? 'HIGH' : risk >= 30 ? 'WATCH' : 'LOW'
    var riskCls = risk >= 60 ? 'risk-hi' : risk >= 30 ? 'risk-mid' : 'risk-lo'

    var anonVals = []
    ;((hist && hist.points) || []).forEach(function (p) {
      if (p.anonset_ms != null) anonVals.push(p.anonset_ms)
    })
    var p50 = percentile(anonVals, 0.5)
    var p95 = percentile(anonVals, 0.95)

    var mbOk = eps.filter(function (e) { return e.anonset && e.anonset.ok && e.anonset.consistent && e.anonset.mb != null })
    var mbMin = null, mbMax = null
    mbOk.forEach(function (e) {
      if (mbMin == null || e.anonset.mb < mbMin) mbMin = e.anonset.mb
      if (mbMax == null || e.anonset.mb > mbMax) mbMax = e.anonset.mb
    })

    reliable.sort(function (a, b) { return (a.anonset.ms || 1e9) - (b.anonset.ms || 1e9) })
    var fastestRel = reliable[0] || null

    var wins = (hist && hist.events && hist.events.sethash) || []
    var dayAgo = Date.now() - 24 * 3600e3
    var wins24 = wins.filter(function (w) { return new Date(w.end || w.start).getTime() >= dayAgo })
    var open = wins.filter(function (w) {
      return Math.abs(new Date(w.end).getTime() - new Date(w.start).getTime()) < 120000 &&
        Date.now() - new Date(w.end).getTime() < 10 * 60e3
    })
    // treat last window as "recent" if ends within 15 min
    var last = wins.length ? wins[wins.length - 1] : null

    return {
      usable: usable.length,
      total: eps.length,
      slowThreshMs: thresh,
      worstMs: worstMs,
      worstName: worstName,
      agreement: agreement,
      agreeTip: tipN ? tipOk + '/' + tipN : '—',
      agreeSpark: sparkN ? sparkOk + '/' + sparkN : '—',
      agreeHash: hashN ? hashOk + '/' + hashN : '—',
      risk: risk,
      riskLabel: riskLabel,
      riskCls: riskCls,
      p50: p50,
      p95: p95,
      mbMin: mbMin,
      mbMax: mbMax,
      fastestRel: fastestRel,
      tlsWorst: tlsVals.length ? Math.min.apply(null, tlsVals) : null,
      wins24: wins24.length,
      winsTotal: wins.length,
      lastWin: last,
      openHint: open.length,
    }
  }

  function pill(html) { return '<div class="statpill">' + html + '</div>' }

  function renderAnalytics(s, hist) {
    var d = derive(s, hist)
    var ov = document.getElementById('ov-analytics')
    if (ov) {
      ov.innerHTML =
        pill('<div class="sv ' + d.riskCls + '">' + d.risk + ' · ' + d.riskLabel + '</div><div class="sl">Spark sync risk</div><div class="ss">0–100 · higher = worse</div>') +
        pill('<div class="sv">' + (d.agreement != null ? d.agreement + '%' : '—') + '</div><div class="sl">Fleet agreement</div><div class="ss">tip ' + d.agreeTip + ' · spark ' + d.agreeSpark + ' · hash ' + d.agreeHash + '</div>') +
        pill('<div class="sv">' + d.usable + ' / ' + d.total + '</div><div class="sl">Spark-usable now</div><div class="ss">lag≤2 · set OK · not slower than ' + (d.slowThreshMs / 1000).toFixed(0) + 's band</div>') +
        pill('<div class="sv">' + msFmt(d.worstMs) + '</div><div class="sl">Worst anon-set</div><div class="ss">' + esc(d.worstName || '—') + '</div>') +
        pill('<div class="sv">' + (d.tlsWorst == null ? '—' : d.tlsWorst + 'd') + '</div><div class="sl">Worst TLS left</div><div class="ss">renew if &lt;14d</div>') +
        pill('<div class="sv">' + (d.mbMin != null && d.mbMax != null ? d.mbMin + '–' + d.mbMax : '—') + '</div><div class="sl">MB spread</div><div class="ss">same setHash · MB</div>')
    }
    var sp = document.getElementById('spark-analytics')
    if (sp) {
      var thrBest = null, thrName = null
      ;((s && s.endpoints) || []).forEach(function (e) {
        var a = e.anonset
        if (a && a.ok && a.ms > 0 && a.mb != null && a.consistent) {
          var t = a.mb / (a.ms / 1000)
          if (thrBest == null || t > thrBest) { thrBest = t; thrName = e.name }
        }
      })
      sp.innerHTML =
        pill('<div class="sv">' + msFmt(d.p50) + '</div><div class="sl">Anon-set p50</div><div class="ss">history window</div>') +
        pill('<div class="sv">' + msFmt(d.p95) + '</div><div class="sl">Anon-set p95</div><div class="ss">tail sync cost</div>') +
        pill('<div class="sv">' + (d.mbMin != null && d.mbMax != null ? d.mbMin + '–' + d.mbMax : '—') + '</div><div class="sl">Same-setHash MB</div><div class="ss">encoding efficiency spread</div>') +
        pill('<div class="sv">' + (thrBest != null ? thrBest.toFixed(2) + ' MB/s' : '—') + '</div><div class="sl">Best throughput</div><div class="ss">' + esc(thrName || '—') + '</div>') +
        pill('<div class="sv">' + d.wins24 + '</div><div class="sl">setHash windows 24h</div><div class="ss">' + d.winsTotal + ' total stored</div>') +
        pill('<div class="sv">' + d.usable + '/' + d.total + '</div><div class="sl">Spark-usable</div><div class="ss">live status</div>')
    }
    var ab = document.getElementById('about-fleet-now')
    if (ab && s && s.summary) {
      ab.innerHTML =
        pill('<div class="sv">' + (s.summary.green || 0) + '/' + (s.summary.total || 0) + '</div><div class="sl">Healthy now</div><div class="ss"><a class="blink" href="/overview">Overview</a></div>') +
        pill('<div class="sv">' + msFmt(s.stats && s.stats.anonset_ms) + '</div><div class="sl">Median anon-set</div><div class="ss"><a class="blink" href="/spark">Spark health</a></div>') +
        pill('<div class="sv">' + (s.spark_sethash_consensus ? String(s.spark_sethash_consensus).slice(0, 10) + '…' : '—') + '</div><div class="sl">setHash consensus</div><div class="ss">truncated</div>') +
        pill('<div class="sv ' + d.riskCls + '">' + d.riskLabel + '</div><div class="sl">Sync risk</div><div class="ss">score ' + d.risk + '</div>')
    }
    var dv = document.getElementById('dev-analytics')
    if (dv) {
      var sparkOk = !(s && s.endpoints || []).some(function (e) {
        return e.spark_consistent === false || (e.anonset && e.anonset.consistent === false)
      }) && !(s && s.summary && s.summary.red)
      var tipOk = sparkOk && s && s.stats && (s.stats.max_lag == null || s.stats.max_lag <= 2)
      dv.innerHTML =
        pill('<div class="sv" style="color:' + (sparkOk ? 'var(--green)' : 'var(--red)') + '">' + (sparkOk ? 'true' : 'false') + '</div><div class="sl">spark_ok</div><div class="ss">live derived</div>') +
        pill('<div class="sv" style="color:' + (tipOk ? 'var(--green)' : 'var(--yellow)') + '">' + (tipOk ? 'true' : 'false') + '</div><div class="sl">ok (CI)</div><div class="ss">max_lag ' + (s && s.stats ? s.stats.max_lag : '—') + '</div>') +
        pill('<div class="sv">' + ((hist && hist.fleet) ? hist.fleet.length : 0) + '</div><div class="sl">fleet samples</div><div class="ss">/api/history</div>') +
        pill('<div class="sv">' + ((hist && hist.events && hist.events.sethash) ? hist.events.sethash.length : 0) + '</div><div class="sl">setHash events</div><div class="ss">divergence windows</div>')
    }
    renderSethashIncidents(hist)
    renderScorecard(s, hist, d)
    return d
  }

  function renderSethashIncidents(hist) {
    var stats = document.getElementById('sh-inc-stats')
    var rows = document.getElementById('sh-inc-rows')
    var meta = document.getElementById('sh-inc-meta')
    if (!stats || !rows) return
    var wins = (hist && hist.events && hist.events.sethash) || []
    if (!wins.length) {
      if (meta) meta.textContent = 'no divergence windows yet'
      stats.innerHTML = pill('<div class="sv risk-lo">0</div><div class="sl">Windows 24h</div><div class="ss">fleet agrees on setHash</div>')
      rows.innerHTML = '<div class="empty"><div class="empty-t">No setHash splits recorded</div><div class="empty-s">When backends disagree, windows appear here and on Spark health.</div></div>'
      return
    }
    var d = derive(global.S, hist)
    if (meta) meta.textContent = wins.length + ' window(s) stored'
    stats.innerHTML =
      pill('<div class="sv">' + d.wins24 + '</div><div class="sl">Windows · 24h</div><div class="ss">setHash diverge</div>') +
      pill('<div class="sv">' + wins.length + '</div><div class="sl">Total windows</div><div class="ss">in history query</div>') +
      pill('<div class="sv">' + (d.lastWin ? labelTime(d.lastWin.end || d.lastWin.start) : '—') + '</div><div class="sl">Last window end</div><div class="ss">' + esc((d.lastWin && d.lastWin.ids || []).join(', ')) + '</div>')
    rows.innerHTML =
      '<table class="minitable"><thead><tr><th>Start</th><th>End</th><th>Backends</th><th>Consensus</th></tr></thead><tbody>' +
      wins.slice().reverse().slice(0, 6).map(function (w) {
        return '<tr><td class="mono">' + labelTime(w.start) + '</td><td class="mono">' + labelTime(w.end) +
          '</td><td>' + esc((w.ids || []).join(', ')) + '</td><td class="mono">' + esc(w.consensus_short || '—') + '…</td></tr>'
      }).join('') +
      '</tbody></table>'
  }

  function renderScorecard(s, hist, d) {
    var tb = document.getElementById('scorecard-rows')
    if (!tb) return
    var eps = ((s && s.endpoints) || []).slice()
    if (!eps.length) { tb.innerHTML = '<tr><td colspan="8" style="color:var(--muted)">Waiting…</td></tr>'; return }
    eps.sort(function (a, b) {
      var ra = a.status === 'red' ? 0 : a.status === 'yellow' ? 1 : 2
      var rb = b.status === 'red' ? 0 : b.status === 'yellow' ? 1 : 2
      if (ra !== rb) return ra - rb
      return ((a.anonset && a.anonset.ms) || 1e9) - ((b.anonset && b.anonset.ms) || 1e9)
    })
    tb.innerHTML = eps.map(function (e) {
      var a = e.anonset
      var up = hist && hist.uptime && hist.uptime.endpoints && hist.uptime.endpoints[e.id]
      var rel =
        e.status === 'green' &&
        e.spark_consistent !== false &&
        a && a.ok && a.consistent === true &&
        !isAnonSlow(a.ms, d.slowThreshMs) &&
        (e.tls_days_left == null || e.tls_days_left >= 14) &&
        (up == null || up.pct_24h == null || up.pct_24h >= 95)
      var tip = e.lag == null ? '—' : e.lag + ' blk'
      return '<tr>' +
        '<td><a class="blink name" href="/backend/' + e.id + '">' + esc(e.name) + '</a></td>' +
        '<td class="mono">' + tip + '</td>' +
        '<td class="mono">' + (e.spark_consistent === true ? '<span class="ok">✓</span>' : e.spark_consistent === false ? '<span class="bad">✗</span>' : '—') + '</td>' +
        '<td class="mono">' + (a && a.consistent === true ? '<span class="ok">✓</span>' : a && a.consistent === false ? '<span class="bad">✗</span>' : '—') + '</td>' +
        '<td class="mono">' + (a && a.ok ? msFmt(a.ms) : '—') + '</td>' +
        '<td class="mono">' + (up && up.pct_24h != null ? Number(up.pct_24h).toFixed(1) + '%' : '—') + '</td>' +
        '<td class="mono">' + (e.tls_days_left == null ? '—' : e.tls_days_left + 'd') + '</td>' +
        '<td class="mono">' + (rel ? '<span class="ok">yes</span>' : '<span class="warnc">no</span>') + '</td>' +
        '</tr>'
    }).join('')
  }

  function renderTimeline(s, hist) {
    var ol = document.getElementById('status-timeline')
    var meta = document.getElementById('tl-meta')
    if (!ol) return
    var events = []
    var session = (global.H && global.H.points) || []
    for (var i = 1; i < session.length; i++) {
      var prev = session[i - 1], cur = session[i]
      if (!prev.ep || !cur.ep) continue
      Object.keys(cur.ep).forEach(function (id) {
        // status not in session hist — use lag jumps / missing
        var a = prev.ep[id], b = cur.ep[id]
        if (!a || !b) return
        if (a.lag != null && b.lag != null && Math.abs(b.lag - a.lag) >= 3) {
          events.push({ t: cur.t, name: id, tag: 'lag', detail: a.lag + ' → ' + b.lag + ' blk' })
        }
      })
    }
    var sh = hist && hist.events && hist.events.sethash
    if (sh && sh.length) {
      sh.slice(-8).forEach(function (w) {
        events.push({
          t: w.end || w.start,
          name: (w.ids || []).join(', '),
          tag: 'setHash',
          detail: 'diverge vs ' + (w.consensus_short || 'consensus') + '…',
        })
      })
    }
    if (s && s.endpoints) {
      s.endpoints.forEach(function (e) {
        if (e.tls_days_left != null && e.tls_days_left < 14) {
          events.push({
            t: s.checked_at,
            name: e.name,
            tag: e.tls_days_left < 0 ? 'TLS expired' : 'TLS <14d',
            detail: (e.tls_days_left < 0 ? 'expired' : e.tls_days_left + ' days left'),
          })
        }
        if (e.spark_consistent === false) {
          events.push({ t: s.checked_at, name: e.name, tag: 'Spark id', detail: 'differs from consensus' })
        }
        if (e.anonset && e.anonset.consistent === false) {
          events.push({ t: s.checked_at, name: e.name, tag: 'setHash', detail: 'anon-set mismatch' })
        }
      })
    }
    events.sort(function (a, b) { return new Date(b.t) - new Date(a.t) })
    events = events.slice(0, 12)
    if (meta) meta.textContent = events.length ? 'session + durable' : 'watching…'
    if (!events.length) {
      ol.innerHTML = '<li class="evt-empty">No status changes yet — keep the always-on server running to build a timeline.</li>'
      return
    }
    var nameOf = {}
    ;((s && s.endpoints) || []).forEach(function (e) { nameOf[e.id] = e.name })
    ol.innerHTML = events
      .map(function (ev) {
        var bad = /expired|setHash|Spark/i.test(ev.tag)
        var nm = String(ev.name || '')
          .split(', ')
          .map(function (part) { return nameOf[part] || part })
          .join(', ')
        return (
          '<li><span class="t">' + labelTime(ev.t) + '</span>' +
          '<span><b>' + esc(nm) + '</b> · ' + esc(ev.detail) + '</span>' +
          '<span class="tag' + (bad ? ' bad' : '') + '">' + esc(ev.tag) + '</span></li>'
        )
      })
      .join('')
  }

  function groupPoints(points, field) {
    var byId = {}
    ;(points || []).forEach(function (p) {
      if (!byId[p.id]) byId[p.id] = []
      byId[p.id].push(p)
    })
    return byId
  }

  function paintLagChart(hist, s) {
    var wrap = document.getElementById('chart-lag-wrap')
    var canvas = document.getElementById('chart-lag')
    if (!wrap || !canvas) return
    var box = wrap.querySelector('.chart-box') || wrap
    if (!chartReady()) {
      loadingBox(box, 'Loading chart…', 'Chart.js still downloading — durable series will paint next.')
      setTimeout(function () { paintLagChart(hist, s) }, 400)
      return
    }
    var pts = (hist && hist.points) || []
    if (!pts.length) {
      destroy('lag')
      emptyBox(box, 'No lag history yet', 'SQLite samples appear after the always-on server records probes.', '/developers')
      return
    }
    clearEmpty(box)
    var byId = groupPoints(pts)
    var labels = []
    var labelSet = {}
    pts.forEach(function (p) {
      if (!labelSet[p.t]) {
        labelSet[p.t] = true
        labels.push(p.t)
      }
    })
    labels.sort()
    // downsample labels if huge
    if (labels.length > 80) {
      var step = Math.ceil(labels.length / 80)
      labels = labels.filter(function (_, i) { return i % step === 0 })
    }
    var nameOf = {}
    ;((s && s.endpoints) || []).forEach(function (e) { nameOf[e.id] = e.name })
    var datasets = Object.keys(byId).map(function (id, i) {
      var map = {}
      byId[id].forEach(function (p) { map[p.t] = p.lag })
      return {
        label: nameOf[id] || id,
        data: labels.map(function (t) { return map[t] != null ? map[t] : null }),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.15,
        spanGaps: true,
      }
    })
    destroy('lag')
    charts.lag = new global.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: labels.map(labelTime), datasets: datasets },
      options: baseOpts('blocks behind tip'),
    })
  }

  function paintFleetChart(hist) {
    var canvas = document.getElementById('chart-fleet')
    var wrap = document.getElementById('chart-fleet-wrap')
    if (!canvas || !wrap) return
    var box = wrap.querySelector('.chart-box') || wrap
    if (!chartReady()) {
      loadingBox(box, 'Loading chart…', 'Chart.js still downloading — fleet mix will paint next.')
      setTimeout(function () { paintFleetChart(hist) }, 400)
      return
    }
    var fleet = (hist && hist.fleet) || []
    if (!fleet.length) {
      destroy('fleet')
      emptyBox(box, 'No durable fleet series yet', 'fleet_summary rows appear each poll on the always-on server.', '/developers')
      return
    }
    if (fleet.length > 100) {
      var step = Math.ceil(fleet.length / 100)
      fleet = fleet.filter(function (_, i) { return i % step === 0 })
    }
    clearEmpty(box)
    destroy('fleet')
    charts.fleet = new global.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: fleet.map(function (f) { return labelTime(f.t) }),
        datasets: [
          { label: 'green', data: fleet.map(function (f) { return f.green }), borderColor: COLORS.green, backgroundColor: 'rgba(63,166,106,.12)', fill: true, borderWidth: 1.5, pointRadius: 0, tension: 0.2 },
          { label: 'yellow', data: fleet.map(function (f) { return f.yellow }), borderColor: COLORS.yellow, backgroundColor: 'rgba(212,160,23,.12)', fill: true, borderWidth: 1.5, pointRadius: 0, tension: 0.2 },
          { label: 'red', data: fleet.map(function (f) { return f.red }), borderColor: COLORS.red, backgroundColor: 'rgba(214,69,69,.12)', fill: true, borderWidth: 1.5, pointRadius: 0, tension: 0.2 },
        ],
      },
      options: Object.assign(baseOpts('backends'), {
        scales: Object.assign(baseOpts().scales, {
          y: Object.assign(baseOpts().scales.y, { stacked: true }),
        }),
      }),
    })
  }

  function paintAnonsetOn(canvasId, wrapId, chartKey, hist, s) {
    var canvas = document.getElementById(canvasId)
    var wrap = document.getElementById(wrapId)
    if (!canvas || !wrap) return
    var box = wrap.querySelector('.chart-box') || wrap
    if (!chartReady()) {
      loadingBox(box, 'Loading chart…', 'Chart.js still downloading — anon-set series will paint next.')
      setTimeout(function () { paintAnonsetOn(canvasId, wrapId, chartKey, hist, s) }, 400)
      return
    }
    var pts = ((hist && hist.points) || []).filter(function (p) { return p.anonset_ms != null })
    if (!pts.length) {
      destroy(chartKey)
      emptyBox(box, 'No anon-set time series yet', 'Heavy sweeps run about every 5 minutes on always-on hosts.', '/spark')
      return
    }
    clearEmpty(box)
    var byId = groupPoints(pts)
    var labels = []
    var seen = {}
    pts.forEach(function (p) {
      if (!seen[p.t]) { seen[p.t] = true; labels.push(p.t) }
    })
    labels.sort()
    if (labels.length > 60) {
      var step = Math.ceil(labels.length / 60)
      labels = labels.filter(function (_, i) { return i % step === 0 })
    }
    var nameOf = {}
    ;((s && s.endpoints) || []).forEach(function (e) { nameOf[e.id] = e.name })
    var datasets = Object.keys(byId).map(function (id, i) {
      var map = {}
      byId[id].forEach(function (p) { map[p.t] = p.anonset_ms != null ? p.anonset_ms / 1000 : null })
      return {
        label: nameOf[id] || id,
        data: labels.map(function (t) { return map[t] != null ? map[t] : null }),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.15,
        spanGaps: true,
      }
    })
    var slowS = slowThresholdMs(s, hist) / 1000
    datasets.push({
      label: 'slow band (~' + slowS.toFixed(0) + 's)',
      data: labels.map(function () { return slowS }),
      borderColor: 'rgba(212,160,23,.55)',
      borderDash: [4, 4],
      borderWidth: 1,
      pointRadius: 0,
      fill: false,
    })
    destroy(chartKey)
    charts[chartKey] = new global.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: labels.map(labelTime), datasets: datasets },
      options: baseOpts('anon-set fetch (s)'),
    })
    var hint = document.querySelector('#' + wrapId + ' .chart-slow-hint, [data-anon-slow-hint]')
    if (hint) hint.textContent = 'seconds · dashed = fleet slow band (~' + slowS.toFixed(0) + 's · 1.75× median)'
  }

  function paintAnonsetChart(hist, s) {
    paintAnonsetOn('chart-anonset', 'chart-anonset-wrap', 'anonset', hist, s)
    paintAnonsetOn('chart-anonset-ov', 'chart-anonset-ov-wrap', 'anonsetOv', hist, s)
  }

  function paintGrowthChart(hist) {
    var canvas = document.getElementById('chart-growth')
    var wrap = document.getElementById('chart-growth-wrap')
    if (!canvas || !wrap) return
    var box = wrap.querySelector('.chart-box') || wrap
    if (!chartReady()) {
      setTimeout(function () { paintGrowthChart(hist) }, 400)
      return
    }
    var pts = ((hist && hist.points) || []).filter(function (p) { return p.anonset_coins != null || p.anonset_mb != null })
    if (!pts.length) {
      destroy('growth')
      emptyBox(box, 'No growth series yet', 'Coins/MB appear after anon-set sweeps land in SQLite.', '/spark')
      return
    }
    var byT = {}
    pts.forEach(function (p) {
      if (!byT[p.t]) byT[p.t] = { coins: [], mb: [] }
      if (p.anonset_coins != null) byT[p.t].coins.push(p.anonset_coins)
      if (p.anonset_mb != null) byT[p.t].mb.push(p.anonset_mb)
    })
    var labels = Object.keys(byT).sort()
    if (labels.length > 80) {
      var step = Math.ceil(labels.length / 80)
      labels = labels.filter(function (_, i) { return i % step === 0 })
    }
    function med(arr) {
      if (!arr.length) return null
      var a = arr.slice().sort(function (x, y) { return x - y })
      return a[Math.floor(a.length / 2)]
    }
    clearEmpty(box)
    destroy('growth')
    charts.growth = new global.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels.map(labelTime),
        datasets: [
          {
            label: 'median coins',
            data: labels.map(function (t) { return med(byT[t].coins) }),
            borderColor: COLORS.ember2,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            yAxisID: 'y',
            tension: 0.15,
            spanGaps: true,
          },
          {
            label: 'median MB',
            data: labels.map(function (t) { return med(byT[t].mb) }),
            borderColor: COLORS.cyan,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            yAxisID: 'y1',
            tension: 0.15,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: baseOpts().plugins,
        scales: {
          x: baseOpts().scales.x,
          y: Object.assign({}, baseOpts('coins').scales.y, { position: 'left' }),
          y1: Object.assign({}, baseOpts('MB').scales.y, { position: 'right', grid: { drawOnChartArea: false } }),
        },
      },
    })
  }

  function failReasons(e) {
    if (!e) return ['unknown']
    if (e.status_reasons && e.status_reasons.length) {
      var extra = []
      if (e.anonset && e.anonset.ok && isAnonSlow(e.anonset.ms, slowThresholdMs(global.S, global.HistAPI))) {
        extra.push('slow anon-set (vs fleet)')
      }
      return e.status_reasons.concat(extra)
    }
    var reasons = []
    if (e.height == null || e.status === 'red') {
      if (e.error) reasons.push(e.error.indexOf('timeout') >= 0 ? 'timeout' : 'unreachable / ' + e.error)
      else if (e.tls_days_left != null && e.tls_days_left < 0) reasons.push('TLS expired')
      else if (e.lag != null && e.lag > 100) reasons.push('far behind tip')
      else reasons.push('unreachable')
    }
    if (e.lag != null && e.lag > 2 && e.lag <= 100) reasons.push('tip lag')
    var rttBand = global.S && global.S.stats && global.S.stats.probe_rtt_yellow_threshold_ms
    if (e.latency_ms != null && rttBand != null && e.latency_ms > rttBand) reasons.push('probe RTT outlier')
    if (e.spark_consistent === false) reasons.push('Spark id mismatch')
    if (e.spark_latest_coin_id == null && e.height != null) reasons.push('missing Spark id')
    if (e.anonset) {
      if (e.anonset.consistent === false) reasons.push('setHash mismatch')
      if (!e.anonset.ok) reasons.push('anon-set fail' + (e.anonset.error ? ': ' + e.anonset.error : ''))
      else if (isAnonSlow(e.anonset.ms, slowThresholdMs(global.S, global.HistAPI))) reasons.push('slow anon-set (vs fleet)')
    }
    if (e.tls_days_left != null && e.tls_days_left >= 0 && e.tls_days_left < 14) reasons.push('TLS <14d')
    return reasons.length ? reasons : (e.status === 'green' ? ['healthy'] : ['degraded'])
  }

  /** Structured diagnose card for yellow/red hosts (wallet vs operator guidance). */
  function diagnose(e, s) {
    var reasons = failReasons(e)
    var primary = reasons[0] || 'degraded'
    var cause = 'This host is marked ' + (e.status || 'unknown') + ' by the monitor rules.'
    var wallet = [
      'If Spark sync stalls, prefer a host with Spark+setHash agreement on the scorecard (CI spark_ok can PASS even when some hosts are ops-yellow).',
      'Campfire: clear ElectrumX cache in Settings if you used the same seed in two wallets.',
    ]
    var operator = [
      'Confirm ElectrumX can reach a synced firod with Spark indexes.',
      'Check TLS cert on port 50002 and that spark.* RPCs are enabled.',
    ]
    var rawParts = []
    if (e.error) rawParts.push('error: ' + e.error)
    if (e.lag != null) rawParts.push('lag: ' + e.lag)
    if (e.latency_ms != null) rawParts.push('rtt_ms: ' + e.latency_ms)
    if (e.spark_latest_coin_id != null) rawParts.push('spark_id: ' + e.spark_latest_coin_id)
    if (e.spark_consistent === false) rawParts.push('spark_consistent: false')
    if (e.anonset) {
      rawParts.push('anonset_ok: ' + !!e.anonset.ok)
      if (e.anonset.ms != null) rawParts.push('anonset_ms: ' + e.anonset.ms)
      if (e.anonset.error) rawParts.push('anonset_error: ' + e.anonset.error)
      if (e.anonset.consistent === false) rawParts.push('setHash_consistent: false')
    }
    if (e.tls_days_left != null) rawParts.push('tls_days_left: ' + e.tls_days_left)

    if (/timeout|unreachable/i.test(primary)) {
      cause = 'Light Electrum probe failed — host did not return tip/version in time from this monitor region.'
      wallet = ['Switch wallet Electrum server to a green Core or community host.', 'Retry after a minute; single-region timeouts can be transient.']
      operator = ['Check firewall / TLS on 50002.', 'Confirm ElectrumX process is up and not CPU-starved.', 'Verify firod RPC/indexer is healthy behind ElectrumX.']
    } else if (/far behind|tip lag/i.test(primary)) {
      cause = 'Chain tip lag is outside the green band (≤2 blocks behind fleet reference).'
      wallet = ['Avoid this host for default sync until lag returns to ≤2.', 'Prefer a host with lag 0 on the Backends table.']
      operator = ['Sync firod to tip.', 'Check ElectrumX catch-up / reorg handling.', 'Ensure disk I/O is not stalling header updates.']
    } else if (/setHash/i.test(primary)) {
      cause = 'This host serves a different Spark anon-set fingerprint than fleet consensus — tip can still look fine.'
      wallet = ['Do not treat tip-OK as Spark-OK.', 'Switch to a host with setHash ✓ before retrying Spark sync.', 'Clear ElectrumX cache if the wallet already partially synced a divergent set.']
      operator = ['Rebuild / resync Spark anonymity-set indexes from a trusted tip.', 'Confirm electrumx and firod Spark versions match peers.', 'Compare spark.getsparkanonymityset setHash vs fleet consensus.']
    } else if (/Spark id/i.test(primary) || /missing Spark/i.test(primary)) {
      cause = 'Active Spark coin-group id is missing or disagrees with fleet consensus.'
      wallet = ['Spark features may fail or show empty state on this host.', 'Pick a host with matching Spark id on Overview.']
      operator = ['Ensure spark.getsparklatestcoinid works on ElectrumX.', 'Confirm firod Spark is enabled and indexed.']
    } else if (/slow anon-set/i.test(primary) || /anon-set fail/i.test(primary)) {
      cause = 'Full Spark anonymity-set fetch is slow vs the fleet band, or failed — the usual mobile Spark sync stall.'
      wallet = ['Expect long Spark sync or timeouts on mobile data.', 'Prefer a faster ranked host on the Spark health tab.']
      operator = ['Profile spark.getsparkanonymityset latency and bandwidth.', 'Check compression, disk cache, and concurrent load.', 'Compare MB served vs peers for the same setHash.']
    } else if (/TLS/i.test(primary)) {
      cause = e.tls_days_left != null && e.tls_days_left < 0
        ? 'Peer TLS certificate is expired — wallets using TLS 50002 will fail.'
        : 'TLS certificate expires in under 14 days.'
      wallet = ['If connects fail with cert errors, switch host until the operator renews.']
      operator = ['Renew the certificate on port 50002 promptly.', 'Verify full chain is served to clients.']
    } else if (/slow RTT/i.test(primary)) {
      cause = 'Light probe RTT from this monitor exceeded 3s (secondary signal — not user-device RTT).'
      wallet = ['Prefer hosts that are green on lag + Spark; RTT alone is secondary.']
      operator = ['Check network path and ElectrumX load from public internet.']
    }

    var host = e.host || 'HOST'
    var port = e.port || 50002
    var reproduce =
      "# Privacy-safe Electrum JSON-RPC over TLS (OpenSSL)\n" +
      "openssl s_client -quiet -connect " + host + ":" + port + " <<'EOF'\n" +
      JSON.stringify({ id: 1, method: 'server.version', params: ['firo-spark-monitor', '1.4'] }) + "\n" +
      JSON.stringify({ id: 2, method: 'blockchain.headers.subscribe', params: [] }) + "\n" +
      JSON.stringify({ id: 3, method: 'spark.getsparklatestcoinid', params: [] }) + "\n" +
      "EOF\n" +
      "# Or via monitor API:\n" +
      "curl -sS " + (typeof location !== 'undefined' ? location.origin : '') + "/api/status | jq '.endpoints[] | select(.id==\"" + e.id + "\")'"

    return {
      id: e.id,
      name: e.name,
      status: e.status,
      primary: primary,
      reasons: reasons,
      cause: cause,
      wallet: wallet,
      operator: operator,
      used_by: e.used_by || [],
      raw: rawParts.join('\n') || '(no extra fields)',
      reproduce: reproduce,
      consensus: s && s.spark_sethash_consensus ? String(s.spark_sethash_consensus) : null,
    }
  }

  function fleetMedian(s, key, anon) {
    var vals = []
    ;((s && s.endpoints) || []).forEach(function (e) {
      if (anon) {
        if (e.anonset && e.anonset.ok && e.anonset[key] != null) vals.push(e.anonset[key])
      } else if (e[key] != null) vals.push(e[key])
    })
    return percentile(vals, 0.5)
  }

  function paintStatusRibbon(pts) {
    var el = document.getElementById('d-status-ribbon')
    if (!el) return
    if (!pts.length) {
      el.innerHTML = '<div class="empty-s">No status history yet</div>'
      return
    }
    // downsample to ~120 segments
    var step = Math.max(1, Math.ceil(pts.length / 120))
    var html = ''
    for (var i = 0; i < pts.length; i += step) {
      var st = pts[i].status || 'unknown'
      var col = st === 'green' ? 'var(--green)' : st === 'yellow' ? 'var(--yellow)' : st === 'red' ? 'var(--red)' : 'var(--muted)'
      html += '<i title="' + esc(pts[i].t) + ' · ' + st + '" style="flex:1;background:' + col + '"></i>'
    }
    el.innerHTML = html
  }

  function paintDetailCharts(id, hist) {
    // Live compare/stats must run even when history is missing (preview / cold start).
    var pts = (hist && hist.points) ? hist.points.filter(function (p) { return p.id === id }) : []
    paintStatusRibbon(pts)

    var p50el = document.getElementById('d-host-p50')
    var p95el = document.getElementById('d-host-p95')
    var thrEl = document.getElementById('d-host-thr')
    var anonMs = pts.map(function (p) { return p.anonset_ms }).filter(function (v) { return v != null })
    var p50 = percentile(anonMs, 0.5)
    var p95 = percentile(anonMs, 0.95)
    if (p50el) p50el.textContent = msFmt(p50)
    if (p95el) p95el.textContent = msFmt(p95)

    var e = ((global.S && global.S.endpoints) || []).filter(function (x) { return x.id === id })[0]
    if (thrEl && e && e.anonset && e.anonset.ok && e.anonset.ms > 0 && e.anonset.mb != null) {
      thrEl.textContent = (e.anonset.mb / (e.anonset.ms / 1000)).toFixed(2) + ' MB/s'
    } else if (thrEl) thrEl.textContent = '—'

    var cmp = document.getElementById('d-fleet-compare')
    if (cmp && e && global.S) {
      var fLag = fleetMedian(global.S, 'lag', false)
      var fAnon = fleetMedian(global.S, 'ms', true)
      var dLag = e.lag != null && fLag != null ? (e.lag - fLag) : null
      var dAnon = e.anonset && e.anonset.ok && fAnon != null ? (e.anonset.ms - fAnon) : null
      var thrTxt = '—'
      if (e.anonset && e.anonset.ok && e.anonset.ms > 0 && e.anonset.mb != null) {
        thrTxt = (e.anonset.mb / (e.anonset.ms / 1000)).toFixed(2) + ' MB/s'
      }
      cmp.innerHTML =
        pill('<div class="sv">' + (e.lag == null ? '—' : e.lag + ' blk') + '</div><div class="sl">Host lag</div><div class="ss">fleet p50 ' + (fLag == null ? '—' : fLag + ' blk') + (dLag == null ? '' : ' · Δ ' + (dLag >= 0 ? '+' : '') + dLag) + '</div>') +
        pill('<div class="sv">' + msFmt(e.anonset && e.anonset.ok ? e.anonset.ms : null) + '</div><div class="sl">Host anon-set</div><div class="ss">fleet p50 ' + msFmt(fAnon) + (dAnon == null ? '' : ' · Δ ' + (dAnon >= 0 ? '+' : '') + (Math.abs(dAnon) / 1000).toFixed(1) + 's') + '</div>') +
        pill('<div class="sv">' + msFmt(p95) + '</div><div class="sl">Host p95 anon</div><div class="ss">history window</div>') +
        pill('<div class="sv">' + thrTxt + '</div><div class="sl">Throughput</div><div class="ss">MB / fetch seconds</div>')
    }

    if (!chartReady()) {
      setDetailChartsLoading('Loading chart library…', 'Chart.js is still downloading — charts will paint when ready.')
      setTimeout(function () {
        if (global.curDetail !== id) return
        paintDetailCharts(id, hist)
      }, 400)
      return
    }
    if (!pts.length) {
      clearDetailChartsLoadingNote()
      DETAIL_CHART_IDS.forEach(function (cid) {
        var c = document.getElementById(cid)
        if (!c) return
        var box = c.parentElement
        if (box) emptyBox(box, 'No durable history yet', 'SQLite samples appear after the always-on server records probes for this host.', '/developers')
      })
      return
    }
    clearDetailChartsLoadingNote()

    function line(canvasId, key, label, color, scale, transform) {
      var canvas = document.getElementById(canvasId)
      if (!canvas) return
      var box = canvas.parentElement
      var vals = pts.map(function (p) {
        var v = p[key]
        if (v == null) return null
        if (transform) return transform(v)
        return scale ? v / scale : v
      })
      if (!vals.some(function (v) { return v != null })) {
        if (box) emptyBox(box, 'No ' + label + ' samples', 'This series was null for the history window.', '/backends')
        return
      }
      clearEmpty(box)
      destroy(canvasId)
      charts[canvasId] = new global.Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: pts.map(function (p) { return labelTime(p.t) }),
          datasets: [{
            label: label,
            data: vals,
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.15,
            spanGaps: true,
            stepped: transform ? true : false,
          }],
        },
        options: baseOpts(label),
      })
    }
    line('d-hist-lag', 'lag', 'lag (blk)', COLORS.ember2)
    line('d-hist-rtt', 'latency_ms', 'RTT (ms)', COLORS.cyan)
    line('d-hist-anon', 'anonset_ms', 'anon-set (s)', COLORS.yellow, 1000)
    line('d-hist-mb', 'anonset_mb', 'anon-set MB', COLORS.green)
    line('d-hist-tls', 'tls_days_left', 'TLS days', COLORS.ember)
    line('d-hist-height', 'height', 'height', COLORS.ember2)
    line('d-hist-coins', 'anonset_coins', 'anon-set coins', COLORS.cyan)
    line('d-hist-spark', 'spark_consistent', 'spark consistent', COLORS.green, null, function (v) { return v ? 1 : 0 })
    line('d-hist-sparkid', 'spark_id', 'spark coin id', COLORS.ember2)
  }

  function paintSethashList(hist) {
    var el = document.getElementById('sethash-events')
    if (!el) return
    var wins = (hist && hist.events && hist.events.sethash) || []
    if (!wins.length) {
      el.innerHTML = '<div class="empty"><div class="empty-t">No setHash divergence windows</div><div class="empty-s">When backends disagree on the anon-set fingerprint, windows appear here.</div></div>'
      return
    }
    el.innerHTML =
      '<table class="minitable"><thead><tr><th>Start</th><th>End</th><th>Backends</th><th>Consensus</th><th>Samples</th></tr></thead><tbody>' +
      wins
        .slice()
        .reverse()
        .map(function (w) {
          return (
            '<tr><td class="mono">' + esc(labelTime(w.start)) + '</td><td class="mono">' + esc(labelTime(w.end)) +
            '</td><td>' + esc((w.ids || []).join(', ')) + '</td><td class="mono">' + esc(w.consensus_short || '—') +
            '…</td><td class="mono">' + esc(w.sample_count || '—') + '</td></tr>'
          )
        })
        .join('') +
      '</tbody></table>'
  }

  function renderAnswerStrip(s, hist) {
    var el = document.getElementById('spark-answer')
    if (!el) return
    var d = derive(s, hist)
    var best = d.fastestRel
    var bestTxt = best
      ? esc(best.name) + ' · ' + msFmt(best.anonset && best.anonset.ms)
      : 'none meet reliable band'
    el.innerHTML =
      '<div class="ans-k">Spark sync answer · now</div>' +
      '<div class="ans-grid">' +
      '<div><div class="ans-l">Usable</div><div class="ans-v">' + d.usable + '/' + d.total + '</div><div class="ans-s">lag≤2 · set OK · not slow vs fleet</div></div>' +
      '<div><div class="ans-l">Agreement</div><div class="ans-v">' + (d.agreement != null ? d.agreement + '%' : '—') + '</div><div class="ans-s">tip · spark id · setHash</div></div>' +
      '<div><div class="ans-l">Best reliable</div><div class="ans-v">' + bestTxt + '</div><div class="ans-s">green · Spark+setHash · TLS · uptime</div></div>' +
      '<div><div class="ans-l">Risk</div><div class="ans-v ' + d.riskCls + '">' + d.risk + ' · ' + d.riskLabel + '</div><div class="ans-s">slow band ~' + (d.slowThreshMs / 1000).toFixed(0) + 's</div></div>' +
      '</div>'
  }

  function renderCompare(s) {
    var host = document.getElementById('compare-hosts')
    var out = document.getElementById('compare-out')
    if (!host || !out) return
    var eps = (s && s.endpoints) || []
    if (!eps.length) {
      out.innerHTML = '<div class="empty-s">Waiting for backends…</div>'
      return
    }
    var needRebuild = !host.dataset.ready || host.querySelectorAll('input').length !== eps.length
    if (needRebuild) {
      host.innerHTML = eps
        .map(function (e, i) {
          var checked = i < 3 ? ' checked' : ''
          return (
            '<label class="cmp-pick"><input type="checkbox" value="' + esc(e.id) + '"' + checked + '> ' +
            esc(e.name) + '</label>'
          )
        })
        .join('')
      host.dataset.ready = '1'
      if (!host.dataset.bound) {
        host.dataset.bound = '1'
        host.addEventListener('change', function () { renderCompare(global.S) })
      }
    }
    var selected = [].slice.call(host.querySelectorAll('input:checked')).map(function (i) { return i.value }).slice(0, 3)
    if (selected.length < 2) {
      out.innerHTML = '<div class="empty-s">Pick 2–3 backends to compare Spark id, setHash, fetch, lag, TLS.</div>'
      return
    }
    var rows = selected.map(function (id) {
      return eps.filter(function (e) { return e.id === id })[0]
    }).filter(Boolean)
    out.innerHTML =
      '<table class="minitable"><thead><tr><th></th>' +
      rows.map(function (e) { return '<th><a class="blink" href="/backend/' + e.id + '">' + esc(e.name) + '</a></th>' }).join('') +
      '</tr></thead><tbody>' +
      [
        ['Status', function (e) { return '<span class="st ' + e.status + '">' + e.status + '</span>' }],
        ['Lag', function (e) { return e.lag == null ? '—' : e.lag + ' blk' }],
        ['Spark id', function (e) { return e.spark_latest_coin_id == null ? '—' : esc(e.spark_latest_coin_id) + (e.spark_consistent === false ? ' ✗' : e.spark_consistent === true ? ' ✓' : '') }],
        ['setHash', function (e) {
          var a = e.anonset
          return a && a.setHash ? esc(String(a.setHash).slice(0, 12)) + '…' + (a.consistent === false ? ' ✗' : a.consistent === true ? ' ✓' : '') : '—'
        }],
        ['Anon-set', function (e) {
          var a = e.anonset
          if (!a || !a.ok) return '—'
          var slow = isAnonSlow(a.ms, slowThresholdMs(s, global.HistAPI))
          return msFmt(a.ms) + (a.mb != null ? ' · ' + a.mb + ' MB' : '') + (slow ? ' · slow' : '')
        }],
        ['TLS', function (e) { return e.tls_days_left == null ? '—' : e.tls_days_left + 'd' }],
        ['Used by', function (e) { return esc((e.used_by || []).join(', ') || '—') }],
        ['Connect', function (e) { return esc(e.host) + ':' + esc(e.port) }],
      ].map(function (row) {
        return '<tr><td class="mono">' + row[0] + '</td>' + rows.map(function (e) { return '<td class="mono">' + row[1](e) + '</td>' }).join('') + '</tr>'
      }).join('') +
      '</tbody></table>'
  }

  function onStatus(s) {
    renderSeverity(s)
    renderTlsStrip(s)
    renderTimeline(s, global.HistAPI)
    renderAnalytics(s, global.HistAPI)
    renderAnswerStrip(s, global.HistAPI)
    renderCompare(s)
  }

  function onHistory(hist) {
    paintLagChart(hist, global.S)
    paintFleetChart(hist)
    paintAnonsetChart(hist, global.S)
    paintGrowthChart(hist)
    paintSethashList(hist)
    renderTimeline(global.S, hist)
    renderAnalytics(global.S, hist)
    renderAnswerStrip(global.S, hist)
    renderCompare(global.S)
    if (global.curDetail) paintDetailCharts(global.curDetail, hist)
  }

  function init() {
    if (!global.HistAPI) {
      ;['chart-lag-wrap', 'chart-fleet-wrap', 'chart-anonset-ov-wrap'].forEach(function (wid) {
        var wrap = document.getElementById(wid)
        var box = wrap && (wrap.querySelector('.chart-box') || wrap)
        if (box) loadingBox(box, 'Loading history…', 'Waiting for pre-cached /api/history.')
      })
    }
    if (global.S) onStatus(global.S)
    if (global.HistAPI) onHistory(global.HistAPI)
  }

  global.FiroEnhance = {
    init: init,
    onStatus: onStatus,
    onHistory: onHistory,
    derive: derive,
    paintDetailCharts: paintDetailCharts,
    setDetailChartsLoading: setDetailChartsLoading,
    failReasons: failReasons,
    diagnose: diagnose,
    fleetMedian: fleetMedian,
    percentile: percentile,
    msFmt: msFmt,
    slowThresholdMs: slowThresholdMs,
    isAnonSlow: isAnonSlow,
    renderCompare: renderCompare,
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})(window)

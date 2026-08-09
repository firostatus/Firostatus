// Heavy Spark anonymity-set fetch-health probe (shared by server + child worker).
const tls = require('tls')

const DEFAULT_BUDGET_MS = 45_000

function probeAnonset(ep, budgetMs = DEFAULT_BUDGET_MS) {
  return new Promise((resolve) => {
    const out = {
      id: ep.id,
      ok: false,
      ms: null,
      coins: null,
      bytes: 0,
      setHash: null,
      group: null,
      error: null,
      at: new Date().toISOString(),
      source: 'live',
    }
    let settled = false
    let setStarted = null
    let buf = ''
    let socket
    const finish = () => {
      if (settled) return
      settled = true
      try {
        socket.end()
      } catch {}
      resolve(out)
    }
    socket = tls.connect(
      { host: ep.host, port: ep.port, servername: ep.host, rejectUnauthorized: false, timeout: budgetMs },
      () => {
        socket.write(JSON.stringify({ id: 1, method: 'server.version', params: ['firo-spark-monitor', '1.4'] }) + '\n')
        socket.write(JSON.stringify({ id: 2, method: 'spark.getsparklatestcoinid', params: [] }) + '\n')
      },
    )
    socket.on('data', (d) => {
      out.bytes += d.length
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        if (!line) continue
        try {
          const m = JSON.parse(line)
          if (m.id === 2 && m.result !== undefined) {
            out.group = m.result
            setStarted = Date.now()
            socket.write(
              JSON.stringify({ id: 3, method: 'spark.getsparkanonymityset', params: [String(m.result), ''] }) + '\n',
            )
          }
          if (m.id === 3) {
            if (m.result) {
              out.ok = true
              out.ms = Date.now() - setStarted
              out.coins = Array.isArray(m.result.coins) ? m.result.coins.length : null
              out.setHash = m.result.setHash || m.result.setHashOut || null
            } else {
              out.error = m.error ? JSON.stringify(m.error).slice(0, 120) : 'no result'
            }
            finish()
          }
        } catch {
          // Big anon-set payloads: partial JSON until the closing newline; keep buffering.
        }
      }
    })
    socket.on('error', (e) => {
      if (!out.error) out.error = e.message
      finish()
    })
    socket.on('timeout', () => {
      if (!out.error) out.error = 'timeout (' + Math.round(budgetMs / 1000) + 's budget)'
      if (setStarted) out.ms = Date.now() - setStarted
      try {
        socket.destroy()
      } catch {}
      finish()
    })
    socket.on('close', () => finish())
  })
}

module.exports = { probeAnonset, DEFAULT_BUDGET_MS }

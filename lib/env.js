// Load a local .env if present without adding a dependency.
// Existing process.env wins. Never logs values.

const fs = require('fs')
const path = require('path')

function loadEnvFile(filePath) {
  const p = filePath || path.join(__dirname, '..', '.env')
  try {
    if (!fs.existsSync(p)) return false
    const raw = fs.readFileSync(p, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 1) continue
      const k = t.slice(0, i).trim()
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue
      if (process.env[k] != null && process.env[k] !== '') continue
      let v = t.slice(i + 1).trim()
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1)
      }
      process.env[k] = v
    }
    return true
  } catch (e) {
    console.error('[env] failed to read .env', e && e.message)
    return false
  }
}

module.exports = { loadEnvFile }

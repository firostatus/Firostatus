// Creates Desktop/firostatus-deploy.zip for always-on host upload.
// Production UI is public/ — no React build required.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.join(__dirname, '..')
const outDir = path.join(require('os').homedir(), 'Desktop')
const zipPath = path.join(outDir, 'firostatus-deploy.zip')
const staging = path.join(root, '.deploy-staging')

function rm(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

rm(staging)
fs.mkdirSync(staging, { recursive: true })

const include = [
  'server.js',
  'package.json',
  'package-lock.json',
  'LICENSE',
  'README.md',
  'DEPLOY.md',
  'CONTRIBUTING.md',
  '.env.example',
  'lib',
  'public',
  'docs',
  'scripts',
]

for (const item of include) {
  const src = path.join(root, item)
  if (!fs.existsSync(src)) continue
  fs.cpSync(src, path.join(staging, item), { recursive: true })
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)

const ps = `Compress-Archive -Path '${staging.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'inherit' })
rm(staging)
console.log('Wrote', zipPath)

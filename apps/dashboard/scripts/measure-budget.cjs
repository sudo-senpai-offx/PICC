const fs = require("node:fs")
const path = require("node:path")
const zlib = require("node:zlib")
const dir = path.join(process.cwd(), "dist", "assets")
const rows = []
for (const f of fs.readdirSync(dir).filter((n) => /\.(js|css)$/.test(n))) {
  const raw = fs.readFileSync(path.join(dir, f))
  rows.push({ name: f, kbRaw: Math.round(raw.length / 1024), kbGz: Math.round(zlib.gzipSync(raw).length / 1024) })
}
rows.sort((a, b) => b.kbGz - a.kbGz)
for (const r of rows) console.log(`${String(r.kbGz).padStart(5)} gz  ${String(r.kbRaw).padStart(5)} raw  ${r.name}`)
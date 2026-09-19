const fs = require("node:fs")
const path = require("node:path")
const dir = path.join(process.cwd(), "dist", "assets")
const needle = process.argv[2] || "lightweight-charts"
for (const f of fs.readdirSync(dir)) {
  if (!/\.js$/.test(f)) continue
  const b = fs.readFileSync(path.join(dir, f))
  if (b.includes(needle)) console.log(f)
}

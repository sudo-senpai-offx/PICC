import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createServer, request as httpRequest } from "node:http"

// Prevent the production server from binding a port and point its dist ROOT at
// a temp dir. PICC_DIST_DIR must be set BEFORE ../index.mjs evaluates (ROOT is
// a module-level const), so env-only work happens in vi.hoisted — no imported
// bindings are reachable there (vitest hoists the callback above the imports)
// — and the filesystem seeding below runs at module scope before any test
// callback executes.
const DIST = vi.hoisted(() => {
  process.env.PICC_NO_LISTEN = "1"
  // Canonical separators only: resolveStatic's containment check compares
  // startsWith(ROOT + sep) against the normalized path, so a mixed-separator
  // ROOT would reject every lookup.
  const sep = process.platform === "win32" ? "\\" : "/"
  const dir = `${process.cwd()}${sep}node_modules${sep}.cache${sep}picc-static-dist-${process.pid}-${Date.now()}`
  process.env.PICC_DIST_DIR = dir
  return dir
})

import { requestListener, resolveStatic } from "../index.mjs"

mkdirSync(DIST, { recursive: true })
copyFileSync(new URL("../../public/manifest.json", import.meta.url), join(DIST, "manifest.json"))
mkdirSync(join(DIST, "icons"), { recursive: true })
copyFileSync(new URL("../../public/icons/icon-192.png", import.meta.url), join(DIST, "icons", "icon-192.png"))
copyFileSync(new URL("../../public/icons/icon-512.png", import.meta.url), join(DIST, "icons", "icon-512.png"))
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>dist stub</title>")

describe("resolveStatic (static-file path containment)", () => {
  it("maps the root and normal assets inside dist", () => {
    expect(resolveStatic("/")).toMatch(/index\.html$/)
    const p = resolveStatic("/app.js")
    expect(p).toMatch(/app\.js$/)
  })

  it("maps the web-app manifest inside dist (REQ-1 serving path)", () => {
    expect(resolveStatic("/manifest.json")).toBe(join(DIST, "manifest.json"))
  })

  it("rejects path traversal attempts that would escape dist", () => {
    for (const probe of [
      "/../.env",
      "/..%2f.env",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/../server/data/users.json",
      "/assets/../../.env",
      "/..%2Fserver%2Fdata%2Fsessions.json"
    ]) {
      expect(resolveStatic(probe), probe).toBeNull()
    }
  })

  it("returns null for malformed percent-encoding instead of crashing", () => {
    expect(resolveStatic("/%zz")).toBeNull()
    expect(resolveStatic("/%c0%af")).toBeNull()
    expect(resolveStatic("/%")).toBeNull()
  })
})

describe("public/manifest.json (REQ-1 installability fields)", () => {
  const manifestPath = new URL("../../public/manifest.json", import.meta.url)

  it("declares every REQ-1 field", () => {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"))
    // Reskin (Slice 3/T6): buyer brand is "Personal Income Command Centre" —
    // the legacy "Passive Income Command Center" string must not return.
    expect(m.name.toLowerCase()).toContain("personal income command centre")
    expect(m.name.toLowerCase()).not.toContain("passive income command")
    expect(m.short_name).toBe("PICC")
    expect(m.display).toBe("standalone")
    expect(m.start_url).toBe("/")
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i)
    const sizes = m.icons.map((i) => `${i.sizes}|${i.type}`)
    expect(sizes).toContain("192x192|image/png")
    expect(sizes).toContain("512x512|image/png")
    for (const icon of m.icons) expect(icon.src).toMatch(/^\/icons\//)
  })

  it("referenced icons exist as real PNGs in public/", () => {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"))
    for (const icon of m.icons) {
      const png = readFileSync(new URL(`../../public${icon.src}`, import.meta.url))
      expect(png.subarray(0, 8).toString("hex"), icon.src).toBe("89504e470d0a1a0a")
      const size = Number(icon.sizes.split("x")[0])
      expect(png.readUInt32BE(16), icon.src).toBe(size)
      expect(png.readUInt32BE(20), icon.src).toBe(size)
    }
  })
})

describe("index.html manifest wiring (REQ-1)", () => {
  it("links the manifest from the head", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8")
    expect(html).toContain('<link rel="manifest" href="/manifest.json" />')
  })
})

describe("served round trip through the production requestListener (REQ-1, T1)", () => {
  const server = createServer(requestListener)

  afterAll(() => new Promise((resolve) => server.close(resolve)))

  beforeAll(() => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)))

  const base = () => `http://127.0.0.1:${server.address().port}`

  it("GET /manifest.json → 200 application/json, body starts with { (no SPA fallback)", async () => {
    const res = await fetch(`${base()}/manifest.json`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/json")
    const body = await res.text()
    expect(body.startsWith("{"), "must not be the index.html fallback").toBe(true)
    expect(JSON.parse(body).display).toBe("standalone")
    expect(body).toBe(readFileSync(new URL("../../public/manifest.json", import.meta.url), "utf8"))
  })

  it("GET /icons/icon-192.png → 200 image/png with the real PNG bytes", async () => {
    const res = await fetch(`${base()}/icons/icon-192.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(readFileSync(new URL("../../public/icons/icon-192.png", import.meta.url)))).toBe(true)
  })
})

describe("security headers on the production server (F-04)", () => {
  const server = createServer(requestListener)

  afterAll(() => new Promise((resolve) => server.close(resolve)))

  beforeAll(() => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)))

  const base = () => `http://127.0.0.1:${server.address().port}`

  it("every static response carries CSP, nosniff, XFO, referrer + permissions policy", async () => {
    const res = await fetch(`${base()}/manifest.json`)
    expect(res.status).toBe(200)
    const csp = res.headers.get("content-security-policy")
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("x-frame-options")).toBe("DENY")
    expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    expect(res.headers.get("permissions-policy")).toContain("geolocation=()")
  })
})

describe("Host allow-list / DNS-rebinding guard (F-05)", () => {
  const server = createServer(requestListener)

  afterAll(() => new Promise((resolve) => server.close(resolve)))

  beforeAll(() => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)))

  function rawGet(hostHeader) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: "127.0.0.1", port: server.address().port, path: "/manifest.json", headers: { Host: hostHeader } },
        (res) => {
          res.resume()
          res.on("end", () => resolve(res.statusCode))
        }
      )
      req.on("error", reject)
      req.end()
    })
  }

  it("accepts loopback Hosts (the only way to reach the bound socket)", async () => {
    expect(await rawGet("127.0.0.1")).toBe(200)
    expect(await rawGet(`127.0.0.1:${server.address().port}`)).toBe(200)
    expect(await rawGet("localhost")).toBe(200)
  })

  it("rejects a DNS-rebinding Host (attacker.com resolving to 127.0.0.1)", async () => {
    expect(await rawGet("attacker.example")).toBe(403)
    expect(await rawGet("attacker.example:443")).toBe(403)
  })
})

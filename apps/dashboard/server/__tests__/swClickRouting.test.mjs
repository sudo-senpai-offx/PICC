// T3 — sw.js payload-v2 whitelist + click routing (structural proof).
//
// The service worker is browser-only (self/fetch/registration), so — per the
// repo rule for browser-only code — the important logic is pinned at the SOURCE
// level with readFileSync + regexes: the whitelist caps, the actions attach,
// the deep-link data.url, the event.action switch, and the byte-identical
// default focus-or-open path that must survive the actions refactor untouched.
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
// EOL-agnostic read: the repo has no .gitattributes, so Windows checkouts
// (autocrlf) deliver sw.js with CRLF while CI/Linux deliver LF. These pins are
// about code structure, never line endings — normalize before asserting.
const SW = readFileSync(join(__dirname, "..", "..", "public", "sw.js"), "utf8").replace(/\r\n/g, "\n")

// The exact pre-actions focus-or-open block (old sw.js:42-48). Byte-identical:
// the T3 requirement is that the actions refactor does not touch this path.
const DEFAULT_PATH_BLOCK = [
  '  const target = event.notification.data?.url || "/"',
  "  event.waitUntil(",
  '    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {',
  '      for (const client of windowClients) {',
  '        if (client.url.includes("/") && "focus" in client) return client.focus()',
  "      }",
  "      if (self.clients.openWindow) return self.clients.openWindow(target)",
  "    })",
  "  )"
].join("\n")

describe("sw.js web-push payload v2 (REQ-3, T3)", () => {
  it("whitelist-parses the new fields with length caps, never raw JSON passthrough", () => {
    // venue (object {venueId} or plain string) bounded to 40 chars.
    expect(SW).toMatch(/typeof parsed\?\.venue === "string"[\s\S]*?slice\(0, 40\)/)
    expect(SW).toMatch(/parsed\?\.venue\?\.venueId[\s\S]*?slice\(0, 40\)/)
    // windowText bounded.
    expect(SW).toMatch(/parsed\?\.windowText[^]*?slice\(0, 96\)/)
    // requireInteraction only ever accepted as an explicit boolean.
    expect(SW).toMatch(/typeof parsed\?\.requireInteraction === "boolean"/)
    // actions: at most 2 entries, each action/title ≤ 32 chars, empties dropped.
    expect(SW).toMatch(/parsed\.actions\s*\n?\s*\.slice\(0, 2\)/)
    expect(SW).toMatch(/String\(a\?\.action \?\? ""\)\.slice\(0, 32\)/)
    expect(SW).toMatch(/String\(a\?\.title \?\? ""\)\.slice\(0, 32\)/)
    expect(SW).toMatch(/if \(payload\.actions\.length === 0\) delete payload\.actions/)
  })

  it("attaches actions + requireInteraction to showNotification next to the existing fields", () => {
    const opts = SW.match(/showNotification\(payload\.title, \{\n([\s\S]*?)\n    \}\)/)
    expect(opts, "showNotification options object").toBeTruthy()
    expect(opts[1]).toContain("body: payload.body,")
    expect(opts[1]).toContain("tag:")
    expect(opts[1]).toMatch(/actions: payload\.actions/)
    expect(opts[1]).toMatch(/requireInteraction: payload\.requireInteraction/)
  })

  it("points data.url at the REQ-4 deep link built from whitelisted fields", () => {
    expect(SW).toMatch(/function deepLink\(payload\)/)
    expect(SW).toMatch(/searchParams\.set\("panel", "chart"\)/)
    expect(SW).toMatch(/searchParams\.set\("venue", payload\.venue\)/)
    expect(SW).toMatch(/data: \{ url: deepLink\(payload\), asset: payload\.asset, kind: payload\.kind \}/)
  })
})

describe("sw.js notificationclick routing (REQ-4, T3)", () => {
  it("switches on event.action for view / snooze / default", () => {
    expect(SW).toMatch(/const action = event\.action/)
    expect(SW).toMatch(/if \(action === "snooze"\) \{/)
  })

  it("snooze branch issues the POST and never navigates", () => {
    const snooze = SW.match(/if \(action === "snooze"\) \{([\s\S]*?)\n  \}/)
    expect(snooze, "snooze branch block").toBeTruthy()
    expect(snooze[1]).toContain('fetch("/api/notifications/snooze"')
    expect(snooze[1]).toContain('method: "POST"')
    expect(snooze[1]).toContain("event.notification.tag")
    expect(snooze[1]).not.toContain("openWindow")
    expect(snooze[1]).not.toContain("windowClients")
    expect(snooze[1]).not.toContain("matchAll")
  })

  it("default branch keeps the pre-actions focus-or-open path byte-identical", () => {
    expect(SW).toContain(DEFAULT_PATH_BLOCK)
  })

  it("has exactly one openWindow call site (the default branch)", () => {
    expect(SW.match(/openWindow\(target\)/g) ?? []).toHaveLength(1)
  })
})
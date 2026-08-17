import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

// The PICC overlay is injected into pages that enforce a strict Trusted-Types
// CSP (accounts.google.com among them). There, innerHTML, insertAdjacentHTML,
// DOMParser.parseFromString and document.write ALL throw — so the injected
// builders must construct DOM nodes with createElement/textContent only. This
// guard makes sure an HTML-string sink can never creep back in.
describe("PICC overlay — Trusted-Types safe injection", () => {
  const files = [
    join(__dirname, "..", "services", "browserStudio.mjs"),
    join(__dirname, "..", "services", "browserBridge.mjs")
  ]
  const sinkPatterns = [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /parseFromString\(/, /insertAdjacentHTML\(/, /document\.write/, /\.srcdoc\s*=/]

  it("never uses Trusted-Types-blocked sinks in page-injected scripts", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8")
      for (const re of sinkPatterns) {
        expect(re.test(src), `${file} must not contain ${re}`).toBe(false)
      }
    }
  })
})

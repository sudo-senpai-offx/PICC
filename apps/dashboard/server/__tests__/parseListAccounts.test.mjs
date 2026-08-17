import { describe, expect, it } from "vitest"
import { parseListAccountsHtml, unescapeJsString } from "../services/browserStudio.mjs"

describe("Google ListAccounts payload parsing", () => {
  it("unescapes Google's JS string-literal escapes", () => {
    expect(unescapeJsString("\\x5b\\x22a\\x22,\\x5b1\\x5d\\x5d")).toBe('["a",[1]]')
    expect(unescapeJsString("Sharvin \\x27s workspace")).toBe("Sharvin 's workspace")
    expect(unescapeJsString("https:\\/\\/x.com\\/a")).toBe("https://x.com/a")
    expect(unescapeJsString("a\\u0026b")).toBe("a&b")
  })

  it("parses the modern postMessage payload into account emails", () => {
    const payload =
      '\\x5b\\x22gaia.l.a.r\\x22,\\x5b\\x5b\\x22gaia.l.a\\x22,1,\\x22Sharvin \\x27s workspace\\x22,' +
      '\\x22workspace.sharvinmaran.official@gmail.com\\x22,\\x22https:\\/\\/lh3.googleusercontent.com\\/a\\x22\\x5d\\x5d\\x5d'
    const html = `<script>window.parent.postMessage('${payload}', 'https://accounts.google.com');</script>`
    expect(parseListAccountsHtml(html)).toEqual(["workspace.sharvinmaran.official@gmail.com"])
  })

  it("returns null for a signed-out / non-payload response", () => {
    expect(parseListAccountsHtml("<html>400. That's an error.</html>")).toBeNull()
    expect(parseListAccountsHtml(`<script>window.parent.postMessage('\\x5b\\x5b\\x5d\\x5d', 'x');</script>`)).toBeNull()
    expect(parseListAccountsHtml("")).toBeNull()
  })
})

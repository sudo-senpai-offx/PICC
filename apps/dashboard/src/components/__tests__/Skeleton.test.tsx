// @vitest-environment jsdom
// The loading Skeleton placeholder must be non-interactive and invisible to
// assistive tech (aria-hidden), while still applying its sizing so it holds
// the panel's shape during a load. This pins the a11y contract + sizing.
import { describe, expect, it } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { Skeleton } from "@/components/ui"

function mount(node: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<>{node}</>) })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

const el = () => document.querySelector<HTMLElement>(".skeleton")

describe("Skeleton (loading placeholder)", () => {
  it("renders a span with the skeleton class and aria-hidden", () => {
    const m = mount(<Skeleton />)
    const e = el()
    expect(e).not.toBeNull()
    expect(e!.getAttribute("aria-hidden")).toBe("true")
    expect(e!.textContent).toBe("")
    m.unmount()
  })

  it("applies width/height sizing via inline style", () => {
    const m = mount(<Skeleton width={120} height={24} />)
    const e = el()
    expect(e!.style.width).toBe("120px")
    expect(e!.style.height).toBe("24px")
    m.unmount()
  })
})

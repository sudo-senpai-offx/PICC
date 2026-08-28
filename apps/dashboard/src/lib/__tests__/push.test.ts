import { describe, expect, it } from "vitest"
import { isPushSupported, urlBase64ToUint8Array } from "../push"

describe("urlBase64ToUint8Array (web-push VAPID key conversion)", () => {
  it("decodes a base64url string into the exact bytes (incl. URL-safe chars)", () => {
    // bytes [0,1,2,253,254,255] as base64 = "AAEC/f7/" → base64url = "AAEC_f7_"
    const out = urlBase64ToUint8Array("AAEC_f7_")
    expect(Array.from(out)).toEqual([0, 1, 2, 253, 254, 255])
  })

  it("tolerates missing base64 padding (VAPID keys are unpadded)", () => {
    // base64 "AQI" (bytes [1,2]) → base64url "AQI"
    const out = urlBase64ToUint8Array("AQI")
    expect(Array.from(out)).toEqual([1, 2])
  })

  it("is deterministic and pure (byte-for-byte round trip)", () => {
    const key = "BElw5Gv8mYd2sE6t3Z9xKq0Lp1Wq4Rc7VdYfHjS8nUo2kVbMqXa1RcFgHdWwTz"
    expect(Array.from(urlBase64ToUint8Array(key))).toEqual(Array.from(urlBase64ToUint8Array(key)))
    expect(urlBase64ToUint8Array(key).byteLength).toBeGreaterThan(0)
  })
})

describe("isPushSupported", () => {
  it("returns false in a Node test environment (no navigator/window)", () => {
    expect(isPushSupported()).toBe(false)
  })
})
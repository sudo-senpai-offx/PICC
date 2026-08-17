// Clipboard bridging for the integrated browser. The remote page runs inside
// PICC's real Chromium, so the OS clipboard is not shared with it. These
// helpers let the app pull the page selection into the OS clipboard and push
// local text back into the page.

function fallbackCopy(text: string): boolean {
  const ta = document.createElement("textarea")
  ta.value = text
  ta.style.position = "fixed"
  ta.style.top = "-9999px"
  ta.style.opacity = "0"
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

/** Write text to the OS clipboard. Resolves to false when unavailable. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* permission denied — fall through to execCommand */
  }
  return fallbackCopy(text)
}

/** Read plain text from the OS clipboard. Resolves to "" when unavailable. */
export async function readClipboardText(): Promise<string> {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText()
  } catch {
    /* permission denied or non-secure context */
  }
  return ""
}

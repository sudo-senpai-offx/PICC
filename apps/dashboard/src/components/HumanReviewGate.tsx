import { useEffect, useRef, useState } from "react"
import { Button } from "./ui"
import { logHumanConfirmation } from "@/lib/api"
import { useUser } from "@/hooks/useAuth"

const REVIEW_SECONDS = 5

export function HumanReviewGate({
  surface,
  suggestionId,
  confirmLabel = "Copy Suggestion",
  meta,
  onConfirm
}: {
  surface: string
  suggestionId: string
  confirmLabel?: string
  meta?: Record<string, unknown>
  onConfirm: () => void
}) {
  const user = useUser()
  const [secondsLeft, setSecondsLeft] = useState(REVIEW_SECONDS)
  const [acknowledged, setAcknowledged] = useState(false)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  const ready = secondsLeft === 0 && acknowledged

  const handleConfirm = async () => {
    setCopied(true)
    await logHumanConfirmation(user?.id, surface, suggestionId, meta)
    onConfirm()
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="human-gate">
      <div className="human-gate-timer">
        {secondsLeft > 0 ? (
          <span className="human-gate-count" data-testid="review-countdown">
            ⏱️ Human review required — {secondsLeft}s
          </span>
        ) : (
          <span className="human-gate-ready">✅ Review complete — you are in control</span>
        )}
      </div>
      <label className="human-gate-check">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={secondsLeft > 0}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>
          I confirm I am a human making this final decision. The AI is only providing data.
        </span>
      </label>
      <Button
        variant={copied ? "secondary" : "primary"}
        disabled={!ready}
        onClick={handleConfirm}
        className="human-gate-btn"
      >
        {copied ? "✅ Copied!" : confirmLabel}
      </Button>
    </div>
  )
}

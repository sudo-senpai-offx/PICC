import type { ReactNode } from "react"
import type { Availability } from "../domain/availability"
import { RoomFrame } from "./RoomFrame"

/**
 * WS-6 T2 — terminal shell.
 *
 * A thin composition seam: it owns the room frame and nothing else. It opens no
 * transport, reads no secret, and creates no second data source — all data
 * access belongs to the adapters under `src/terminal/adapters/`, so a room can
 * never accidentally bypass the shared realtime bus.
 *
 * The strangler rule from the spec applies: this shell sits BESIDE the legacy
 * suite. The legacy surface remains the fallback until a room reaches parity.
 */

export type TerminalShellProps = {
  roomKey: string
  title: string
  /** When present and not `live`, the room renders an honest reserved state. */
  reserved?: Availability
  capabilityLabel?: string
  children?: ReactNode
}

export function TerminalShell({ roomKey, title, reserved, capabilityLabel, children }: TerminalShellProps) {
  return (
    <RoomFrame roomKey={roomKey} title={title} reserved={reserved} capabilityLabel={capabilityLabel}>
      {children}
    </RoomFrame>
  )
}

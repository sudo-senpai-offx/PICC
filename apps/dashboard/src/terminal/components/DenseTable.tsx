import { useCallback, useEffect, useMemo, useRef, useState } from "react"

/**
 * WS-6 T5 — dense virtualized table (AC-004).
 *
 * Renders 10,000+ rows with a BOUNDED DOM by windowing: only the visible slice
 * plus a small overscan is mounted, while the scroll height still reflects the
 * full row count so the scrollbar is honest.
 *
 * DEPENDENCY DECISION: this windowing is implemented directly rather than by
 * installing `@tanstack/react-virtual`. The WS-6 manifest (§4.8) deferred that
 * install to T5 pending measurement, but D2 permits no degradation on an
 * Atom/Snapdragon floor and ARM64 compatibility cannot be validated from this
 * host. A small local implementation adds no unverifiable bundle weight, and it
 * keeps the "no second data source" rule trivially true — the table receives
 * rows as a prop and fetches nothing.
 *
 * HONESTY: an empty `rows` array is an OBSERVED empty set, rendered as such. It
 * is never presented as zero-valued data, and the table never fabricates a row.
 */
export type DenseColumn<T> = {
  key: string
  header: string
  width: number
  render?: (row: T, index: number) => React.ReactNode
}

export type DenseTableProps<T> = {
  rows: readonly T[]
  columns: readonly DenseColumn<T>[]
  rowHeight: number
  height: number
  label?: string
  /** Extra rows rendered above and below the viewport to avoid blank edges. */
  overscan?: number
}

export function DenseTable<T>({
  rows,
  columns,
  rowHeight,
  height,
  label,
  overscan = 6
}: DenseTableProps<T>) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // A row arriving above the viewport (live data) must not leave the window
  // stale, so the offset is re-clamped whenever the row set shrinks.
  const total = rows.length
  const maxScrollTop = Math.max(0, total * rowHeight - height)
  const clampedScrollTop = Math.min(scrollTop, maxScrollTop)
  useEffect(() => {
    if (clampedScrollTop !== scrollTop) setScrollTop(clampedScrollTop)
  }, [clampedScrollTop, scrollTop])

  const visibleCount = Math.ceil(height / rowHeight) + 1
  const startIndex = Math.max(0, Math.floor(clampedScrollTop / rowHeight) - overscan)
  const endIndex = Math.min(total, startIndex + visibleCount + overscan * 2)
  const window = useMemo(() => rows.slice(startIndex, endIndex), [rows, startIndex, endIndex])

  if (total === 0) {
    return (
      <div className="terminal-table" data-total-rows="0">
        <p className="terminal-table__empty">No rows</p>
      </div>
    )
  }

  return (
    <div className="terminal-table" data-total-rows={total}>
      <div role="row" className="terminal-table__head">
        {columns.map((c) => (
          <div
            key={c.key}
            role="columnheader"
            data-column-key={c.key}
            style={{ width: c.width, flex: `0 0 ${c.width}px` }}
          >
            {c.header}
          </div>
        ))}
      </div>
      <div
        ref={viewportRef}
        role="grid"
        aria-label={label}
        aria-rowcount={total}
        className="terminal-table__viewport"
        style={{ height, overflowY: "auto" }}
        onScroll={onScroll}
      >
        {/* Spacer preserves the true scroll height so the scrollbar is honest. */}
        <div style={{ height: total * rowHeight, position: "relative" }}>
          <div style={{ transform: `translateY(${startIndex * rowHeight}px)` }}>
            {window.map((row, i) => {
              const absoluteIndex = startIndex + i
              return (
                <div
                  key={absoluteIndex}
                  role="row"
                  tabIndex={0}
                  data-row-index={absoluteIndex}
                  className="terminal-table__row"
                  style={{ height: rowHeight, display: "flex" }}
                >
                  {columns.map((c) => (
                    <div
                      key={c.key}
                      role="cell"
                      style={{ width: c.width, flex: `0 0 ${c.width}px` }}
                    >
                      {c.render ? c.render(row, absoluteIndex) : String((row as Record<string, unknown>)[c.key] ?? "")}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

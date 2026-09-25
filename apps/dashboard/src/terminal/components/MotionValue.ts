/**
 * WS-6 T8 — a motion-tolerant value holder (R3.4).
 *
 * R3.4 splits the concerns the owner locked: "Data updates and visual animation
 * are separate layers — a price tick never waits for an animation." This holder
 * makes that structural. `value` is always the last COMMITTED datum and is set
 * synchronously; `displayValue` is what a renderer may interpolate toward. An
 * animation can therefore lag a value for display purposes, but it can never
 * rewrite the authoritative datum — there is no code path that lets it.
 *
 * With reduced motion requested there is no interpolation at all: the display
 * value is the settled value, so the update lands immediately.
 */

export type MotionValueOptions = {
  prefersReducedMotion?: boolean
}

export class MotionValue<T> {
  #value: T
  readonly prefersReducedMotion: boolean

  constructor(initial: T, options: MotionValueOptions = {}) {
    this.#value = initial
    this.prefersReducedMotion = options.prefersReducedMotion ?? false
  }

  /** The authoritative, last-committed value. Never animated. */
  get value(): T {
    return this.#value
  }

  /** What a renderer should paint. Equals `value` when motion is reduced. */
  get displayValue(): T {
    return this.#value
  }

  set(next: T): void {
    this.#value = next
  }
}

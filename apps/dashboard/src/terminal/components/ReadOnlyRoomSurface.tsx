import type { ReadOnlyRoomView } from "../domain/readOnlyRooms"

/**
 * WS-7 T10 — THE ONE read-only surface. Nine keys, sixteen instances, one file.
 *
 * WHY ONE COMPONENT. `MinistryRoom.tsx` instantiates sixteen read-only room
 * instances across nine keys. Sixteen components would be sixteen copies of one
 * shape, and two copies of a shape drift — the duplication this task was warned
 * about. So this file renders a `ReadOnlyRoomView` and knows NOTHING about which
 * key or suite it is looking at: there is no `key ===` and no `suite ===` here,
 * and `ReadOnlyRoom.test.tsx` asserts both absences statically as well as
 * asserting the rendered markup.
 *
 * WHY THAT IS SAFE RATHER THAN A COWBOY. The suite and key differences are DATA,
 * held in `readOnlyRooms.ts`: the sections a room declares, the routes those
 * sections came from, and each fact's `observed` tri-state. A room is different
 * because it declared different producers, not because this file branched.
 *
 * THE READ-ONLY GUARANTEE IS VISIBLE HERE, not merely asserted in a test:
 * `data-interactive-affordances` carries the count from the domain module's
 * exported frozen list — which is empty — and the reason is rendered, because a
 * room can mislead with wording as easily as with a control. There is no
 * `<button>`, `<input>`, `<select>`, `<form>` or anchor anywhere below, and that
 * is load-bearing rather than incidental: this is a display surface, and a control
 * on a display surface is either cosmetic or a lie.
 *
 * AN ABSENCE IS RENDERED, NEVER COLLAPSED. A section whose producer did not
 * answer shows the producer's own route, whether it refused and with what text,
 * and a named absence with its owner. A fact that was not observed renders the
 * word it is looking for and NO VALUE — the absence is a distinguishable state
 * (`observed === null`), not a default, and a fact has nowhere to hold a `0`.
 */
export function ReadOnlyRoomSurface({ view }: { view: ReadOnlyRoomView }) {
  return (
    <div
      className="terminal-readonly-room"
      data-read-only-room="true"
      data-suite={view.suite}
      data-read-only-verdict={view.verdict}
      data-interactive-affordances={view.affordances.length}
    >
      <p className="terminal-readonly-room__verdict" data-testid="read-only-verdict">
        {view.verdictReason}
      </p>

      {view.sections.map((section) => (
        <section
          key={section.id}
          className="terminal-readonly-room__section"
          data-section={section.id}
          data-readout-obtained={section.readoutObtained ? "true" : "false"}
          data-route={section.route}
        >
          <h3 className="terminal-readonly-room__section-title">{section.title}</h3>

          {section.absence ? (
            <div
              className="terminal-readonly-room__absence"
              data-absence={section.id}
              data-owner={section.absence.owner}
              role="status"
              aria-live="polite"
            >
              <p className="terminal-readonly-room__absence-what">{section.absence.what}</p>
              <p className="terminal-readonly-room__absence-detail">{section.absence.detail}</p>
              <p className="terminal-readonly-room__absence-owner">
                Owned by {section.absence.owner} · producer {section.route}
              </p>
              {section.producerError ? (
                // The producer's OWN refusal text, copied rather than summarised.
                <p className="terminal-readonly-room__producer-error" data-producer-error="true">
                  Producer said: {section.producerError}
                </p>
              ) : null}
            </div>
          ) : null}

          {section.permanentAbsences.map((absence) => (
            <div
              key={absence.what}
              className="terminal-readonly-room__absence"
              data-absence={absence.what}
              data-owner={absence.owner}
              role="status"
            >
              <p className="terminal-readonly-room__absence-what">{absence.what}</p>
              <p className="terminal-readonly-room__absence-detail">{absence.detail}</p>
              <p className="terminal-readonly-room__absence-owner">Owned by {absence.owner}</p>
            </div>
          ))}

          {section.facts.length > 0 ? (
            <dl className="terminal-readonly-room__facts">
              {section.facts.map((fact) => (
                <div
                  key={fact.fact}
                  className="terminal-readonly-room__fact"
                  data-fact={fact.fact}
                  // The tri-state, carried into the DOM. `data-observed="null"` is
                  // what makes an unobserved fact distinguishable from an observed
                  // `false`, and it is the requirement `:1287` states rendered.
                  data-observed={fact.observed === null ? "null" : String(fact.observed)}
                >
                  <dt>{fact.fact}</dt>
                  <dd>
                    {fact.observed === null ? (
                      <span className="terminal-readonly-room__unobserved">not observed</span>
                    ) : (
                      fact.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ))}

      <section className="terminal-readonly-room__affordances" data-testid="read-only-affordances">
        <p className="terminal-readonly-room__affordance-reason">{view.affordanceReason}</p>
      </section>
    </div>
  )
}
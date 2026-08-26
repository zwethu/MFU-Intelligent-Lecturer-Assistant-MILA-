import { useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'

import type { GameInsights, StudentInsight } from '../../../services/gameService'
import { APPROACH_WORD, BAND_PILL, BAND_WORD, FLAG_STYLE } from './signalBand'
import {
  PACE_COPY,
  approachLine,
  flagSentence,
  formatSeconds,
  reviewPauses,
  roundAriaLabel,
  signalSentence,
} from './signalCopy'

/**
 * One student's run, in full.
 *
 * Returns an unstyled BODY, not a card. Its container owns the border, the radius,
 * the background and the scrolling — because when the scroller was wrapped around
 * the card instead, the card's own border and padding were the scrolled content and
 * got clipped at the wrapper's square edge. Every scrollable panel in this app puts
 * the scroller inside the card for exactly that reason.
 *
 * The blocks are separated by rules rather than by whitespace alone. Eight stacked
 * boxes at one uniform gap gave no hint which of them belonged together.
 */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  )
}

/** A titled block with a rule above it, so the panel reads as parts not a stack. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 px-4 py-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  )
}

export function StudentDrilldown({
  student,
  insights,
}: {
  student: StudentInsight | null
  insights: GameInsights
}) {
  const [roundsOpen, setRoundsOpen] = useState(false)

  if (!student) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Pick a student to read their run.
      </div>
    )
  }

  const m = student.measures
  const longest = Math.max(1, ...student.rounds.map((r) => r.seconds ?? 0))
  const notes = [
    ...student.signals.map((signal) => ({ key: signal.id, ...signalSentence(signal) })),
    ...student.flags
      .filter((flag) => flag !== 'never_played' || !student.played)
      .map((flag) => ({
        key: flag,
        title: FLAG_STYLE[flag].label,
        body: flagSentence(flag, m, insights.class.medianWrongSubmits),
      })),
  ]

  return (
    <div>
      {notes.length > 0 && (
        <div className="space-y-2 px-4 py-3">
          {/* One surface for every note. Signals and flags used to be two different
              coloured boxes, which made the panel look patchwork and implied a
              severity difference the data does not support. */}
          {notes.map((note) => (
            <section
              key={note.key}
              className="rounded-lg border border-amber-200 bg-amber-50 p-3"
            >
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {note.title}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">{note.body}</p>
            </section>
          ))}
        </div>
      )}

      {m && (
        <>
          <Block title="How they did">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Stat
                label="Right first time"
                value={m.firstTryAccuracyPercent === null ? '—' : `${m.firstTryAccuracyPercent}%`}
              />
              <Stat
                label="Counting retries"
                value={m.trialAccuracyPercent === null ? '—' : `${m.trialAccuracyPercent}%`}
              />
              <Stat label="Times they submitted" value={String(m.submitCount ?? '—')} />
              <Stat label="Came back wrong" value={String(m.wrongSubmitCount ?? '—')} />
            </dl>
          </Block>

          <Block title="Where the time went">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Stat label="Working on the board" value={formatSeconds(m.realWorkSeconds)} />
              <Stat label="Tab hidden" value={formatSeconds(m.awaySeconds)} />
              <Stat label="Start to finish" value={formatSeconds(m.wallClockSeconds)} />
              <Stat label="Time allowed" value={formatSeconds(m.timeLimitSeconds)} />
            </dl>
          </Block>

          <Block title="Pace">
            <dl className="space-y-3">
              <div>
                <dt className="text-xs font-medium text-slate-500">{PACE_COPY.gapLabel}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {formatSeconds(m.medianSubmitGapSeconds)}
                  {insights.class.medianSubmitGapSeconds !== null && (
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      class median {formatSeconds(insights.class.medianSubmitGapSeconds)}
                    </span>
                  )}
                </dd>
                <p className="mt-1 text-xs leading-snug text-slate-500">{PACE_COPY.gapCaveat}</p>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">{PACE_COPY.reviewLabel}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {/* Never 0s for "no pauses" — an em dash plus the count says "this
                      did not happen", which 0s reads as the opposite of. */}
                  {m.reviewCount === 0 ? '—' : formatSeconds(m.medianReviewSeconds)}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {reviewPauses(m.reviewCount)}
                  </span>
                </dd>
                <p className="mt-1 text-xs leading-snug text-slate-500">{PACE_COPY.reviewCaveat}</p>
              </div>
            </dl>
          </Block>

          {student.rounds.length > 0 && (
            <section className="border-t border-slate-100">
              {/* Collapsed by default. Expanded, this block is most of the panel's
                  height, and it is the least often needed thing in it. */}
              <button
                type="button"
                onClick={() => setRoundsOpen((open) => !open)}
                aria-expanded={roundsOpen}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-inset"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Round by round
                </span>
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  {student.rounds.length} {student.rounds.length === 1 ? 'round' : 'rounds'}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${roundsOpen ? 'rotate-180' : ''}`}
                  />
                </span>
              </button>

              {roundsOpen && (
                <div className="px-4 pb-3">
                  <ul className="space-y-1.5">
                    {student.rounds.map((round) => {
                      const total = round.seconds ?? 0
                      const away = round.awaySeconds ?? 0
                      const work = round.realWorkSeconds ?? 0
                      // Scaled against the longest round, then normalised so the two
                      // segments never total more than the row they sit in.
                      const scale = total > 0 ? Math.min(1, total / longest) : 0
                      const workPct = total > 0 ? (work / total) * 100 * scale : 0
                      const awayPct = total > 0 ? (away / total) * 100 * scale : 0
                      return (
                        <li key={round.index} className="flex items-center gap-2">
                          <span className="w-4 flex-shrink-0 text-right text-xs tabular-nums text-slate-500">
                            {round.index + 1}
                          </span>
                          <span
                            className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"
                            role="img"
                            aria-label={roundAriaLabel(round)}
                          >
                            <span className="bg-violet-500" style={{ width: `${workPct}%` }} />
                            <span className="bg-violet-200" style={{ width: `${awayPct}%` }} />
                          </span>
                          <span className="w-12 flex-shrink-0 text-right text-xs tabular-nums text-slate-500">
                            {formatSeconds(total)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded bg-violet-500" aria-hidden="true" />
                      on the board
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded bg-violet-200" aria-hidden="true" />
                      tab hidden
                    </span>
                  </p>
                </div>
              )}
            </section>
          )}

          <Block title="How they worked">
            <p className="text-sm leading-relaxed text-slate-600">
              {approachLine(student.approach, m)}
            </p>
            {student.approach && (
              <p className="mt-1 text-xs text-slate-500">
                Pattern: {APPROACH_WORD[student.approach]}
              </p>
            )}
          </Block>
        </>
      )}
    </div>
  )
}

/** The card header — rendered by the container so it can stay put while the body scrolls. */
export function StudentDrilldownHeader({ student }: { student: StudentInsight }) {
  const name = student.rosterName || student.nickname || student.email || 'Unknown student'
  return (
    <div className="min-w-0">
      <h3 className="truncate text-sm font-semibold text-slate-900">{name}</h3>
      <p className="mt-0.5 truncate text-xs text-slate-500">
        {student.nickname && student.nickname !== student.rosterName
          ? `Played as “${student.nickname}”`
          : student.email}
      </p>
      {student.band && (
        <span
          className={`mt-2 inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${BAND_PILL[student.band]}`}
        >
          {BAND_WORD[student.band]}
        </span>
      )}
    </div>
  )
}

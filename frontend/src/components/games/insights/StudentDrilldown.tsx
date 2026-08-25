import { AlertTriangle } from 'lucide-react'

import type { GameInsights, StudentInsight } from '../../../services/gameService'
import { APPROACH_WORD, BAND_SURFACE, BAND_WORD, FLAG_STYLE } from './signalBand'
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
 * One student in full: what fired, what it measured, and how the run actually ran.
 *
 * The per-round strip at the bottom is the reason this panel is worth building
 * rather than sorting the CSV. "Round 2 took 238s, 181 of them with the tab
 * hidden" is a sentence a lecturer can act on; `round_seconds` and
 * `round_afk_seconds` as two semicolon-joined lists in adjacent columns is the
 * same fact nobody ever read.
 */

function Number({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{value}</dd>
    </div>
  )
}

export function StudentDrilldown({
  student,
  insights,
}: {
  student: StudentInsight | null
  insights: GameInsights
}) {
  if (!student) {
    return (
      <aside className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
        Pick a student to read their run.
      </aside>
    )
  }

  const name = student.rosterName || student.nickname || student.email || 'Unknown student'
  const m = student.measures
  const longest = Math.max(1, ...student.rounds.map((r) => r.seconds ?? 0))

  return (
    <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <header>
        <h3 className="text-sm font-semibold text-slate-900">{name}</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          {student.nickname && student.nickname !== student.rosterName
            ? `Played as “${student.nickname}”`
            : student.email}
        </p>
        {student.band && (
          <span
            className={`mt-2 inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${BAND_SURFACE[student.band]}`}
          >
            {BAND_WORD[student.band]}
          </span>
        )}
      </header>

      {!student.played && (
        <p className="text-sm text-slate-600">
          {flagSentence('never_played', null, null)}
        </p>
      )}

      {student.signals.map((signal) => {
        const { title, body } = signalSentence(signal)
        return (
          <section
            key={signal.id}
            className="rounded-lg border border-amber-200 bg-amber-50 p-3"
          >
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {title}
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/90">{body}</p>
          </section>
        )
      })}

      {student.flags
        .filter((flag) => flag !== 'never_played')
        .map((flag) => (
          <section key={flag} className={`rounded-lg border p-3 ${FLAG_STYLE[flag].cls}`}>
            <h4 className="text-xs font-semibold">{FLAG_STYLE[flag].label}</h4>
            <p className="mt-1 text-xs leading-relaxed">
              {flagSentence(flag, m, insights.class.medianWrongSubmits)}
            </p>
          </section>
        ))}

      {m && (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Number
              label="First try"
              value={m.firstTryAccuracyPercent === null ? '—' : `${m.firstTryAccuracyPercent}%`}
            />
            <Number
              label="Trial accuracy"
              value={m.trialAccuracyPercent === null ? '—' : `${m.trialAccuracyPercent}%`}
            />
            <Number label="Submits" value={String(m.submitCount ?? '—')} />
            <Number label="Came back wrong" value={String(m.wrongSubmitCount ?? '—')} />
            <Number label="Work on the board" value={formatSeconds(m.realWorkSeconds)} />
            <Number label="Tab hidden" value={formatSeconds(m.awaySeconds)} />
            <Number label="Start to finish" value={formatSeconds(m.wallClockSeconds)} />
          </dl>

          {/* Pace lives outside the <dl> because each number needs a caveat under
              it, and a definition list with prose in it is the wall this panel
              exists to avoid. */}
          <section>
            <h4 className="text-xs font-semibold text-slate-700">Pace</h4>
            <dl className="mt-2 space-y-2.5">
              <div>
                <dt className="text-xs text-slate-500">{PACE_COPY.gapLabel}</dt>
                <dd className="text-sm font-medium text-slate-900">
                  {formatSeconds(m.medianSubmitGapSeconds)}
                  {insights.class.medianSubmitGapSeconds !== null && (
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      class median {formatSeconds(insights.class.medianSubmitGapSeconds)}
                    </span>
                  )}
                </dd>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                  {PACE_COPY.gapCaveat}
                </p>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{PACE_COPY.reviewLabel}</dt>
                <dd className="text-sm font-medium text-slate-900">
                  {/* Never 0s for "no pauses" — an em dash plus the count says
                      "this did not happen", which 0s reads as the opposite of. */}
                  {m.reviewCount === 0 ? '—' : formatSeconds(m.medianReviewSeconds)}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {reviewPauses(m.reviewCount)}
                  </span>
                </dd>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                  {PACE_COPY.reviewCaveat}
                </p>
              </div>
            </dl>
          </section>

          {student.rounds.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-slate-700">Round by round</h4>
              <ul className="mt-2 space-y-1.5">
                {student.rounds.map((round) => {
                  const total = round.seconds ?? 0
                  const away = round.awaySeconds ?? 0
                  const work = round.realWorkSeconds ?? 0
                  return (
                    <li key={round.index} className="flex items-center gap-2">
                      <span className="w-4 flex-shrink-0 text-right text-[11px] text-slate-500">
                        {round.index + 1}
                      </span>
                      <span
                        className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"
                        role="img"
                        aria-label={roundAriaLabel(round)}
                      >
                        {/* Work then away, each at least a sliver wide so a round
                            with no absence still paints something. */}
                        <span
                          className="bg-violet-500"
                          style={{ width: `${Math.max(2, (work / longest) * 100)}%` }}
                        />
                        {away > 0 && (
                          <span
                            className="bg-violet-200"
                            style={{ width: `${Math.max(2, (away / longest) * 100)}%` }}
                          />
                        )}
                      </span>
                      <span className="w-12 flex-shrink-0 text-right text-[11px] text-slate-500">
                        {formatSeconds(total)}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-1.5 text-[11px] text-slate-500">
                <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-500" aria-hidden="true" />
                work on the board
                <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm bg-violet-200" aria-hidden="true" />
                tab hidden
              </p>
            </section>
          )}

          <p className="text-xs leading-relaxed text-slate-600">
            {approachLine(student.approach, m)}
            {student.approach && (
              <span className="ml-1 text-slate-400">({APPROACH_WORD[student.approach]})</span>
            )}
          </p>
        </>
      )}
    </aside>
  )
}

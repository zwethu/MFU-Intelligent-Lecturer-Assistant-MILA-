import type {
  ApproachId,
  FlagId,
  InsightMeasures,
  InsightSignal,
  StudentInsight,
} from '../../../services/gameService'

/**
 * Every sentence the panel says about a student, in one file.
 *
 * One file because the row and the drilldown say the same things, and copy that
 * lives in two places drifts until they disagree about a person.
 *
 * The rule these follow is the one `components/wellness/ReportCard.tsx` states:
 * a factual sentence is actionable, a verdict gets the dialog closed. So every
 * sentence here reports a measurement and stops. None of them contains "likely",
 * "probably", "suspicious", "cheating", or a percentage chance — `signalCopy.test.ts`
 * asserts that, because it is the only part of this decision that survives a
 * rushed pull request six months from now.
 */

function seconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value < 60) return `${Math.round(value)}s`
  const mins = Math.floor(value / 60)
  const rest = Math.round(value % 60)
  return rest ? `${mins}m ${rest}s` : `${mins}m`
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** Heading + body for one signal. The body always carries the caveat. */
export function signalSentence(signal: InsightSignal): { title: string; body: string } {
  if (signal.id === 'long_absences') {
    const rounds = signal.roundsAway
    const where = rounds > 0 ? `, across ${rounds} ${plural(rounds, 'round', 'rounds')}` : ''
    const comparison =
      signal.realWorkSeconds !== null && signal.classMedianRealWorkSeconds !== null
        ? ` Work still took ${seconds(signal.realWorkSeconds)} against a class median of ${seconds(signal.classMedianRealWorkSeconds)}.`
        : ''
    return {
      title: 'The tab was hidden for a while',
      // The comparison is not decoration. In real data the students who left the
      // tab scored better than those who did not, so a sentence without that
      // context reads as an accusation rather than a measurement.
      body:
        `Hidden for ${seconds(signal.awaySeconds)}${where}.` +
        comparison +
        ' A hidden tab is a hidden tab — it does not say what was on the other side of it.',
    }
  }

  const against =
    signal.classMedianFirstTryAccuracy !== null
      ? ` — the class median is ${signal.classMedianFirstTryAccuracy}%`
      : ''
  return {
    title: 'Every round was right first time',
    body:
      `${signal.submits} ${plural(signal.submits, 'submit', 'submits')} for ` +
      `${signal.rounds} ${plural(signal.rounds, 'round', 'rounds')}, none wrong. ` +
      `First-try accuracy ${signal.firstTryAccuracy ?? '—'}%${against}. ` +
      'A round ends when it is all correct, so those are one measurement. It counts once.',
  }
}

/** Chip label plus the sentence under it. Both factual; neither is a question. */
export function flagSentence(
  flag: FlagId,
  measures: InsightMeasures | null,
  classMedianWrongSubmits: number | null,
): string {
  if (flag === 'never_played') {
    return 'On the roster, no attempt recorded. The link may not have reached them.'
  }
  if (flag === 'ran_out_of_time') {
    const done = measures?.roundsCompleted ?? 0
    const total = measures?.totalRounds ?? 0
    return `Clock ran out at ${done} of ${total} ${plural(total, 'round', 'rounds')}.`
  }
  if (flag === 'high_rework') {
    const n = measures?.wrongSubmitCount ?? 0
    const median = classMedianWrongSubmits
    const against = median === null ? '' : ` The class median is ${median}.`
    return `${n} ${plural(n, 'submit', 'submits')} came back wrong.${against}`
  }
  const first = measures?.firstTryAccuracyPercent ?? 0
  return `${first}% right on the first try. This one did not land.`
}

/** How they worked. Never ranked — a planner is not better than a steady worker. */
export function approachLine(
  approach: ApproachId | null,
  measures: InsightMeasures | null,
): string {
  const wrong = measures?.wrongSubmitCount ?? 0

  // No pace clause: the gap now has its own labelled cell with its own caveat,
  // and printing the same number twice is the redundancy this rewrite removes.
  if (approach === 'planner') {
    return `Reads as a planner: ${wrong} came back wrong.`
  }
  if (approach === 'trial_and_error') {
    return `Reads as trial and error: ${wrong} came back wrong.`
  }
  return 'No strong pattern — worked steadily.'
}

/** The one-line summary under a student's name in the list. */
export function rowSummary(student: StudentInsight): string {
  if (!student.played) return 'Never opened it'
  const m = student.measures
  const parts: string[] = []
  if (m?.firstTryAccuracyPercent !== null && m?.firstTryAccuracyPercent !== undefined) {
    parts.push(`First try ${m.firstTryAccuracyPercent}%`)
  }
  if (m?.realWorkSeconds !== null && m?.realWorkSeconds !== undefined) {
    parts.push(`${seconds(m.realWorkSeconds)} of work`)
  }
  return parts.join(' · ')
}

/** Spoken description of one round's bar, so the strip is not sighted-only. */
export function roundAriaLabel(round: {
  index: number
  seconds: number | null
  awaySeconds: number | null
  realWorkSeconds: number | null
}): string {
  const away = round.awaySeconds ?? 0
  const hidden = away > 0 ? `, ${Math.round(away)} of them with the tab hidden` : ''
  return (
    `Round ${round.index + 1}: ${Math.round(round.seconds ?? 0)} seconds${hidden}, ` +
    `${Math.round(round.realWorkSeconds ?? 0)} seconds of work on the board.`
  )
}

/**
 * The two pace numbers and the caveats that make them safe to read.
 *
 * Both caveats are load-bearing. A submit gap includes any time the tab was hidden
 * during it, which is why the panel takes a median rather than a mean. And a review
 * pause is a PREFIX of the next gap, not a separate quantity — a lecturer who adds
 * the two together double-counts the same seconds.
 */
export const PACE_COPY = {
  gapLabel: 'Typical gap between answers',
  gapCaveat: 'A median, not an average — and a gap includes any time the tab was hidden.',
  reviewLabel: 'Time spent reading feedback',
  reviewCaveat: 'Only recorded after a wrong answer, and already counted inside the gap above.',
}

/** What the review median is averaged over. Zero is a real answer, not a gap. */
export function reviewPauses(count: number | null | undefined): string {
  if (count === null || count === undefined) return ''
  if (count === 0) return 'no pauses recorded'
  return `across ${count} ${plural(count, 'pause', 'pauses')}`
}

export { seconds as formatSeconds }

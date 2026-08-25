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
        ? ` Work on the board still took ${seconds(signal.realWorkSeconds)}, against a class median of ${seconds(signal.classMedianRealWorkSeconds)}.`
        : ''
    return {
      title: 'The tab was hidden for a while',
      // The comparison is not decoration. In real data the students who left the
      // tab scored better than those who did not, so a sentence without that
      // context reads as an accusation rather than a measurement.
      body:
        `The tab was hidden for ${seconds(signal.awaySeconds)} in total${where}.` +
        comparison +
        ' A hidden tab is a hidden tab. It does not say what was on the other side of it.',
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
      `${signal.rounds} ${plural(signal.rounds, 'round', 'rounds')}, none of them wrong. ` +
      `First-try accuracy ${signal.firstTryAccuracy ?? '—'}%${against}. ` +
      'First-try accuracy and "no wrong submits" are the same measurement here: a round ' +
      'ends the moment it is all correct. It counts once.',
  }
}

/** Chip label plus the sentence under it. Both factual; neither is a question. */
export function flagSentence(
  flag: FlagId,
  measures: InsightMeasures | null,
  classMedianWrongSubmits: number | null,
): string {
  if (flag === 'never_played') {
    return 'On the roster, with no attempt recorded. The link may not have reached them.'
  }
  if (flag === 'ran_out_of_time') {
    const done = measures?.roundsCompleted ?? 0
    const total = measures?.totalRounds ?? 0
    return `The clock ended the run with ${done} of ${total} ${plural(total, 'round', 'rounds')} cleared.`
  }
  if (flag === 'high_rework') {
    const n = measures?.wrongSubmitCount ?? 0
    const median = classMedianWrongSubmits
    const against = median === null ? '' : ` The class median is ${median}.`
    return `${n} ${plural(n, 'submit', 'submits')} came back wrong.${against}`
  }
  const first = measures?.firstTryAccuracyPercent ?? 0
  return `${first}% of pairs were right on the first try. This one did not land.`
}

/** How they worked. Never ranked — a planner is not better than a steady worker. */
export function approachLine(
  approach: ApproachId | null,
  measures: InsightMeasures | null,
): string {
  const gap = measures?.medianSubmitGapSeconds
  const wrong = measures?.wrongSubmitCount ?? 0
  const pace = gap === null || gap === undefined ? '' : `${seconds(gap)} between submits, `

  if (approach === 'planner') {
    return `Reads as a planner: ${pace}${wrong} came back wrong.`
  }
  if (approach === 'trial_and_error') {
    return `Reads as trial and error: ${pace}${wrong} came back wrong.`
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

export { seconds as formatSeconds }

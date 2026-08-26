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
        ? ` Even so, they spent ${seconds(signal.realWorkSeconds)} actually working on the board — the class median is ${seconds(signal.classMedianRealWorkSeconds)}.`
        : ''
    return {
      title: 'The tab was hidden for a while',
      // The comparison is not decoration. In real data the students who left the
      // tab scored better than those who did not, so a sentence without that
      // context reads as an accusation rather than a measurement.
      body:
        `This tab was hidden for ${seconds(signal.awaySeconds)} in total${where}.` +
        comparison +
        ' All we know is that the tab was not in front. It does not say what was on ' +
        'the other side of it, and plenty of people who left the tab did well.',
    }
  }

  const against =
    signal.classMedianFirstTryAccuracy !== null
      ? ` — the class median is ${signal.classMedianFirstTryAccuracy}%`
      : ''
  return {
    title: 'Every round was right first time',
    body:
      `They answered every one of the ${signal.rounds} ` +
      `${plural(signal.rounds, 'round', 'rounds')} correctly on the first try — ` +
      `${signal.submits} ${plural(signal.submits, 'submit', 'submits')}, none of them wrong. ` +
      `That is ${signal.firstTryAccuracy ?? '—'}% first-try accuracy${against}. ` +
      'A round only ends once everything on it is right, so "all correct first time" and ' +
      '"no wrong answers" are one measurement here, not two. It counts once.',
  }
}

/** Chip label plus the sentence under it. Both factual; neither is a question. */
export function flagSentence(
  flag: FlagId,
  measures: InsightMeasures | null,
  classMedianWrongSubmits: number | null,
): string {
  if (flag === 'never_played') {
    return 'They are on the class roster, but the game has no record of them opening it. ' +
      'The link may not have reached them.'
  }
  if (flag === 'ran_out_of_time') {
    const done = measures?.roundsCompleted ?? 0
    const total = measures?.totalRounds ?? 0
    return `The time limit ended their game with ${done} of ${total} ` +
      `${plural(total, 'round', 'rounds')} finished.`
  }
  if (flag === 'high_rework') {
    const n = measures?.wrongSubmitCount ?? 0
    const median = classMedianWrongSubmits
    const against = median === null ? '' : ` Most of the class had ${median}.`
    return `They pressed submit ${n} ${plural(n, 'time', 'times')} and got a wrong ` +
      `answer back.${against} Worth checking which pairs kept catching them out.`
  }
  const first = measures?.firstTryAccuracyPercent ?? 0
  return `Only ${first}% of pairs were right on the first try, so this material has ` +
    'not landed for them yet.'
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
    return `Reads as a planner — they worked it out before submitting, and only ` +
      `${wrong} ${plural(wrong, 'answer', 'answers')} came back wrong.`
  }
  if (approach === 'trial_and_error') {
    return `Reads as trial and error — they submitted quickly and often, with ` +
      `${wrong} ${plural(wrong, 'answer', 'answers')} coming back wrong.`
  }
  return 'No strong pattern — they worked steadily through it.'
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
  gapLabel: 'Typical time between answers',
  gapCaveat:
    'The middle value across the whole game, not an average, so one long pause does ' +
    'not skew it. If the tab was hidden during a gap, that time is inside this number.',
  reviewLabel: 'Time spent looking at a wrong answer',
  reviewCaveat:
    'Measured from being told an answer was wrong to touching the board again. It sits ' +
    'inside the gap above rather than beside it, so do not add the two together.',
}

/** What the review median is averaged over. Zero is a real answer, not a gap. */
export function reviewPauses(count: number | null | undefined): string {
  if (count === null || count === undefined) return ''
  if (count === 0) return 'no pauses recorded'
  return `across ${count} ${plural(count, 'pause', 'pauses')}`
}

export { seconds as formatSeconds }

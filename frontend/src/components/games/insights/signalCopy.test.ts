import { describe, expect, it } from 'vitest'

import type { InsightMeasures, InsightSignal } from '../../../services/gameService'
import {
  PACE_COPY,
  approachLine,
  flagSentence,
  formatSeconds,
  reviewPauses,
  signalSentence,
} from './signalCopy'

const measures = (over: Partial<InsightMeasures> = {}): InsightMeasures =>
  ({
    firstTryAccuracyPercent: 71,
    trialAccuracyPercent: 80,
    medal: 'gold',
    gameMode: 'matching',
    correctCount: 30,
    submitCount: 5,
    wrongSubmitCount: 0,
    wrongPairs: 0,
    realWorkSeconds: 292,
    playSeconds: 473,
    awaySeconds: 181,
    awayCount: 2,
    wallClockSeconds: 486,
    timeLimitSeconds: 900,
    planningSeconds: 8.4,
    medianSubmitGapSeconds: 34.2,
    medianReviewSeconds: 5.4,
    reviewCount: 8,
    timedOut: false,
    roundsCompleted: 5,
    totalRounds: 5,
    completedAt: null,
    ...over,
  }) as InsightMeasures

const awaySignal: InsightSignal = {
  id: 'long_absences',
  awaySeconds: 181,
  roundsAway: 2,
  realWorkSeconds: 292,
  classMedianRealWorkSeconds: 480,
}

const flawlessSignal: InsightSignal = {
  id: 'flawless_run',
  firstTryAccuracy: 100,
  submits: 5,
  rounds: 5,
  classMedianFirstTryAccuracy: 71,
}

describe('signal sentences', () => {
  it('reports what the away measurement actually was', () => {
    const { body } = signalSentence(awaySignal)
    expect(body).toContain('3m 1s')
    expect(body).toContain('2 rounds')
  })

  /**
   * Load-bearing. Students who left the tab score BETTER in real data (81% vs
   * 59% first-try), so a sentence without the class comparison invites the
   * lecturer to read a measurement as a confession.
   */
  it('always sets the away time against what the class did', () => {
    const { body } = signalSentence(awaySignal)
    expect(body).toContain('class median')
    expect(body).toContain('does not say what was on the other side of it')
  })

  it('says that a flawless run counts once', () => {
    const { body } = signalSentence(flawlessSignal)
    expect(body).toContain('one measurement')
    expect(body).toContain('It counts once.')
  })

  it('sets first-try accuracy against the class median', () => {
    expect(signalSentence(flawlessSignal).body).toContain('class median is 71%')
  })
})

describe('flag sentences', () => {
  it('names the rounds actually cleared when the clock ran out', () => {
    const text = flagSentence('ran_out_of_time', measures({ roundsCompleted: 3 }), 4)
    expect(text).toContain('3 of 5')
  })

  it('sets resubmits against the class median', () => {
    const text = flagSentence('high_rework', measures({ wrongSubmitCount: 18 }), 4)
    expect(text).toContain('18 submits')
    expect(text).toContain('class median is 4')
  })

  it('explains a never-played row rather than blaming the student', () => {
    const text = flagSentence('never_played', null, null)
    expect(text).toContain('may not have reached them')
  })
})

describe('approach lines', () => {
  it('describes a planner without ranking them', () => {
    expect(approachLine('planner', measures())).toContain('planner')
  })

  it('describes trial and error without ranking them', () => {
    const text = approachLine('trial_and_error', measures({ wrongSubmitCount: 19 }))
    expect(text).toContain('trial and error')
    expect(text).toContain('19')
  })

  it('says plainly when there is no pattern', () => {
    expect(approachLine('steady', measures())).toContain('No strong pattern')
  })
})

/**
 * The user's decision, encoded so it survives a rushed pull request.
 *
 * The client asked for "a percentage chance this student used AI". There is no
 * ground truth in this system to calibrate such a number against, so the panel
 * reports named measurements instead. This test is what stops that decision being
 * quietly reversed by someone adding one "likely" six months from now.
 */
describe('nothing here accuses anyone', () => {
  const BANNED = [
    'likely',
    'probably',
    'probability',
    'chance',
    'suspicious',
    'suspect',
    'cheat',
    'cheating',
    'dishonest',
    'evidence of',
    'caught',
    ' ai ',
  ]

  const everySentence = (): string[] => {
    const out: string[] = []
    for (const signal of [awaySignal, flawlessSignal]) {
      const { title, body } = signalSentence(signal)
      out.push(title, body)
    }
    for (const flag of ['ran_out_of_time', 'high_rework', 'struggling', 'never_played'] as const) {
      out.push(flagSentence(flag, measures(), 4))
    }
    for (const approach of ['planner', 'trial_and_error', 'steady'] as const) {
      out.push(approachLine(approach, measures()))
    }
    out.push(...Object.values(PACE_COPY), reviewPauses(8), reviewPauses(0))
    return out
  }

  it.each(BANNED)('never says %s', (word) => {
    for (const sentence of everySentence()) {
      expect(` ${sentence.toLowerCase()} `).not.toContain(word)
    }
  })

  it('never states a percentage of anything but an accuracy the game measured', () => {
    for (const sentence of everySentence()) {
      const percentages = sentence.match(/(\d+)%/g) ?? []
      if (percentages.length === 0) continue
      // Every % in the copy must be an accuracy figure, never a likelihood.
      expect(sentence.toLowerCase()).toMatch(/accuracy|right on the first try|first try/)
    }
  })
})

describe('formatSeconds', () => {
  it('renders under a minute in seconds', () => {
    expect(formatSeconds(45)).toBe('45s')
  })

  it('renders minutes and seconds', () => {
    expect(formatSeconds(181)).toBe('3m 1s')
  })

  it('drops a zero seconds remainder', () => {
    expect(formatSeconds(120)).toBe('2m')
  })

  it('renders an unknown value as a dash, never as zero', () => {
    expect(formatSeconds(null)).toBe('—')
  })
})

describe('pace copy', () => {
  it('says a gap is a median and that it contains hidden-tab time', () => {
    expect(PACE_COPY.gapCaveat).toContain('median, not an average')
    expect(PACE_COPY.gapCaveat).toContain('tab was hidden')
  })

  /**
   * The one that stops a lecturer double-counting: a review pause is a PREFIX of
   * the next submit gap, not a separate quantity, so adding them is wrong.
   */
  it('warns that reading time is already inside the gap', () => {
    expect(PACE_COPY.reviewCaveat).toContain('already counted inside the gap above')
  })

  it('says what the review median is averaged over', () => {
    expect(reviewPauses(8)).toBe('across 8 pauses')
    expect(reviewPauses(1)).toBe('across 1 pause')
  })

  it('says nothing happened rather than implying it was instant', () => {
    expect(reviewPauses(0)).toBe('no pauses recorded')
  })
})

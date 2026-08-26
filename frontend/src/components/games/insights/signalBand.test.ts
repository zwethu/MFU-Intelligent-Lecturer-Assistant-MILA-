import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { ApproachId, FlagId, InsightBand } from '../../../services/gameService'
import { APPROACH_WORD, BAND_BAR, BAND_PILL, BAND_WORD, FLAG_STYLE, bandAriaLabel } from './signalBand'

const BANDS: InsightBand[] = ['typical', 'one', 'two']
const FLAGS: FlagId[] = ['ran_out_of_time', 'high_rework', 'struggling', 'never_played']
const APPROACHES: ApproachId[] = ['planner', 'trial_and_error', 'steady']

describe('every band and flag is complete', () => {
  /**
   * Colour alone is not a label — a red border is invisible to roughly one reader
   * in eight (see ui/fieldStyles.ts). Every entry owes a word as well as a tint.
   */
  it.each(BANDS)('%s has a bar colour, a pill style and a word', (band) => {
    expect(BAND_BAR[band]).toBeTruthy()
    expect(BAND_PILL[band]).toBeTruthy()
    expect(BAND_WORD[band]).toBeTruthy()
  })

  it.each(FLAGS)('%s has both a style and a label', (flag) => {
    expect(FLAG_STYLE[flag].cls).toBeTruthy()
    expect(FLAG_STYLE[flag].label).toBeTruthy()
  })

  it.each(APPROACHES)('%s has a word', (approach) => {
    expect(APPROACH_WORD[approach]).toBeTruthy()
  })
})

describe('the band words describe rather than judge', () => {
  it('names a count, not a verdict', () => {
    expect(BAND_WORD.two).toBe('2 signals')
    expect(BAND_WORD.one).toBe('1 signal')
    expect(BAND_WORD.typical).toBe('Nothing stood out')
  })

  it.each(BANDS)('%s avoids alarm vocabulary', (band) => {
    const word = BAND_WORD[band].toLowerCase()
    for (const banned of ['risk', 'suspicious', 'likely', 'cheat', 'flagged', 'violation']) {
      expect(word).not.toContain(banned)
    }
  })

  it('speaks the band as a sentence with its scale', () => {
    expect(bandAriaLabel('Somchai', 'two', 2)).toBe(
      'Somchai: 2 of the 2 signals this game can measure.',
    )
    expect(bandAriaLabel('Somchai', 'typical', 2)).toContain('none of the 2 signals')
  })
})

describe('contrast floors', () => {
  /**
   * slate-400 measures 2.63:1 on white, under the 3:1 floor for a graphical
   * control. slate-500 clears it at 4.76:1. Enforced elsewhere in the app by
   * comment; enforced here by test.
   */
  it.each(BANDS)('%s does not use text-slate-400', (band) => {
    expect(BAND_PILL[band]).not.toContain('text-slate-400')
  })

  it.each(FLAGS)('%s does not use text-slate-400', (flag) => {
    expect(FLAG_STYLE[flag].cls).not.toContain('text-slate-400')
  })
})

/**
 * The band arrives already decided from the backend. If this file ever grew a
 * `bandOf(score)` the app would have two derivations of one number in two
 * languages, and they would drift — which is exactly the failure
 * components/wellness/stressLevel.ts documents at the top of its own file.
 */
describe('the band is mapped here, never derived here', () => {
  const source = readFileSync('src/components/games/insights/signalBand.ts', 'utf8')

  it('exports nothing that returns a band', () => {
    // A function taking a number is fine — bandAriaLabel formats one. A function
    // RETURNING an InsightBand would be a second derivation of the backend's
    // decision, and that is the thing that drifts.
    expect(source).not.toMatch(/\)\s*:\s*InsightBand/)
  })

  it('contains no threshold comparison', () => {
    // No `>= 90`, `< 50` and so on: cut points belong to the service, which is
    // the only place that has the class distribution to set them against.
    expect(source).not.toMatch(/[<>]=?\s*\d/)
  })
})

/**
 * The legend and the bar used to be painted from different maps, and every legend
 * swatch came out lighter than the segment it was labelling. A legend that
 * disagrees with its chart is worse than no legend at all.
 */
describe('the legend cannot disagree with the bar', () => {
  it('gives every band exactly one fill, used by both', () => {
    for (const band of BANDS) {
      expect(BAND_BAR[band]).toMatch(/^bg-[a-z]+-\d{2,3}$/)
    }
  })

  it('keeps the three fills distinct', () => {
    const fills = BANDS.map((band) => BAND_BAR[band])
    expect(new Set(fills).size).toBe(BANDS.length)
  })

  /** bg-slate-50 on a white card measured ~1.03:1 — invisible as a swatch. */
  it('never paints a band in a near-white fill', () => {
    for (const band of BANDS) {
      expect(BAND_BAR[band]).not.toMatch(/-(50|100)$/)
    }
  })
})

/** Red in this app means a system error or a destructive action, never a person. */
describe('no flag is painted red', () => {
  it.each(FLAGS)('%s avoids the danger ramp', (flag) => {
    expect(FLAG_STYLE[flag].cls).not.toContain('red')
  })
})

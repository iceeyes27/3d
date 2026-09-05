import { describe, expect, it } from 'vitest'
import { calculateQuestScore, scoreCoreQuest, scoreFinalQuest } from './scoring'

describe('quest scoring', () => {
  it('scores quests 1-11 with the 60/20/10/10 weights', () => {
    const score = scoreCoreQuest({
      questId: 7,
      core: 55,
      accuracy: 18,
      independence: 8,
      process: 9,
      selfAssessment: 100,
    })
    expect(score.competitionScore).toBe(90)
    expect(score.automaticScore).toBe(90)
    expect(score.reviewStatus).toBe('not-required')
    expect(score.selfAssessment).toBe(100)
  })

  it('clamps component points without allowing self-assessment to increase the score', () => {
    const score = calculateQuestScore({ questId: 1, core: 80, accuracy: -1, independence: 11, process: 20, selfAssessment: 999 })
    expect(score.breakdown).toEqual({ core: 60, accuracy: 0, independence: 10, process: 10 })
    expect(score.competitionScore).toBe(80)
  })

  it('marks quest 12 pending until a valid manual score is reviewed', () => {
    expect(scoreFinalQuest({ questId: 12, technical: 54 })).toMatchObject({
      automaticScore: 54,
      competitionScore: 54,
      manualScore: null,
      reviewStatus: 'pending',
    })
    expect(scoreFinalQuest({ questId: 12, technical: 54, manualReview: { status: 'pending', score: 40 } })).toMatchObject({
      competitionScore: 54,
      manualScore: null,
      reviewStatus: 'pending',
    })
  })

  it('adds a reviewed manual score to quest 12 and clamps both sections', () => {
    const score = scoreFinalQuest({ questId: 12, technical: 70, manualReview: { status: 'reviewed', score: 45 }, selfAssessment: 100 })
    expect(score).toMatchObject({ automaticScore: 60, manualScore: 40, competitionScore: 100, reviewStatus: 'reviewed' })
  })

  it('rejects a final-quest id in the core scoring path', () => {
    expect(() => scoreCoreQuest({ questId: 12, core: 1, accuracy: 1, independence: 1, process: 1 })).toThrow(RangeError)
  })
})

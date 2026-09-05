export type ManualReviewStatus = 'pending' | 'reviewed'

export interface ManualScoreReview {
  status: ManualReviewStatus
  score?: number
}

export interface CoreQuestScoreInput {
  questId: number
  core: number
  accuracy: number
  independence: number
  process: number
  /** Displayed to the child, but deliberately excluded from competition scoring. */
  selfAssessment?: number
}

export interface FinalQuestScoreInput {
  questId: 12
  technical: number
  manualReview?: ManualScoreReview
  /** Displayed to the child, but deliberately excluded from competition scoring. */
  selfAssessment?: number
}

export interface ScoreBreakdown {
  core?: number
  accuracy?: number
  independence?: number
  process?: number
  technical?: number
  manual?: number
}

export interface QuestScore {
  questId: number
  competitionScore: number
  maximumScore: 100
  automaticScore: number
  manualScore: number | null
  reviewStatus: 'not-required' | ManualReviewStatus
  breakdown: ScoreBreakdown
  selfAssessment?: number
}

const clampPoints = (value: number, maximum: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.min(maximum, Math.max(0, value))
}

/** Score a quest from 1 to 11: core 60 + accuracy 20 + independence 10 + process 10. */
export function scoreCoreQuest(input: CoreQuestScoreInput): QuestScore {
  if (!Number.isInteger(input.questId) || input.questId < 1 || input.questId > 11) {
    throw new RangeError('Core quest id must be an integer from 1 to 11')
  }

  const breakdown = {
    core: clampPoints(input.core, 60),
    accuracy: clampPoints(input.accuracy, 20),
    independence: clampPoints(input.independence, 10),
    process: clampPoints(input.process, 10),
  }
  const automaticScore = breakdown.core + breakdown.accuracy + breakdown.independence + breakdown.process
  return {
    questId: input.questId,
    competitionScore: automaticScore,
    maximumScore: 100,
    automaticScore,
    manualScore: null,
    reviewStatus: 'not-required',
    breakdown,
    ...(Number.isFinite(input.selfAssessment) ? { selfAssessment: input.selfAssessment } : {}),
  }
}

/** Score quest 12: automated technical score 60 + a manual review worth 40. */
export function scoreFinalQuest(input: FinalQuestScoreInput): QuestScore {
  const technical = clampPoints(input.technical, 60)
  const reviewed = input.manualReview?.status === 'reviewed' && Number.isFinite(input.manualReview.score)
  const manualScore = reviewed ? clampPoints(input.manualReview?.score ?? 0, 40) : null
  return {
    questId: 12,
    competitionScore: technical + (manualScore ?? 0),
    maximumScore: 100,
    automaticScore: technical,
    manualScore,
    reviewStatus: reviewed ? 'reviewed' : 'pending',
    breakdown: {
      technical,
      ...(manualScore === null ? {} : { manual: manualScore }),
    },
    ...(Number.isFinite(input.selfAssessment) ? { selfAssessment: input.selfAssessment } : {}),
  }
}

export function calculateQuestScore(input: CoreQuestScoreInput | FinalQuestScoreInput): QuestScore {
  return input.questId === 12
    ? scoreFinalQuest(input as FinalQuestScoreInput)
    : scoreCoreQuest(input as CoreQuestScoreInput)
}

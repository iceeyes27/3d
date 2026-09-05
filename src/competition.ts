export type CompetitionScoreSource = 'automatic' | 'manual' | 'self-assessment'

export interface CompetitionScoreComponent {
  id: string
  label: string
  maximumPoints: number
  source: CompetitionScoreSource
  countsTowardScore?: boolean
}

export interface CompetitionRulePackage {
  id: string
  name: string
  version: number
  year: number
  gradeGroup: string
  allowedTools: string[]
  durationMinutes: number
  deliverables: string[]
  originality: {
    required: boolean
    policy: string
  }
  aiPolicy: string
  components: CompetitionScoreComponent[]
  requireAllScoredComponents?: boolean
}

export interface CompetitionScoreResult {
  score: number
  maximumScore: number
  pendingComponentIds: string[]
  complete: boolean
  breakdown: Record<string, number>
}

const included = (component: CompetitionScoreComponent) =>
  component.countsTowardScore !== false && component.source !== 'self-assessment'

export function validateCompetitionRules(rules: CompetitionRulePackage): string[] {
  const errors: string[] = []
  if (!rules.id.trim()) errors.push('Rule package id is required')
  if (!rules.name.trim()) errors.push('Rule package name is required')
  if (!Number.isInteger(rules.version) || rules.version < 1) errors.push('Rule package version must be a positive integer')
  if (!Number.isInteger(rules.year) || rules.year < 2000) errors.push('Competition year must be valid')
  if (!rules.gradeGroup.trim()) errors.push('Grade group is required')
  if (!Number.isFinite(rules.durationMinutes) || rules.durationMinutes <= 0) errors.push('Duration must be positive')
  if (!rules.deliverables.length) errors.push('At least one deliverable is required')
  if (!rules.originality.policy.trim()) errors.push('Originality policy is required')
  if (!rules.aiPolicy.trim()) errors.push('AI policy is required')
  const seen = new Set<string>()
  for (const component of rules.components) {
    if (!component.id.trim()) errors.push('Component id is required')
    if (seen.has(component.id)) errors.push(`Duplicate component id: ${component.id}`)
    seen.add(component.id)
    if (!Number.isFinite(component.maximumPoints) || component.maximumPoints < 0) {
      errors.push(`Invalid maximum points for component: ${component.id}`)
    }
  }
  return errors
}

/** Apply a reusable rule package. Self-assessment is retained as input but never adds competition points. */
export function scoreCompetitionEntry(
  rules: CompetitionRulePackage,
  componentScores: Readonly<Record<string, number | null | undefined>>,
): CompetitionScoreResult {
  const errors = validateCompetitionRules(rules)
  if (errors.length) throw new Error(errors.join('; '))

  const breakdown: Record<string, number> = {}
  const pendingComponentIds: string[] = []
  let score = 0
  let maximumScore = 0

  for (const component of rules.components) {
    if (!included(component)) continue
    maximumScore += component.maximumPoints
    const raw = componentScores[component.id]
    if (raw === null || raw === undefined || !Number.isFinite(raw)) {
      pendingComponentIds.push(component.id)
      continue
    }
    const points = Math.min(component.maximumPoints, Math.max(0, raw))
    breakdown[component.id] = points
    score += points
  }

  return {
    score,
    maximumScore,
    pendingComponentIds,
    complete: rules.requireAllScoredComponents === false || pendingComponentIds.length === 0,
    breakdown,
  }
}

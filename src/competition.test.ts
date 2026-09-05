import { describe, expect, it } from 'vitest'
import { scoreCompetitionEntry, validateCompetitionRules, type CompetitionRulePackage } from './competition'

const rules: CompetitionRulePackage = {
  id: 'reusable-rule-pack',
  name: 'Reusable rule pack',
  version: 1,
  year: 2026,
  gradeGroup: 'example group',
  allowedTools: ['example tool'],
  durationMinutes: 90,
  deliverables: ['model file'],
  originality: { required: true, policy: 'Submit original work.' },
  aiPolicy: 'Follow the organizer policy.',
  requireAllScoredComponents: true,
  components: [
    { id: 'automatic', label: 'Automatic', maximumPoints: 60, source: 'automatic' },
    { id: 'judge', label: 'Judge', maximumPoints: 40, source: 'manual' },
    { id: 'reflection', label: 'Reflection', maximumPoints: 100, source: 'self-assessment' },
  ],
}

describe('generic competition rules', () => {
  it('applies rule data without counting self-assessment', () => {
    expect(scoreCompetitionEntry(rules, { automatic: 58, judge: 35, reflection: 100 })).toEqual({
      score: 93,
      maximumScore: 100,
      pendingComponentIds: [],
      complete: true,
      breakdown: { automatic: 58, judge: 35 },
    })
  })

  it('reports missing scored components as pending', () => {
    expect(scoreCompetitionEntry(rules, { automatic: 58 })).toMatchObject({
      score: 58,
      pendingComponentIds: ['judge'],
      complete: false,
    })
  })

  it('validates malformed and duplicate rule components', () => {
    expect(validateCompetitionRules({ ...rules, components: [rules.components[0], rules.components[0]] })).toContain('Duplicate component id: automatic')
  })

  it('validates required event metadata without embedding a particular event', () => {
    expect(validateCompetitionRules({ ...rules, durationMinutes: 0 })).toContain('Duration must be positive')
    expect(validateCompetitionRules(rules)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import {
  PROGRESS_STORAGE_KEY,
  LEGACY_PROGRESS_STORAGE_KEY,
  awardQuestBadge,
  completePractice,
  completeQuest,
  emptyProgress,
  isQuestUnlocked,
  loadProgress,
  markQuestReviewPending,
  recordChallengeScore,
  recordQuestReview,
  saveProject,
} from './progress'

describe('learning progress', () => {
  it('falls back safely when stored data is malformed', () => {
    const storage = { getItem: () => '{bad json' }
    expect(loadProgress(storage)).toEqual(emptyProgress())
  })

  it('completes a quest once and unlocks the next quest', () => {
    const progress = completeQuest(emptyProgress(), 1, 2)
    const repeated = completeQuest(progress, 1, 1)
    expect(repeated.completedQuestIds).toEqual([1])
    expect(repeated.starsByQuest[1]).toBe(2)
    expect(isQuestUnlocked(repeated, 2)).toBe(true)
    expect(isQuestUnlocked(repeated, 3)).toBe(false)
  })

  it('stores project data without removing other progress', () => {
    const progress = completeQuest(emptyProgress(), 1, 3)
    const next = saveProject(progress, 2, { shapes: [], operations: [], updatedAt: 42 })
    expect(next.completedQuestIds).toEqual([1])
    expect(next.projects[2]).toMatchObject({ courseVersion: 2, updatedAt: 42 })
  })

  it('cleans valid JSON with unsafe progress fields', () => {
    const storage = {
      getItem: () => JSON.stringify({
        version: 1,
        completedQuestIds: [2, 3],
        starsByQuest: { 2: -1, 3: 99 },
        projects: { 1: {} },
        lastPlayedQuestId: 999,
      }),
    }
    expect(loadProgress(storage)).toEqual(emptyProgress())
  })

  it('reports storage failures without throwing', async () => {
    const { saveProgress } = await import('./progress')
    const storage = { setItem: () => { throw new Error('quota') } }
    expect(saveProgress(emptyProgress(), storage)).toBe(false)
  })

  it('saves only normalized v2 data under the v2 key', async () => {
    const { saveProgress } = await import('./progress')
    let savedKey = ''
    let savedValue = ''
    expect(saveProgress(emptyProgress(), {
      setItem: (key, value) => {
        savedKey = key
        savedValue = value
      },
    })).toBe(true)
    expect(savedKey).toBe(PROGRESS_STORAGE_KEY)
    expect(JSON.parse(savedValue)).toMatchObject({ version: 2, completedPracticeIds: [] })
  })

  it('migrates the legacy key to a clean in-memory v2 model', () => {
    const storage = {
      getItem: (key: string) => key === LEGACY_PROGRESS_STORAGE_KEY
        ? JSON.stringify({
          version: 1,
          completedQuestIds: [1],
          starsByQuest: { 1: 2 },
          projects: {},
          lastPlayedQuestId: 2,
        })
        : null,
    }
    const migrated = loadProgress(storage)
    expect(migrated).toMatchObject({
      version: 2,
      completedQuestIds: [1],
      starsByQuest: { 1: 2 },
      completedPracticeIds: [],
      challengeBestByQuest: {},
      badgesByQuest: { 1: ['completion'] },
      reviewsByQuest: {},
      legacyProjects: {},
    })
  })

  it('prefers valid v2 data and falls back to v1 when v2 is damaged', () => {
    const v1 = JSON.stringify({ version: 1, completedQuestIds: [1], starsByQuest: { 1: 1 }, projects: {}, lastPlayedQuestId: 2 })
    const storage = {
      getItem: (key: string) => key === PROGRESS_STORAGE_KEY ? '{damaged' : v1,
    }
    expect(loadProgress(storage).completedQuestIds).toEqual([1])
  })

  it('records practice completion and challenge personal bests immutably', () => {
    const practiced = completePractice(emptyProgress(), 'q2-practice-scale')
    const first = recordChallengeScore(practiced, 2, 72)
    const worse = recordChallengeScore(first, 2, 65)
    const better = recordChallengeScore(worse, 2, 88)
    expect((practiced as any).completedPracticeIds).toEqual(['q2-practice-scale'])
    expect((better as any).challengeBestByQuest[2]).toBe(88)
    expect(worse).toBe(first)
  })

  it('normalizes stored practice ids before deduplication', () => {
    const storage = {
      getItem: (key: string) => key === PROGRESS_STORAGE_KEY
        ? JSON.stringify({ ...emptyProgress(), completedPracticeIds: [' q1-practice ', 'q1-practice', '', 42] })
        : null,
    }
    expect(loadProgress(storage).completedPracticeIds).toEqual(['q1-practice'])
  })

  it('awards each badge once and completion grants its badge', () => {
    const completed = completeQuest(emptyProgress(), 1, 3)
    const precise = awardQuestBadge(completed, 1, 'accuracy')
    const repeated = awardQuestBadge(precise, 1, 'accuracy')
    expect((repeated as any).badgesByQuest[1]).toEqual(['completion', 'accuracy'])
    expect(repeated).toBe(precise)
  })

  it('keeps badge evidence across save/load and ignores badges for unfinished quests', async () => {
    const { saveProgress } = await import('./progress')
    let raw = ''
    const completed = awardQuestBadge(completeQuest(emptyProgress(), 1, 3), 1, 'accuracy')
    const unsafe = awardQuestBadge(completed, 2, 'independence')
    saveProgress(unsafe, { setItem: (_key, value) => { raw = value } })
    const reloaded = loadProgress({ getItem: (key) => key === PROGRESS_STORAGE_KEY ? raw : null })
    expect(reloaded.badgesByQuest).toEqual({ 1: ['completion', 'accuracy'] })
  })

  it('preserves planning operations and safe timing fields in saved projects', async () => {
    const { saveProgress } = await import('./progress')
    const progress = saveProject(emptyProgress(), 11, {
      courseVersion: 2,
      shapes: [],
      operations: [{ type: 'plan', at: 50 }],
      updatedAt: 100,
      startedAt: 10,
      elapsedSeconds: 90,
    })
    let raw = ''
    saveProgress(progress, { setItem: (_key, value) => { raw = value } })
    const reloaded = loadProgress({ getItem: (key) => key === PROGRESS_STORAGE_KEY ? raw : null })
    expect(reloaded.projects[11]).toMatchObject({
      operations: [{ type: 'plan', at: 50 }],
      startedAt: 10,
      elapsedSeconds: 90,
    })
  })

  it('moves old-course projects to a separate preserved collection', () => {
    const oldProject = {
      shapes: [],
      operations: [],
      updatedAt: 42,
    }
    const storage = {
      getItem: (key: string) => key === LEGACY_PROGRESS_STORAGE_KEY
        ? JSON.stringify({ version: 1, completedQuestIds: [], starsByQuest: {}, projects: { 1: oldProject }, lastPlayedQuestId: 1 })
        : null,
    }
    const migrated = loadProgress(storage)
    expect(migrated.projects).toEqual({})
    expect(migrated.legacyProjects[1]).toMatchObject(oldProject)
  })

  it('round-trips old and current projects for the same quest without overwriting either', async () => {
    const { saveProgress } = await import('./progress')
    const currentProject = { courseVersion: 2 as const, shapes: [], operations: [{ type: 'move' as const, at: 20 }], updatedAt: 20 }
    const oldProject = { shapes: [], operations: [{ type: 'scale' as const, at: 10 }], updatedAt: 10 }
    const progress = {
      ...emptyProgress(),
      projects: { 1: currentProject },
      legacyProjects: { 1: oldProject },
    }
    let raw = ''
    saveProgress(progress, { setItem: (_key, value) => { raw = value } })
    const reloaded = loadProgress({ getItem: (key) => key === PROGRESS_STORAGE_KEY ? raw : null })
    expect(reloaded.projects[1]).toMatchObject(currentProject)
    expect(reloaded.legacyProjects[1]).toMatchObject(oldProject)
  })

  it('moves manual review from pending to reviewed while clamping its 40 points', () => {
    const pending = markQuestReviewPending(emptyProgress(), 12, 10)
    expect((pending as any).reviewsByQuest[12]).toEqual({ status: 'pending', updatedAt: 10 })
    const reviewed = recordQuestReview(pending, 12, 50, 'Nice work', 20)
    expect((reviewed as any).reviewsByQuest[12]).toEqual({ status: 'reviewed', score: 40, comment: 'Nice work', updatedAt: 20 })
  })

  it('round-trips a final review through normalized storage', async () => {
    const { saveProgress } = await import('./progress')
    const reviewed = recordQuestReview(emptyProgress(), 12, 36, '讲解清楚', 20)
    let raw = ''
    saveProgress(reviewed, { setItem: (_key, value) => { raw = value } })
    const reloaded = loadProgress({ getItem: (key) => key === PROGRESS_STORAGE_KEY ? raw : null })
    expect(reloaded.reviewsByQuest[12]).toEqual({ status: 'reviewed', score: 36, comment: '讲解清楚', updatedAt: 20 })
  })
})

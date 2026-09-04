import { describe, expect, it } from 'vitest'
import { completeQuest, emptyProgress, isQuestUnlocked, loadProgress, saveProject } from './progress'

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
    expect(next.projects[2].updatedAt).toBe(42)
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
})

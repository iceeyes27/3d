import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { completeQuest, emptyProgress, LEGACY_PROGRESS_STORAGE_KEY, PROGRESS_STORAGE_KEY, recordQuestReview, saveProject } from './progress'
import { enterProfile, getProfile, listProfiles, normalizeProfileName, PROFILE_STORAGE_PREFIX, saveProfile } from './profiles'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    values,
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

beforeEach(() => {
  let tail = Promise.resolve<unknown>(undefined)
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, callback: () => unknown) => {
        const pending = tail.then(callback)
        tail = pending.catch(() => undefined)
        return pending
      },
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('local username profiles', () => {
  it('normalizes names and validates the child-facing name rules', () => {
    expect(normalizeProfileName('  小明＿ＡＢＣ１２  ')).toEqual({ name: '小明_ABC12', normalizedName: '小明_abc12' })
    expect(normalizeProfileName('一'.repeat(16))).not.toBeNull()
    for (const value of ['', '  ', 'a b', '小明!', '<script>', 'a'.repeat(17), '😀']) expect(normalizeProfileName(value)).toBeNull()
  })

  it('finds one existing profile for normalized and case-insensitive names', async () => {
    const storage = memoryStorage()
    const first = await enterProfile(' Ａlice ', storage)
    const second = await enterProfile('alice', storage)
    expect(first.ok && first.created).toBe(true)
    expect(second.ok && second.created).toBe(false)
    expect(first.ok && second.ok && first.profile.id).toBe(second.ok && second.profile.id)
    expect(listProfiles(storage)).toMatchObject({ ok: true, profiles: [{ name: 'Alice' }], legacy: 'none' })
  })

  it('isolates completion, drafts and parent reviews and reloads each complete profile', async () => {
    const storage = memoryStorage()
    const ming = await enterProfile('小明', storage)
    const hong = await enterProfile('小红', storage)
    if (!ming.ok || !hong.ok) throw new Error('profile creation failed')
    let progress = completeQuest(ming.profile.progress, 1, 3)
    progress = saveProject(progress, 2, { courseVersion: 2, shapes: [], operations: [{ type: 'move', at: 10 }], updatedAt: 10, elapsedSeconds: 12 })
    progress = recordQuestReview(progress, 12, 35, '完成得很好', 20)
    expect(await saveProfile(ming.profile.id, progress, ming.profile.revision, storage)).toMatchObject({ ok: true, profile: { revision: 2 } })
    expect(getProfile(hong.profile.id, storage)).toMatchObject({ ok: true, profile: { progress: emptyProgress(), revision: 1 } })
    expect(getProfile(ming.profile.id, storage)).toMatchObject({ ok: true, profile: { progress } })
    expect(storage.values.has(PROGRESS_STORAGE_KEY)).toBe(false)
  })

  it.each([1, 2])('claims the old version %s only once and keeps the original backup', async (version) => {
    const storage = memoryStorage()
    const current = completeQuest(emptyProgress(), 1, 2)
    const legacy = version === 1
      ? { version: 1, completedQuestIds: [1], starsByQuest: { 1: 2 }, lastPlayedQuestId: 2, projects: {} }
      : current
    const key = version === 1 ? LEGACY_PROGRESS_STORAGE_KEY : PROGRESS_STORAGE_KEY
    const raw = JSON.stringify(legacy)
    storage.setItem(key, raw)
    expect(listProfiles(storage)).toMatchObject({ ok: true, legacy: 'available', profiles: [] })
    const owner = await enterProfile('原来的我', storage)
    expect(owner).toMatchObject({ ok: true, created: true, profile: { migratedLegacy: true, progress: { completedQuestIds: [1] } } })
    expect(storage.getItem(key)).toBe(raw)
    expect(listProfiles(storage)).toMatchObject({ ok: true, legacy: 'migrated' })
    const next = await enterProfile('新同学', storage)
    expect(next).toMatchObject({ ok: true, profile: { progress: emptyProgress() } })
    const repeated = await enterProfile('原来的我', storage)
    expect(repeated).toMatchObject({ ok: true, created: false, profile: { progress: { completedQuestIds: [1] } } })
  })

  it('does not ask users to claim an empty initialization', async () => {
    const storage = memoryStorage()
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(emptyProgress()))
    expect(listProfiles(storage)).toMatchObject({ ok: true, legacy: 'none' })
    const result = await enterProfile('小明', storage)
    expect(result.ok && result.profile.migratedLegacy).toBeUndefined()
  })

  it('migrates old and current model collections without replacing either', async () => {
    const storage = memoryStorage()
    const oldProject = { shapes: [], operations: [{ type: 'move', at: 1 }], updatedAt: 2 }
    const currentProject = { courseVersion: 2, shapes: [], operations: [{ type: 'plan', at: 3 }], updatedAt: 4 }
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({ ...emptyProgress(), projects: { 1: currentProject }, legacyProjects: { 1: oldProject } }))
    expect(await enterProfile('小明', storage)).toMatchObject({ ok: true, profile: { progress: { projects: { 1: currentProject }, legacyProjects: { 1: oldProject } } } })
  })

  it('keeps the legacy claim available when quota prevents writing the new profile', async () => {
    const storage = memoryStorage()
    const raw = JSON.stringify(completeQuest(emptyProgress(), 1, 3))
    storage.setItem(PROGRESS_STORAGE_KEY, raw)
    const blocked = { ...storage, get length() { return storage.length }, setItem: () => { throw new Error('quota') } }
    expect(await enterProfile('小明', blocked)).toMatchObject({ ok: false, code: 'storage-unavailable' })
    expect(listProfiles(storage)).toMatchObject({ ok: true, profiles: [], legacy: 'available' })
    expect(storage.getItem(PROGRESS_STORAGE_KEY)).toBe(raw)
  })

  it('leaves saved progress and revision intact after a failed write', async () => {
    const storage = memoryStorage()
    const first = await enterProfile('小明', storage)
    if (!first.ok) throw new Error('profile creation failed')
    const blocked = { ...storage, get length() { return storage.length }, setItem: () => { throw new Error('quota') } }
    expect(await saveProfile(first.profile.id, completeQuest(emptyProgress(), 1, 3), 1, blocked)).toMatchObject({ ok: false, code: 'storage-unavailable' })
    expect(getProfile(first.profile.id, storage)).toEqual({ ok: true, profile: first.profile })
  })

  it('serializes same-name creation and accepts only one writer with a given revision', async () => {
    const storage = memoryStorage()
    const [first, second] = await Promise.all([enterProfile('Alice', storage), enterProfile('ALICE', storage)])
    if (!first.ok || !second.ok) throw new Error('profile creation failed')
    expect(first.profile.id).toBe(second.profile.id)
    expect([first.created, second.created]).toEqual([true, false])
    const one = completeQuest(emptyProgress(), 1, 1)
    const two = completeQuest(emptyProgress(), 1, 3)
    const results = await Promise.all([saveProfile(first.profile.id, one, 1, storage), saveProfile(first.profile.id, two, 1, storage)])
    expect(results[0]).toMatchObject({ ok: true, profile: { revision: 2, progress: one } })
    expect(results[1]).toMatchObject({ ok: false, code: 'conflict' })
    expect(getProfile(first.profile.id, storage)).toMatchObject({ ok: true, profile: { progress: one } })
  })

  it.each(['{bad json', '{}'])('never replaces a damaged stored profile with a blank profile (%s)', async (raw) => {
    const storage = memoryStorage()
    storage.setItem(`${PROFILE_STORAGE_PREFIX}broken`, raw)
    expect(getProfile('broken', storage)).toMatchObject({ ok: false, code: 'damaged' })
    expect(listProfiles(storage)).toMatchObject({ ok: false, code: 'damaged' })
    expect(await saveProfile('broken', emptyProgress(), 1, storage)).toMatchObject({ ok: false, code: 'damaged' })
    expect(await enterProfile('小明', storage)).toMatchObject({ ok: false, code: 'damaged' })
    expect(storage.getItem(`${PROFILE_STORAGE_PREFIX}broken`)).toBe(raw)
    expect(storage.length).toBe(1)
  })

  it('rejects a damaged model inside a syntactically valid profile', async () => {
    const storage = memoryStorage()
    const first = await enterProfile('小明', storage)
    if (!first.ok) throw new Error('profile creation failed')
    const key = `${PROFILE_STORAGE_PREFIX}${first.profile.id}`
    const raw = JSON.stringify({ ...first.profile, progress: { ...first.profile.progress, projects: { 1: {} } } })
    storage.setItem(key, raw)
    expect(getProfile(first.profile.id, storage)).toMatchObject({ ok: false, code: 'damaged' })
    expect(await saveProfile(first.profile.id, emptyProgress(), 1, storage)).toMatchObject({ ok: false, code: 'damaged' })
    expect(storage.getItem(key)).toBe(raw)
  })

  it('reports damaged old progress and preserves it without claiming an empty profile', async () => {
    const storage = memoryStorage()
    storage.setItem(PROGRESS_STORAGE_KEY, '{broken')
    expect(listProfiles(storage)).toMatchObject({ ok: true, profiles: [], legacy: 'damaged' })
    expect(await enterProfile('小明', storage)).toMatchObject({ ok: false, code: 'damaged' })
    expect(storage.length).toBe(1)
  })

  it('recovers from a damaged v2 using valid v1 data while retaining both originals', async () => {
    const storage = memoryStorage()
    storage.setItem(PROGRESS_STORAGE_KEY, '{broken')
    storage.setItem(LEGACY_PROGRESS_STORAGE_KEY, JSON.stringify({ version: 1, completedQuestIds: [1], starsByQuest: { 1: 2 }, projects: {}, lastPlayedQuestId: 2 }))
    expect(await enterProfile('小明', storage)).toMatchObject({ ok: true, profile: { progress: { completedQuestIds: [1] } } })
    expect(storage.getItem(PROGRESS_STORAGE_KEY)).toBe('{broken')
    expect(storage.getItem(LEGACY_PROGRESS_STORAGE_KEY)).not.toBeNull()
  })

  it('returns a recoverable error if reading localStorage itself is forbidden', async () => {
    vi.stubGlobal('localStorage', { get length() { throw new Error('disabled') }, getItem: () => { throw new Error('disabled') } })
    expect(listProfiles()).toMatchObject({ ok: false, code: 'storage-unavailable' })
    expect(getProfile('missing')).toMatchObject({ ok: false, code: 'storage-unavailable' })
    expect(await enterProfile('小明')).toMatchObject({ ok: false, code: 'storage-unavailable' })
  })

  it('does not mutate storage when the browser cannot coordinate tab writes', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('navigator', {})
    expect(await enterProfile('小明', storage)).toMatchObject({ ok: false, code: 'locking-unavailable' })
    expect(storage.length).toBe(0)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudProfileCacheKey, readCloudCache } from './cloudProfiles'
import type { CloudProfileEnvelope, CloudProfileResult } from './cloudTypes'
import { CloudProfileWriter } from './cloudWriter'
import { completeQuest, emptyProgress } from './progress'

type Save = NonNullable<NonNullable<ConstructorParameters<typeof CloudProfileWriter>[1]>['save']>
function profile(spaceId = 'family-a', id = 'ming'): CloudProfileEnvelope {
  return { version: 1, spaceId, id, name: id, normalizedName: id, revision: 1, createdAt: 1, updatedAt: 1, progress: emptyProgress() }
}
const writers: CloudProfileWriter[] = []
function writer(value = profile(), options: NonNullable<ConstructorParameters<typeof CloudProfileWriter>[1]> = {}) {
  const result = new CloudProfileWriter(value, { currentSpace: () => value.spaceId, ...options })
  writers.push(result)
  return result
}
const network = { ok: false as const, code: 'network', message: '本机已保存，等待网络恢复后同步。' }

beforeEach(() => { localStorage.clear() })
afterEach(() => { writers.splice(0).forEach((item) => item.dispose()); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('durable cloud save queue', () => {
  it('caches edits before the debounce and uploads by max wait during continuous edits', async () => {
    vi.useFakeTimers()
    const save = vi.fn<Save>(async (_space, _id, progress, revision) => ({ ok: true, profile: { ...profile(), progress, revision: revision + 1 } }))
    const instance = writer(profile(), { save })
    instance.start()
    instance.update(completeQuest(emptyProgress(), 1, 1))
    await vi.advanceTimersByTimeAsync(0)
    expect(readCloudCache('family-a', 'ming')?.desiredProgress.completedQuestIds).toEqual([1])
    expect(save).not.toHaveBeenCalled()
    for (let step = 0; step < 6; step += 1) {
      await vi.advanceTimersByTimeAsync(1500)
      instance.update({ ...instance.progress, reviewsByQuest: { 1: { status: 'pending', updatedAt: step + 1 } } })
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalled()
    expect(instance.state).toBe('saved')
  })

  it('persists an offline mutation and retries the identical mutation after refresh', async () => {
    const first = writer(profile(), { save: async () => network })
    const desired = completeQuest(emptyProgress(), 1, 3)
    first.update(desired)
    expect(await first.flush()).toBe(true)
    expect(first.state).toBe('pending')
    const before = readCloudCache('family-a', 'ming')!
    expect(before.desiredProgress).toEqual(desired)
    first.dispose()
    const save = vi.fn<Save>(async (_space, _id, progress, revision) => ({ ok: true, profile: { ...profile(), progress, revision: revision + 1 } }))
    const restored = writer(profile(), { save })
    expect(restored.progress).toEqual(desired)
    expect(await restored.flush()).toBe(true)
    expect(save.mock.calls[0][4]).toBe(before.pending?.mutationId)
    expect(restored.state).toBe('saved')
    expect(readCloudCache('family-a', 'ming')?.pending).toBeUndefined()
  })

  it('reuses the mutation after response loss and preserves edits made while uploading', async () => {
    let release!: (value: CloudProfileResult) => void
    const calls: Parameters<Save>[] = []
    let firstApplied: CloudProfileEnvelope | undefined
    const save: Save = async (...args) => {
      calls.push(args)
      const [spaceId, id, progress, revision] = args
      if (calls.length === 1) {
        firstApplied = { ...profile(spaceId, id), revision: revision + 1, progress }
        return new Promise((resolve) => { release = resolve })
      }
      if (calls.length === 2) return { ok: true, profile: firstApplied! }
      return { ok: true, profile: { ...profile(spaceId, id), revision: revision + 1, progress } }
    }
    const instance = writer(profile(), { save })
    const first = completeQuest(emptyProgress(), 1, 3)
    const latest = completeQuest(first, 2, 3)
    instance.update(first)
    const uploading = instance.flush()
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    instance.update(latest)
    release(network)
    expect(await uploading).toBe(true)
    expect(await instance.flush()).toBe(true)
    expect(calls.map((args) => args[3])).toEqual([1, 1, 2])
    expect(calls[0][4]).toBe(calls[1][4])
    expect(calls[2][4]).not.toBe(calls[1][4])
    expect(calls[2][2]).toEqual(latest)
    expect(readCloudCache('family-a', 'ming')?.desiredProgress).toEqual(latest)
  })

  it('separates queues by both family and user and stops a stale family session', async () => {
    const save = vi.fn<Save>(async (spaceId, id, progress, revision) => ({ ok: true, profile: { ...profile(spaceId, id), progress, revision: revision + 1 } }))
    const a = writer(profile('family-a', 'ming'), { save })
    const b = writer(profile('family-a', 'hong'), { save })
    const c = writer(profile('family-b', 'ming'), { save, currentSpace: () => 'family-a' })
    a.update(completeQuest(emptyProgress(), 1, 1))
    b.update(completeQuest(emptyProgress(), 1, 2))
    c.update(completeQuest(emptyProgress(), 1, 3))
    expect(await a.flush()).toBe(true)
    expect(await b.flush()).toBe(true)
    expect(await c.flush()).toBe(false)
    expect(save.mock.calls.map((args) => args.slice(0, 2))).toEqual([['family-a', 'ming'], ['family-a', 'hong']])
    expect(readCloudCache('family-b', 'ming')?.desiredProgress.completedQuestIds).toEqual([1])
    expect(c.state).toBe('error')
  })

  it('keeps local and remote conflict versions, including after refresh', async () => {
    const remote = { ...profile(), revision: 2, progress: completeQuest(completeQuest(emptyProgress(), 1, 3), 2, 3) }
    const save = vi.fn<Save>(async () => ({ ok: false, code: 'conflict', message: '两个版本', profile: remote }))
    const instance = writer(profile(), { save })
    instance.update(completeQuest(emptyProgress(), 1, 3))
    expect(await instance.flush()).toBe(false)
    expect(instance.state).toBe('conflict')
    expect(JSON.parse(instance.backup())).toMatchObject({ desiredProgress: { completedQuestIds: [1] }, conflict: { remote: { progress: { completedQuestIds: [1, 2] } } } })
    const restored = writer(profile(), { save })
    expect(await restored.flush()).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
    expect(restored.state).toBe('conflict')
  })

  it('blocks switching and uploads on local quota failure, then retries safely', async () => {
    let blocked = true
    const target = {
      getItem: (key: string) => localStorage.getItem(key), key: (index: number) => localStorage.key(index), get length() { return localStorage.length },
      setItem: (key: string, value: string) => { if (blocked) throw new DOMException('quota', 'QuotaExceededError'); localStorage.setItem(key, value) },
    }
    const save = vi.fn<Save>(async (_space, _id, progress, revision) => ({ ok: true, profile: { ...profile(), progress, revision: revision + 1 } }))
    const instance = writer(profile(), { storage: target, save })
    const desired = completeQuest(emptyProgress(), 1, 3)
    instance.update(desired)
    expect(await instance.flush()).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(instance.state).toBe('error')
    expect(instance.progress).toEqual(desired)
    blocked = false
    expect(await instance.flush()).toBe(true)
    expect(instance.state).toBe('saved')
  })

  it('replaces a definitively rejected mutation after correcting the draft, including across refresh', async () => {
    const rejected = writer(profile(), { save: async () => ({ ok: false, code: 'too-large', message: '请减少零件' }) })
    rejected.update({ ...emptyProgress(), reviewsByQuest: { 1: { status: 'pending', comment: '需要精简的内容' } } })
    expect(await rejected.flush()).toBe(false)
    const oldMutation = readCloudCache('family-a', 'ming')?.pending?.mutationId
    rejected.dispose()
    const save = vi.fn<Save>(async (_space, _id, progress, revision) => ({ ok: true, profile: { ...profile(), progress, revision: revision + 1 } }))
    const restored = writer(profile(), { save })
    restored.update(emptyProgress())
    expect(await restored.flush()).toBe(true)
    expect(save.mock.calls[0][4]).not.toBe(oldMutation)
    expect(save.mock.calls[0][3]).toBe(1)
    expect(save.mock.calls[0][2]).toEqual(emptyProgress())
    expect(restored.state).toBe('saved')
  })

  it('checkpoints an expired-session draft without retrying the network but blocks conflicts', async () => {
    const save = vi.fn<Save>(async () => ({ ok: false, code: 'no-session', message: '家庭入口已过期' }))
    const instance = writer(profile(), { save })
    instance.update(completeQuest(emptyProgress(), 1, 3))
    expect(await instance.flush()).toBe(false)
    expect(instance.needsReconnect).toBe(true)
    instance.update(completeQuest(instance.progress, 2, 3))
    expect(await instance.checkpoint()).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    expect(readCloudCache('family-a', 'ming')?.desiredProgress.completedQuestIds).toEqual([1, 2])
    instance.externalChange(null)
    expect(await instance.checkpoint()).toBe(false)
  })

  it('does not permit a local-only checkpoint while the latest draft cannot be stored', async () => {
    const target = {
      getItem: () => null, key: () => null, length: 0,
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError') },
    }
    const save = vi.fn<Save>()
    const instance = writer(profile(), { storage: target, save })
    instance.update(completeQuest(emptyProgress(), 1, 3))
    expect(await instance.checkpoint()).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(instance.progress.completedQuestIds).toEqual([1])
  })

  it('detects a changed local cache before replacing another tab’s pending draft', async () => {
    const a = writer(profile(), { save: async () => network })
    const b = writer(profile(), { save: async () => network })
    a.update(completeQuest(emptyProgress(), 1, 3))
    await a.flush()
    b.update(completeQuest(emptyProgress(), 2, 3))
    expect(await b.flush()).toBe(false)
    expect(b.state).toBe('conflict')
    expect(readCloudCache('family-a', 'ming')?.desiredProgress.completedQuestIds).toEqual([1])
    expect(b.progress.completedQuestIds).toEqual([2])
    expect(localStorage.getItem(cloudProfileCacheKey('family-a', 'ming'))).not.toBeNull()
  })
})

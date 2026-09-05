import { describe, expect, it } from 'vitest'
import { ProfileWriter } from './profileWriter'
import { completeQuest, emptyProgress } from './progress'
import type { ProfileEnvelope } from './profiles'
import type { LearningProgress } from './types'

type Save = NonNullable<ConstructorParameters<typeof ProfileWriter>[1]>

function profile(id = 'profile-ming', name = '小明'): ProfileEnvelope {
  return {
    version: 1,
    id,
    name,
    normalizedName: name,
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    progress: emptyProgress(),
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('profile save queue', () => {
  it('finishes the newest snapshot after a slow save without parallel or stale writes', async () => {
    let stored = profile()
    const started = deferred()
    const release = deferred()
    const calls: { progress: LearningProgress; revision: number }[] = []
    let active = 0
    let maxActive = 0
    const save: Save = async (_id, progress, revision) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      calls.push({ progress, revision })
      if (calls.length === 1) {
        started.resolve()
        await release.promise
      }
      expect(revision).toBe(stored.revision)
      stored = { ...stored, revision: revision + 1, progress }
      active -= 1
      return { ok: true, profile: stored }
    }
    const writer = new ProfileWriter(stored, save)
    const first = completeQuest(emptyProgress(), 1, 1)
    const second = completeQuest(first, 2, 2)
    const latest = completeQuest(second, 3, 3)

    writer.update(first)
    await started.promise
    writer.update(second)
    writer.update(latest)
    const flushed = writer.flush()
    release.resolve()

    expect(await flushed).toBe(true)
    expect(maxActive).toBe(1)
    expect(calls.map((call) => call.revision)).toEqual([1, 2])
    expect(calls.map((call) => call.progress)).toEqual([first, latest])
    expect(stored.progress).toEqual(latest)
    expect(writer.progress).toEqual(latest)
    expect(writer.state).toBe('saved')
  })

  it('keeps an old pending writer bound to its own user while another user saves', async () => {
    const ming = profile()
    const hong = profile('profile-hong', '小红')
    const records = new Map([[ming.id, ming], [hong.id, hong]])
    const started = deferred()
    const release = deferred()
    const save: Save = async (id, progress, revision) => {
      if (id === ming.id) {
        started.resolve()
        await release.promise
      }
      const current = records.get(id)!
      expect(revision).toBe(current.revision)
      const updated = { ...current, progress, revision: revision + 1 }
      records.set(id, updated)
      return { ok: true, profile: updated }
    }
    const mingWriter = new ProfileWriter(ming, save)
    const hongWriter = new ProfileWriter(hong, save)
    const mingProgress = completeQuest(emptyProgress(), 1, 3)
    const hongProgress = { ...emptyProgress(), lastPlayedQuestId: 2 }

    mingWriter.update(mingProgress)
    await started.promise
    hongWriter.update(hongProgress)
    expect(await hongWriter.flush()).toBe(true)
    release.resolve()
    expect(await mingWriter.flush()).toBe(true)

    expect(records.get(ming.id)?.progress).toEqual(mingProgress)
    expect(records.get(hong.id)?.progress).toEqual(hongProgress)
    expect(records.get(ming.id)?.name).toBe('小明')
    expect(records.get(hong.id)?.name).toBe('小红')
  })

  it('does not report a successful flush when storage is full', async () => {
    const save: Save = async () => ({ ok: false, code: 'storage-unavailable', message: '存储空间不足' })
    const writer = new ProfileWriter(profile(), save)
    const unsaved = completeQuest(emptyProgress(), 1, 3)
    writer.update(unsaved)

    expect(await writer.flush()).toBe(false)
    expect(writer.state).toBe('error')
    expect(writer.message).toBe('存储空间不足')
    expect(writer.progress).toEqual(unsaved)
    expect(writer.revision).toBe(1)
  })

  it('retains the draft after an unexpected storage exception and retries after recovery', async () => {
    let available = false
    let stored = profile()
    const save: Save = async (_id, progress, revision) => {
      if (!available) throw new Error('QuotaExceededError')
      expect(revision).toBe(stored.revision)
      stored = { ...stored, progress, revision: revision + 1 }
      return { ok: true, profile: stored }
    }
    const writer = new ProfileWriter(stored, save)
    const unsaved = completeQuest(emptyProgress(), 1, 3)
    writer.update(unsaved)
    expect(await writer.flush()).toBe(false)
    expect(writer.state).toBe('error')
    expect(stored.progress.completedQuestIds).toEqual([])

    available = true
    expect(await writer.flush()).toBe(true)
    expect(stored.progress).toEqual(unsaved)
    expect(writer.state).toBe('saved')
    expect(writer.message).toBe('')
    expect(writer.revision).toBe(2)
  })

  it('does not retry a revision conflict or overwrite it with later local edits', async () => {
    let attempts = 0
    const save: Save = async () => {
      attempts += 1
      return { ok: false, code: 'conflict', message: '另一个页面已更新进度' }
    }
    const writer = new ProfileWriter(profile(), save)
    writer.update(completeQuest(emptyProgress(), 1, 3))
    expect(await writer.flush()).toBe(false)
    expect(writer.state).toBe('conflict')

    const laterDraft = completeQuest(writer.progress, 2, 3)
    writer.update(laterDraft)
    expect(await writer.flush()).toBe(false)
    expect(attempts).toBe(1)
    expect(writer.progress).toEqual(laterDraft)
    expect(writer.state).toBe('conflict')
  })

  it.each([2, null])('blocks writes after an external revision change to %s', async (revision) => {
    let attempts = 0
    const save: Save = async (_id, progress, expectedRevision) => {
      attempts += 1
      return { ok: true, profile: { ...profile(), progress, revision: expectedRevision + 1 } }
    }
    const writer = new ProfileWriter(profile(), save)
    writer.externalChange(revision)
    writer.update(completeQuest(emptyProgress(), 1, 3))

    expect(await writer.flush()).toBe(false)
    expect(writer.state).toBe('conflict')
    expect(attempts).toBe(0)
  })

  it('ignores an external notification for the already loaded revision', async () => {
    const writer = new ProfileWriter(profile())
    writer.externalChange(1)
    expect(await writer.flush()).toBe(true)
    expect(writer.state).toBe('saved')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheCloudProfile, CLOUD_SESSION_CACHE_KEY, cloudProfileCacheKey, enterCloudProfile, getCloudProfile, getCloudSession, listCloudProfiles, readCloudCache, reloadCloudProfile, saveCloudProfile } from './cloudProfiles'
import type { CloudProfileEnvelope } from './cloudTypes'
import { completeQuest, emptyProgress } from './progress'

function profile(spaceId = 'family-a', id = 'ming'): CloudProfileEnvelope {
  return { version: 1, spaceId, id, name: '小明', normalizedName: '小明', revision: 1, createdAt: 1, updatedAt: 1, progress: emptyProgress() }
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('cloud profile API and isolated cache', () => {
  it('binds every profile request to its family, including saves and entry by name', async () => {
    const mocked = vi.mocked(fetch)
    mocked.mockResolvedValueOnce(response({ ok: true, profiles: [] }))
      .mockResolvedValueOnce(response({ ok: true, profile: profile(), created: true }))
      .mockResolvedValueOnce(response({ ok: true, profile: profile() }))
      .mockResolvedValueOnce(response({ ok: true, profile: { ...profile(), revision: 2 } }))
    await listCloudProfiles('family-a')
    await enterCloudProfile('family-a', ' 小明 ')
    await getCloudProfile('family-a', 'ming')
    await saveCloudProfile('family-a', 'ming', emptyProgress(), 1, 'mutation-one')
    for (const [, init] of mocked.mock.calls) expect(init?.headers).toMatchObject({ 'X-Space-ID': 'family-a' })
    expect(JSON.parse(mocked.mock.calls[3][1]?.body as string)).toMatchObject({ expectedRevision: 1, mutationId: 'mutation-one' })
  })

  it('can reopen a cached family/user offline without importing previous local-only users', async () => {
    localStorage.setItem('maker-island-profile-v1:old-user', JSON.stringify(profile()))
    localStorage.setItem(CLOUD_SESSION_CACHE_KEY, JSON.stringify({ id: 'family-a', createdAt: 1 }))
    await cacheCloudProfile(profile())
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'))
    expect(await getCloudSession()).toMatchObject({ ok: true, space: { id: 'family-a' }, offline: true })
    expect(await enterCloudProfile('family-a', '小明')).toMatchObject({ ok: true, created: false, offline: true })
    expect(await enterCloudProfile('family-a', '小红')).toMatchObject({ ok: false, code: 'offline-new-profile' })
    expect(await listCloudProfiles('family-b')).toMatchObject({ ok: true, profiles: [], offline: true })
  })

  it('opening fresh cloud data preserves unsynced local work until explicit reload', async () => {
    await cacheCloudProfile(profile())
    const cached = readCloudCache('family-a', 'ming')!
    cached.desiredProgress = completeQuest(emptyProgress(), 1, 3)
    cached.pending = { mutationId: 'retained', baseRevision: 1, progress: cached.desiredProgress }
    localStorage.setItem(cloudProfileCacheKey('family-a', 'ming'), JSON.stringify(cached))
    const remote = { ...profile(), revision: 2 }
    vi.mocked(fetch).mockImplementation(async () => response({ ok: true, profile: remote }))
    expect(await getCloudProfile('family-a', 'ming')).toMatchObject({ ok: true, profile: { progress: { completedQuestIds: [1] } } })
    expect(readCloudCache('family-a', 'ming')?.pending?.mutationId).toBe('retained')
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    expect(await reloadCloudProfile('family-a', 'ming')).toMatchObject({ ok: false })
    expect(readCloudCache('family-a', 'ming')?.pending?.mutationId).toBe('retained')
    expect(await reloadCloudProfile('family-a', 'ming')).toMatchObject({ ok: true, profile: { revision: 2 } })
    expect(readCloudCache('family-a', 'ming')?.pending).toBeUndefined()
  })

  it('does not treat an authorization change as offline or return another cached family', async () => {
    await cacheCloudProfile(profile())
    vi.mocked(fetch).mockImplementation(async () => response({ ok: false, code: 'session-changed', message: '家庭已改变' }, 409))
    expect(await enterCloudProfile('family-a', '小明')).toMatchObject({ ok: false, code: 'session-changed' })
    expect(await getCloudProfile('family-a', 'ming')).toMatchObject({ ok: false, code: 'session-changed' })
  })

  it('keeps the cache stamp stable for read-only opens and rejects damaged cached progress', async () => {
    await cacheCloudProfile(profile())
    const before = readCloudCache('family-a', 'ming')!.stamp
    await cacheCloudProfile(profile())
    expect(readCloudCache('family-a', 'ming')!.stamp).toBe(before)
    const damaged = readCloudCache('family-a', 'ming')!
    ;(damaged.desiredProgress as unknown as Record<string, unknown>).projects = null
    localStorage.setItem(cloudProfileCacheKey('family-a', 'ming'), JSON.stringify(damaged))
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    expect(await getCloudProfile('family-a', 'ming')).toMatchObject({ ok: false, code: 'storage-unavailable' })
    expect(localStorage.getItem(cloudProfileCacheKey('family-a', 'ming'))).toContain('"projects":null')
  })

  it('does not use an offline cache to hide malformed authorization responses', async () => {
    await cacheCloudProfile(profile())
    vi.mocked(fetch).mockResolvedValue(new Response('not-json', { status: 401 }))
    expect(await getCloudProfile('family-a', 'ming')).toMatchObject({ ok: false, code: 'server' })
  })

  it('ends a stalled request after the timeout and keeps cached work available', async () => {
    vi.useFakeTimers()
    await cacheCloudProfile(profile())
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Abort', 'AbortError')))
    }))
    const pending = getCloudProfile('family-a', 'ming')
    await vi.advanceTimersByTimeAsync(12_000)
    expect(await pending).toMatchObject({ ok: true, offline: true })
  })
})

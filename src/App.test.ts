import { createElement, StrictMode } from 'react'
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { cleanProgress, completeQuest, emptyProgress, PROGRESS_STORAGE_KEY, saveProject } from './progress'
import { cloudProfileCacheKey, readCloudCache } from './cloudProfiles'
import { normalizeProfileName, PROFILE_STORAGE_PREFIX } from './profiles'
import type { CloudProfileEnvelope, CloudSpace } from './cloudTypes'
import type { QuestProject } from './types'

type StudioProps = ComponentProps<typeof import('./Studio')['Studio']>
const studioCapture = vi.hoisted(() => ({ latest: null as StudioProps | null }))

function testProject(questId: number, completed = false): QuestProject {
  return {
    courseVersion: 2,
    shapes: [],
    operations: [{ type: 'add', at: questId * 100 }],
    updatedAt: questId * 100,
    ...(completed ? { elapsedSeconds: 12 } : {}),
  }
}

// Keep cloud entry, storage, synchronization and the map real. Only WebGL is replaced.
vi.mock('./Studio', () => ({
  Studio: (props: StudioProps) => {
    studioCapture.latest = props
    return createElement('main', { 'aria-label': '测试工作台' },
      createElement('span', { title: props.username }, props.username),
      createElement('p', null, `测试第 ${props.quest.id} 关`),
      createElement('output', { 'data-testid': 'loaded-project' }, props.savedProject ? String(props.savedProject.updatedAt) : '尚无草稿'),
      createElement('output', { 'data-testid': 'save-state' }, props.saveState ?? 'saved'),
      createElement('button', { onClick: () => props.onProjectChange(props.quest.id, testProject(props.quest.id)) }, '保存测试草稿'),
      createElement('button', { onClick: () => props.onComplete(props.quest.id, 3, testProject(props.quest.id, true), ['accuracy', 'independence'], `q${props.quest.id}-practice`) }, '完成测试关卡'),
      createElement('button', { onClick: props.onSwitchProfile }, '切换用户'),
      createElement('button', { onClick: props.onBack }, '返回地图'),
    )
  },
}))

type Family = { space: CloudSpace; token: string; profiles: Map<string, CloudProfileEnvelope> }

/** A separate service store: clearing browser data must never erase these profiles. */
function createCloudService() {
  const families = new Map<string, Family>()
  let currentSpaceId: string | null = null
  let offline = false
  const mutations = new Map<string, number>()
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  const failure = (code: string, message: string, status: number) => json({ ok: false, code, message }, status)
  const makeFamily = () => {
    const space = { id: crypto.randomUUID(), createdAt: Date.now() }
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
    const family = { space, token, profiles: new Map<string, CloudProfileEnvelope>() }
    families.set(space.id, family)
    return family
  }
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (offline) throw new TypeError('Failed to fetch')
    const path = new URL(input instanceof Request ? input.url : String(input), window.location.origin).pathname
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    if (path === '/api/spaces' && method === 'POST') {
      const family = makeFamily()
      currentSpaceId = family.space.id
      return json({ ok: true, space: family.space, inviteToken: family.token }, 201)
    }
    if (path === '/api/session' && method === 'POST') {
      const family = Array.from(families.values()).find((item) => item.token === body.inviteToken)
      if (!family) return failure('no-session', '家庭入口无效，请检查链接。', 401)
      currentSpaceId = family.space.id
      return json({ ok: true, space: family.space })
    }
    const family = currentSpaceId ? families.get(currentSpaceId) : undefined
    if (!family) return failure('no-session', '请先打开家庭入口。', 401)
    if (path === '/api/session') return json({ ok: true, space: family.space })
    if (headers.get('X-Space-ID') !== family.space.id) return failure('session-changed', '当前家庭已切换，请重新打开入口。', 409)
    if (path === '/api/profiles' && method === 'GET') {
      return json({ ok: true, profiles: Array.from(family.profiles.values()).map(({ progress: _progress, version: _version, ...summary }) => summary) })
    }
    if (path === '/api/profiles' && method === 'POST') {
      const name = normalizeProfileName(String(body.name ?? ''))
      if (!name) return failure('invalid-name', '请填写有效的名字。', 400)
      const existing = Array.from(family.profiles.values()).find((item) => item.normalizedName === name.normalizedName)
      if (existing) return json({ ok: true, profile: existing, created: false })
      const profile: CloudProfileEnvelope = { version: 1, id: crypto.randomUUID(), spaceId: family.space.id, ...name, revision: 1, createdAt: Date.now(), updatedAt: Date.now(), progress: emptyProgress() }
      family.profiles.set(profile.id, profile)
      return json({ ok: true, profile, created: true }, 201)
    }
    const match = path.match(/^\/api\/profiles\/([^/]+)$/)
    const profile = match ? family.profiles.get(match[1]) : undefined
    if (!profile) return failure('not-found', '找不到档案。', 404)
    if (method === 'GET') return json({ ok: true, profile })
    if (method === 'PUT') {
      const mutationKey = `${profile.id}:${body.mutationId}`
      const appliedRevision = mutations.get(mutationKey)
      if (appliedRevision) return json({ ok: true, profile, appliedRevision })
      if (body.expectedRevision !== profile.revision) return json({ ok: false, code: 'conflict', message: '发现两个版本，云端作品已保留。', profile }, 409)
      const saved = { ...profile, progress: structuredClone(body.progress) as CloudProfileEnvelope['progress'], revision: profile.revision + 1, updatedAt: Date.now() }
      family.profiles.set(profile.id, saved)
      mutations.set(mutationKey, saved.revision)
      return json({ ok: true, profile: saved, appliedRevision: saved.revision })
    }
    return failure('not-found', '接口不存在。', 404)
  })
  return {
    fetcher,
    families,
    makeFamily,
    setOffline: (value: boolean) => { offline = value },
    setSession: (family: Family) => { currentSpaceId = family.space.id },
    clearSession: () => { currentSpaceId = null },
    currentFamily: () => {
      const family = currentSpaceId ? families.get(currentSpaceId) : undefined
      if (!family) throw new Error('No active cloud family')
      return family
    },
  }
}

let service: ReturnType<typeof createCloudService>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  studioCapture.latest = null
  service = createCloudService()
  vi.stubGlobal('fetch', service.fetcher)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function savedProfile(name: string, family = service.currentFamily()) {
  const profile = Array.from(family.profiles.values()).find((item) => item.name === name)
  if (!profile) throw new Error(`Missing cloud profile ${name}`)
  return profile
}

async function createFamily() {
  fireEvent.click(await screen.findByRole('button', { name: /^创建家庭空间/ }))
  const link = await screen.findByLabelText('家庭私密链接') as HTMLInputElement
  expect(link.value).toContain('#family=')
  fireEvent.click(screen.getByRole('button', { name: /^我已保存，开始冒险/ }))
  await screen.findByRole('heading', { name: '你叫什么名字？' })
  return service.currentFamily()
}

async function enterName(name: string, displayedName = name.trim()) {
  const input = await screen.findByLabelText(/^你的名字/)
  fireEvent.change(input, { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: /^(开始冒险|继续冒险)/ }))
  await waitFor(() => expect(screen.getByTitle(displayedName)).not.toBeNull())
}

async function switchUser() {
  fireEvent.click(screen.getByRole('button', { name: '切换用户' }))
  await screen.findByRole('heading', { name: '你叫什么名字？' })
}

async function openQuest(questId: number) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^第 ${questId} 关，`) }))
  fireEvent.click(screen.getByRole('button', { name: /^(开始闯关|再玩一次)$/ }))
  await screen.findByText(`测试第 ${questId} 关`)
}

describe('cloud family and username app integration', () => {
  it('isolates drafts, completion and stale callbacks when switching 小明 → 小红 → 小明', async () => {
    render(createElement(StrictMode, null, createElement(App)))
    await createFamily()
    await enterName('小明')
    await openQuest(1)
    fireEvent.click(screen.getByRole('button', { name: '完成测试关卡' }))
    fireEvent.click(screen.getByRole('button', { name: '返回地图' }))
    await screen.findByRole('button', { name: /^第 2 关，.*可以开始$/ })
    await openQuest(2)
    fireEvent.click(screen.getByRole('button', { name: '保存测试草稿' }))
    const previousStudio = studioCapture.latest!
    await switchUser()
    expect(savedProfile('小明').progress.projects[2]?.updatedAt).toBe(200)
    expect(savedProfile('小明').progress.completedQuestIds).toEqual([1])
    const mingBeforeSwitch = structuredClone(savedProfile('小明'))
    expect(cleanProgress({ ...mingBeforeSwitch.progress })).toEqual(mingBeforeSwitch.progress)
    expect(readCloudCache(mingBeforeSwitch.spaceId, mingBeforeSwitch.id)).not.toBeNull()

    await enterName('小红')
    expect(screen.getByRole('button', { name: /^第 1 关，.*可以开始$/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /^第 2 关，.*尚未解锁$/ })).not.toBeNull()
    expect(savedProfile('小红').progress).toEqual(emptyProgress())
    const hongBeforeCallbacks = structuredClone(savedProfile('小红'))
    await act(async () => {
      previousStudio.onProjectChange(2, { ...testProject(2), updatedAt: 999 })
      previousStudio.onComplete(3, 3, testProject(3, true), ['accuracy'])
      await Promise.resolve()
    })
    expect(savedProfile('小明')).toEqual(mingBeforeSwitch)
    expect(savedProfile('小红')).toEqual(hongBeforeCallbacks)

    await switchUser()
    await enterName('小明')
    await openQuest(2)
    expect(screen.getByTestId('loaded-project').textContent).toBe('200')
    expect(savedProfile('小明').progress.badgesByQuest[1]).toEqual(['completion', 'accuracy', 'independence'])
    expect(savedProfile('小明').progress.completedPracticeIds).toEqual(['q1-practice'])
  })

  it('restores cloud work after refresh and after browser data is cleared on another device', async () => {
    const firstPage = render(createElement(App))
    const family = await createFamily()
    await enterName('小明')
    await openQuest(1)
    fireEvent.click(screen.getByRole('button', { name: '保存测试草稿' }))
    await waitFor(() => expect(savedProfile('小明').progress.projects[1]?.updatedAt).toBe(100), { timeout: 5000 })
    firstPage.unmount()

    const refresh = render(createElement(App))
    await screen.findByText('测试第 1 关')
    expect(screen.getByTestId('loaded-project').textContent).toBe('100')
    refresh.unmount()

    localStorage.clear()
    sessionStorage.clear()
    service.clearSession()
    window.history.replaceState(null, '', `/#family=${family.token}`)
    render(createElement(App))
    await enterName('小明')
    expect(window.location.hash).not.toContain('family=')
    await openQuest(1)
    expect(screen.getByTestId('loaded-project').textContent).toBe('100')
    expect(savedProfile('小明').progress.projects[1]?.updatedAt).toBe(100)
  })

  it('keeps an identical username separate in different families', async () => {
    const firstPage = render(createElement(App))
    const firstFamily = await createFamily()
    await enterName('小明')
    await openQuest(1)
    fireEvent.click(screen.getByRole('button', { name: '完成测试关卡' }))
    await switchUser()
    const firstProfile = savedProfile('小明', firstFamily)
    firstPage.unmount()

    const secondFamily = service.makeFamily()
    sessionStorage.clear()
    window.history.replaceState(null, '', `/#family=${secondFamily.token}`)
    render(createElement(App))
    await enterName('小明')
    const secondProfile = savedProfile('小明', secondFamily)
    expect(secondProfile.id).not.toBe(firstProfile.id)
    expect(secondProfile.progress).toEqual(emptyProgress())
    expect(firstProfile.progress.completedQuestIds).toEqual([1])
    expect(screen.getByRole('button', { name: /^第 2 关，.*尚未解锁$/ })).not.toBeNull()
  })

  it('reopens one cloud profile for trimmed and case-insensitive usernames', async () => {
    render(createElement(App))
    await createFamily()
    await enterName('Alice')
    const originalId = savedProfile('Alice').id
    await switchUser()
    await enterName(' alice ', 'Alice')
    expect(service.currentFamily().profiles.size).toBe(1)
    expect(savedProfile('Alice').id).toBe(originalId)
  })

  it('keeps offline work locally without reporting a cloud save and retries on reconnect', async () => {
    render(createElement(App))
    await createFamily()
    await enterName('小明')
    await openQuest(1)
    service.setOffline(true)
    fireEvent.click(screen.getByRole('button', { name: '保存测试草稿' }))
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('pending'), { timeout: 5000 })
    expect(savedProfile('小明').progress.projects).toEqual({})
    expect(screen.getByTestId('loaded-project').textContent).toBe('100')
    expect(screen.getByTestId('save-state').textContent).not.toBe('saved')

    service.setOffline(false)
    act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(savedProfile('小明').progress.projects[1]?.updatedAt).toBe(100), { timeout: 5000 })
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('saved'))
  }, 10000)

  it('does not fall back to a cached family when joining a different family link fails offline', async () => {
    const firstPage = render(createElement(App))
    await createFamily()
    await enterName('小明')
    firstPage.unmount()
    const other = service.makeFamily()
    window.history.replaceState(null, '', `/#family=${other.token}`)
    service.setOffline(true)
    render(createElement(StrictMode, null, createElement(App)))
    await screen.findByRole('heading', { name: '给作品安一个家' })
    expect(screen.getByRole('alert').textContent).toContain('云端')
    expect(screen.queryByTitle('小明')).toBeNull()
    expect(screen.queryByRole('heading', { name: '你叫什么名字？' })).toBeNull()
    expect(window.location.hash).not.toContain('family=')
  })

  it.each(['another-family', 'expired-session'] as const)('reconnects the original family after %s without losing the pending draft', async (reason) => {
    render(createElement(StrictMode, null, createElement(App)))
    const originalFamily = await createFamily()
    await enterName('小明')
    await openQuest(1)
    const originalId = savedProfile('小明', originalFamily).id
    const otherFamily = service.makeFamily()
    if (reason === 'another-family') service.setSession(otherFamily)
    else service.clearSession()
    fireEvent.click(screen.getByRole('button', { name: '保存测试草稿' }))
    // Leaving flushes immediately and must stop when the cookie no longer belongs to this family.
    fireEvent.click(screen.getByRole('button', { name: '切换用户' }))
    const reconnect = await screen.findByRole('button', { name: '重新连接家庭' })
    expect(screen.getByTestId('loaded-project').textContent).toBe('100')
    expect(screen.getByTestId('save-state').textContent).toBe('error')
    expect(savedProfile('小明', originalFamily).progress.projects).toEqual({})
    expect(readCloudCache(originalFamily.space.id, originalId)?.desiredProgress.projects[1]?.updatedAt).toBe(100)
    expect(otherFamily.profiles.size).toBe(0)

    fireEvent.click(reconnect)
    await waitFor(() => expect(savedProfile('小明', originalFamily).progress.projects[1]?.updatedAt).toBe(100), { timeout: 5000 })
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('saved'))
    expect(service.currentFamily().space.id).toBe(originalFamily.space.id)
    expect(savedProfile('小明', originalFamily).id).toBe(originalId)
    expect(otherFamily.profiles.size).toBe(0)
    expect(screen.getByTitle('小明')).not.toBeNull()
    const reconnectRequests = service.fetcher.mock.calls.filter(([input, init]) => String(input) === '/api/session' && init?.method === 'POST')
    expect(reconnectRequests).toHaveLength(1)
    expect(JSON.parse(String(reconnectRequests[0][1]?.body)).inviteToken).toBe(originalFamily.token)
  }, 10000)

  it('blocks a same-page family link when the current draft cannot be saved locally', async () => {
    render(createElement(App))
    const originalFamily = await createFamily()
    await enterName('小明')
    await openQuest(1)
    const original = savedProfile('小明', originalFamily)
    const other = service.makeFamily()
    const originalSetItem = Storage.prototype.setItem
    const failSave = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === cloudProfileCacheKey(originalFamily.space.id, original.id)) throw new DOMException('Storage full', 'QuotaExceededError')
      originalSetItem.call(this, key, value)
    })
    fireEvent.click(screen.getByRole('button', { name: '保存测试草稿' }))
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('error'))
    act(() => {
      window.history.replaceState(null, '', `/#family=${other.token}`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('当前草稿尚未安全保存'))
    expect(window.location.hash).toBe('#/')
    expect(service.currentFamily().space.id).toBe(originalFamily.space.id)
    expect(other.profiles.size).toBe(0)
    expect(service.fetcher.mock.calls.filter(([input, init]) => String(input) === '/api/session' && init?.method === 'POST')).toHaveLength(0)

    failSave.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }))
    await waitFor(() => expect(savedProfile('小明', originalFamily).progress.projects[1]?.updatedAt).toBe(100))
    await openQuest(1)
    expect(screen.getByTestId('loaded-project').textContent).toBe('100')
  })

  it('starts fresh cloud profiles without importing or modifying old browser progress', async () => {
    const original = saveProject(completeQuest(emptyProgress(), 1, 2), 2, testProject(2))
    const backup = JSON.stringify(original)
    localStorage.setItem(PROGRESS_STORAGE_KEY, backup)
    localStorage.setItem(`${PROFILE_STORAGE_PREFIX}old-local-profile`, 'old local content')
    localStorage.setItem('maker-island-last-profile-v1', 'old-local-profile')
    sessionStorage.setItem('maker-island-session-profile-v1', 'old-local-profile')
    render(createElement(App))
    await createFamily()
    expect(screen.queryByText('给原有进度起个名字')).toBeNull()
    await enterName('原来的我')
    expect(savedProfile('原来的我').progress).toEqual(emptyProgress())
    expect(localStorage.getItem(PROGRESS_STORAGE_KEY)).toBe(backup)
    expect(localStorage.getItem(`${PROFILE_STORAGE_PREFIX}old-local-profile`)).toBe('old local content')
    expect(screen.getByRole('button', { name: /^第 2 关，.*尚未解锁$/ })).not.toBeNull()
  })
})

import { createElement } from 'react'
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { completeQuest, emptyProgress, PROGRESS_STORAGE_KEY, saveProject } from './progress'
import { getProfile, listProfiles, PROFILE_STORAGE_PREFIX } from './profiles'
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

// Keep user selection, migration, progress, storage and the map real. Only WebGL is replaced.
vi.mock('./Studio', () => ({
  Studio: (props: StudioProps) => {
    studioCapture.latest = props
    return createElement('main', { 'aria-label': '测试工作台' },
      createElement('span', { title: props.username }, props.username),
      createElement('p', null, `测试第 ${props.quest.id} 关`),
      createElement('output', { 'data-testid': 'loaded-project' }, props.savedProject ? String(props.savedProject.updatedAt) : '尚无草稿'),
      createElement('button', { onClick: () => props.onProjectChange(props.quest.id, testProject(props.quest.id)) }, '保存测试草稿'),
      createElement('button', { onClick: () => props.onComplete(props.quest.id, 3, testProject(props.quest.id, true), ['accuracy', 'independence'], `q${props.quest.id}-practice`) }, '完成测试关卡'),
      createElement('button', { onClick: props.onSwitchProfile }, '切换用户'),
      createElement('button', { onClick: props.onBack }, '返回地图'),
    )
  },
}))

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  studioCapture.latest = null
  let tail = Promise.resolve<unknown>(undefined)
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, callback: () => unknown) => {
        const pending = tail.then(callback)
        tail = pending.catch(() => undefined)
        return pending
      },
    },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
  else Reflect.deleteProperty(navigator, 'locks')
})

function savedProfile(name: string) {
  const directory = listProfiles()
  if (!directory.ok) throw new Error(directory.message)
  const summary = directory.profiles.find((item) => item.name === name)
  if (!summary) throw new Error(`missing profile ${name}`)
  const result = getProfile(summary.id)
  if (!result.ok) throw new Error(result.message)
  return result.profile
}

async function enterName(name: string, displayedName = name.trim()) {
  const input = await screen.findByLabelText(/^你的名字/)
  fireEvent.change(input, { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: /^(开始冒险|继续冒险|保存名字，开始冒险)/ }))
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

describe('username profile app integration', () => {
  it('isolates drafts, completions and old callbacks while switching 小明 → 小红 → 小明', async () => {
    render(createElement(App))
    expect(screen.getByRole('heading', { name: '你叫什么名字？' })).not.toBeNull()
    await enterName('小明')
    await openQuest(1)
    fireEvent.click(screen.getByRole('button', { name: '保存测试草稿' }))
    await waitFor(() => expect(savedProfile('小明').progress.projects[1]?.updatedAt).toBe(100))
    fireEvent.click(screen.getByRole('button', { name: '完成测试关卡' }))
    await waitFor(() => expect(savedProfile('小明').progress.completedQuestIds).toEqual([1]))
    fireEvent.click(screen.getByRole('button', { name: '返回地图' }))
    await screen.findByRole('button', { name: /^第 2 关，.*可以开始$/ })
    await openQuest(2)
    fireEvent.click(screen.getByRole('button', { name: '保存测试草稿' }))
    await waitFor(() => expect(savedProfile('小明').progress.projects[2]?.updatedAt).toBe(200))
    const previousStudio = studioCapture.latest!
    const mingBeforeSwitch = savedProfile('小明')

    await switchUser()
    await enterName('小红')
    expect(screen.getByRole('button', { name: /^第 1 关，.*可以开始$/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /^第 2 关，.*尚未解锁$/ })).not.toBeNull()
    expect(savedProfile('小红').progress).toEqual(emptyProgress())
    const hongBeforeStaleCallbacks = savedProfile('小红')

    await act(async () => {
      previousStudio.onProjectChange(2, { ...testProject(2), updatedAt: 999 })
      previousStudio.onComplete(3, 3, testProject(3, true), ['accuracy'])
      await Promise.resolve()
    })
    expect(savedProfile('小明')).toEqual(mingBeforeSwitch)
    expect(savedProfile('小红')).toEqual(hongBeforeStaleCallbacks)

    await switchUser()
    await enterName('小明')
    expect(screen.getByRole('button', { name: /^第 1 关，.*已完成$/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /^第 2 关，.*可以开始$/ })).not.toBeNull()
    await openQuest(2)
    expect(screen.getByTestId('loaded-project').textContent).toBe('200')
    expect(savedProfile('小明').progress.badgesByQuest[1]).toEqual(['completion', 'accuracy', 'independence'])
    expect(savedProfile('小明').progress.completedPracticeIds).toEqual(['q1-practice'])
  })

  it('restores the current user and saved studio on refresh, then offers a welcome on a new session', async () => {
    const firstPage = render(createElement(App))
    await enterName('小明')
    await openQuest(1)
    fireEvent.click(screen.getByRole('button', { name: '保存测试草稿' }))
    await waitFor(() => expect(savedProfile('小明').progress.projects[1]?.updatedAt).toBe(100))
    firstPage.unmount()

    const refreshedPage = render(createElement(App))
    await screen.findByText('测试第 1 关')
    expect(screen.getByTitle('小明')).not.toBeNull()
    expect(screen.getByTestId('loaded-project').textContent).toBe('100')
    expect(screen.queryByRole('textbox')).toBeNull()
    refreshedPage.unmount()

    sessionStorage.clear()
    render(createElement(App))
    expect(screen.getByRole('heading', { name: '欢迎回来，小明' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^继续冒险/ }))
    await waitFor(() => expect(screen.getByTitle('小明')).not.toBeNull())
    expect(savedProfile('小明').progress.projects[1]?.updatedAt).toBe(100)
  })

  it('reopens the same profile for trimmed case-insensitive names', async () => {
    render(createElement(App))
    await enterName('Alice')
    const originalId = savedProfile('Alice').id
    await switchUser()
    await enterName(' alice ', 'Alice')

    const directory = listProfiles()
    expect(directory.ok && directory.profiles.length).toBe(1)
    expect(savedProfile('Alice').id).toBe(originalId)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('stays on the current workspace when saving fails and saves the retained draft after retry', async () => {
    render(createElement(App))
    await enterName('小明')
    await openQuest(1)
    const originalSetItem = Storage.prototype.setItem
    const storageFailure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith(PROFILE_STORAGE_PREFIX)) throw new DOMException('Storage full', 'QuotaExceededError')
      originalSetItem.call(this, key, value)
    })
    fireEvent.click(screen.getByRole('button', { name: '保存测试草稿' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '切换用户' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('尚未切换用户'))
    expect(screen.getByTitle('小明')).not.toBeNull()
    expect(screen.getByTestId('loaded-project').textContent).toBe('100')
    expect(screen.queryByRole('heading', { name: '你叫什么名字？' })).toBeNull()
    expect(savedProfile('小明').progress.projects).toEqual({})

    storageFailure.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }))
    await waitFor(() => expect(savedProfile('小明').progress.projects[1]?.updatedAt).toBe(100))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    await switchUser()
    expect(screen.getByRole('heading', { name: '你叫什么名字？' })).not.toBeNull()
  })

  it('names the original progress once, preserves its backup, and starts later users empty', async () => {
    const original = saveProject(completeQuest(emptyProgress(), 1, 2), 2, testProject(2))
    const backup = JSON.stringify(original)
    localStorage.setItem(PROGRESS_STORAGE_KEY, backup)
    render(createElement(App))
    expect(screen.getByRole('heading', { name: '给原有进度起个名字' })).not.toBeNull()

    await enterName('原来的我')
    expect(savedProfile('原来的我').progress).toEqual(original)
    expect(savedProfile('原来的我').migratedLegacy).toBe(true)
    expect(localStorage.getItem(PROGRESS_STORAGE_KEY)).toBe(backup)
    expect(screen.getByRole('button', { name: /^第 1 关，.*已完成$/ })).not.toBeNull()

    await switchUser()
    await enterName('新同学')
    expect(savedProfile('新同学').progress).toEqual(emptyProgress())
    expect(savedProfile('原来的我').progress).toEqual(original)
    expect(localStorage.getItem(PROGRESS_STORAGE_KEY)).toBe(backup)
  })
})

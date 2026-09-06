import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelShape, QuestProject } from './types'
import { quests } from './course'
import { Studio } from './Studio'

interface ViewportSnapshot {
  shapes: ModelShape[]
  onSceneReady: () => void
}

const viewport = vi.hoisted(() => ({ current: undefined as ViewportSnapshot | undefined }))
vi.mock('./ModelViewport', () => ({
  ModelViewport: (props: ViewportSnapshot) => { viewport.current = props; return null },
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
  vi.setSystemTime(new Date('2026-09-05T10:00:00Z'))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  viewport.current = undefined
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function advance(milliseconds: number) {
  act(() => { vi.advanceTimersByTime(milliseconds) })
}

function button(name: string | RegExp) {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

function click(name: string | RegExp) { fireEvent.click(button(name)) }

function sceneReady() { act(() => { viewport.current!.onSceneReady() }) }

function renderStudio(id: number) {
  const onProjectChange = vi.fn<(questId: number, project: QuestProject) => void>()
  const onComplete = vi.fn(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  const view = render(createElement(Studio, {
    quest: quests.find((quest) => quest.id === id)!,
    totalStars: 0, storageHealthy: true, saveState: 'saved', username: '体验测试',
    onBack: vi.fn(), onSwitchProfile: vi.fn(), onProjectChange, onComplete,
  }))
  click('跳过演示')
  const skipViewGuide = screen.queryByRole('button', { name: '跳过' })
  if (skipViewGuide) fireEvent.click(skipViewGuide)
  return { ...view, onProjectChange, onComplete }
}

function finishShapeMain() {
  click(/选择球体/)
  click(/选择圆柱/)
  click(/选择圆锥/)
  click('检查最终作品')
}

function startPractice() {
  sceneReady()
  advance(2000)
  click('开始小挑战')
}

describe('real Studio quest flow with only the 3D renderer substituted', () => {
  it('keeps wrong guesses harmless, preserves the main scene and saves before a manually claimed reward', () => {
    const { onComplete, onProjectChange } = renderStudio(1)
    expect(screen.getAllByRole('button', { name: /选择(?:方块|球体|圆锥)/ })).toHaveLength(3)
    const original = structuredClone(viewport.current!.shapes)
    const initialSaveCount = onProjectChange.mock.calls.length
    click(/选择方块/)
    expect(viewport.current!.shapes).toEqual(original)
    expect(onProjectChange).toHaveBeenCalledTimes(initialSaveCount)
    expect(screen.getAllByRole('status').some((status) => status.textContent?.includes('没有平面，也没有尖角'))).toBe(true)
    advance(3000)
    finishShapeMain()
    const mainShapes = structuredClone(viewport.current!.shapes)
    expect(mainShapes).toHaveLength(5)
    expect(mainShapes.map((shape) => shape.id)).toEqual(['snow-body', 'snow-head', 'detective-cup', 'detective-cone', 'icecream-scoop'])
    expect(onComplete).not.toHaveBeenCalled()
    expect(button('开始小挑战').disabled).toBe(true)

    // The render acknowledgement, not the check button, starts observation.
    advance(5000)
    expect(button('开始小挑战').disabled).toBe(true)
    sceneReady()
    advance(1999)
    expect(button('开始小挑战').disabled).toBe(true)
    advance(1)
    expect(button('开始小挑战').disabled).toBe(false)
    advance(7000)
    expect(screen.queryByRole('dialog')).toBeNull()
    click('开始小挑战')
    expect(viewport.current!.shapes).toEqual([])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('生日蜡烛')
    click(/选择方块/)
    expect(viewport.current!.shapes).toEqual([])
    expect(onComplete).not.toHaveBeenCalled()
    advance(4000)
    click(/选择圆柱/)

    expect(viewport.current!.shapes.map((shape) => shape.id)).toEqual(['birthday-candle'])
    expect(onComplete).toHaveBeenCalledTimes(1)
    const call = onComplete.mock.calls[0] as unknown as [number, number, QuestProject, string[], string]
    expect(call[0]).toBe(1)
    expect(call[2].shapes).toEqual(mainShapes)
    expect(call[2].elapsedSeconds).toBe(7)
    expect(call[4]).toBe('q1-shape-variation')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(button('领取奖励').disabled).toBe(true)
    for (const [, project] of onProjectChange.mock.calls) {
      expect(project.shapes.some((shape) => shape.id === 'birthday-candle')).toBe(false)
    }
    expect(onProjectChange.mock.calls.at(-1)![1].shapes).toEqual(mainShapes)

    // Final observation can be arbitrarily long without more saves or a popup.
    advance(10_000)
    expect(button('领取奖励').disabled).toBe(true)
    sceneReady()
    advance(2000)
    expect(button('领取奖励').disabled).toBe(false)
    advance(10_000)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onComplete).toHaveBeenCalledTimes(1)
    click('领取奖励')
    expect(screen.getByRole('dialog').textContent).toContain('作品已达到本关目标')
    click('继续欣赏')
    expect(screen.queryByRole('dialog')).toBeNull()
    click('领取奖励')
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(call[2].elapsedSeconds).toBe(7)
  })

  it('requires two actual 30-degree roof turns and reverses direction for the separate challenge', () => {
    const { onComplete, onProjectChange } = renderStudio(4)
    expect(viewport.current!.shapes[0].rotation.z).toBeCloseTo(-Math.PI / 3)
    click(/向左转/)
    expect(viewport.current!.shapes[0].rotation.z).toBeCloseTo(-Math.PI / 6)
    click('检查这一步')
    expect(screen.queryByRole('button', { name: '开始小挑战' })).toBeNull()
    expect(onComplete).not.toHaveBeenCalled()
    click(/向左转/)
    expect(viewport.current!.shapes[0].rotation.z).toBeCloseTo(0)
    click('检查最终作品')
    const passed = structuredClone(viewport.current!.shapes)
    startPractice()
    expect(viewport.current!.shapes[0].rotation.z).toBeCloseTo(Math.PI / 3)
    expect(viewport.current!.shapes[0].color).not.toBe(passed[0].color)
    click(/向左转/)
    expect(viewport.current!.shapes[0].rotation.z).toBeCloseTo(Math.PI / 2)
    click('看看还差哪里')
    expect(onComplete).not.toHaveBeenCalled()
    click(/撤销/)
    click(/向右转/)
    expect(viewport.current!.shapes[0].rotation.z).toBeCloseTo(Math.PI / 6)
    expect(onComplete).not.toHaveBeenCalled()
    click(/向右转/)
    expect(viewport.current!.shapes[0].rotation.z).toBeCloseTo(0)
    expect(onComplete).toHaveBeenCalledTimes(1)
    const call = onComplete.mock.calls[0] as unknown as [number, number, QuestProject, string[], string]
    expect(call[2].shapes).toEqual(passed)
    expect(call[4]).toBe('q4-rotate-variation')
    expect(onProjectChange.mock.calls.every(([, project]) => project.shapes.every((shape) => shape.color === '#f36e79'))).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores a pre-reset renderer callback and cannot trigger rewards after unmount', () => {
    const { onComplete, unmount } = renderStudio(4)
    const oldSceneReady = viewport.current!.onSceneReady
    click(/向左转/)
    click('重新开始')
    expect(viewport.current!.shapes[0].rotation.z).toBeCloseTo(-Math.PI / 3)
    click(/向左转/)
    click(/向左转/)
    click('检查最终作品')
    act(() => { oldSceneReady() })
    advance(5000)
    expect(button('开始小挑战').disabled).toBe(true)
    expect(onComplete).not.toHaveBeenCalled()
    startPractice()
    click(/向右转/)
    click(/向右转/)
    expect(onComplete).toHaveBeenCalledTimes(1)
    const finalSceneReady = viewport.current!.onSceneReady
    sceneReady()
    advance(300)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => { finalSceneReady(); oldSceneReady() })
    advance(5000)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

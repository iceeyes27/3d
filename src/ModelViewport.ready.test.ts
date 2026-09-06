import { createElement } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelViewport } from './ModelViewport'
import type { ModelShape } from './types'

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>()
  return {
    ...three,
    WebGLRenderer: class {
      domElement = document.createElement('canvas')
      setPixelRatio() {}
      setSize() {}
      render() {}
      dispose() {}
      forceContextLoss() {}
    },
  }
})

let frames: Map<number, FrameRequestCallback>
let sequence: number
beforeEach(() => {
  frames = new Map()
  sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function frame() {
  act(() => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(performance.now()))
  })
}

const shapes: ModelShape[] = [{
  id: 'roof', name: '屋顶', type: 'cone', color: '#ff9b56',
  position: { x: 0, y: 2, z: 0 }, scale: { x: 2.4, y: 1.8, z: 2.4 }, rotation: { x: 0, y: 0, z: 0 },
}]

describe('model scene readiness', () => {
  it('waits for the final model frame and ignores selection, callback identity and camera reset', () => {
    const onSceneReady = vi.fn()
    const props = { shapes, questId: 4, selectedId: null, mode: 'rotate' as const, onSelect: vi.fn(), onTransformEnd: vi.fn(), onSceneReady }
    const { rerender, unmount } = render(createElement(ModelViewport, props))
    expect(onSceneReady).not.toHaveBeenCalled()
    frame()
    expect(onSceneReady).not.toHaveBeenCalled()
    frame()
    expect(onSceneReady).toHaveBeenCalledTimes(1)
    const latestCallback = vi.fn()
    rerender(createElement(ModelViewport, { ...props, selectedId: 'roof', resetViewSignal: 1, onSceneReady: latestCallback }))
    frame()
    frame()
    expect(latestCallback).not.toHaveBeenCalled()
    rerender(createElement(ModelViewport, { ...props, celebration: true, onSceneReady: latestCallback }))
    frame()
    expect(latestCallback).not.toHaveBeenCalled()
    frame()
    expect(latestCallback).toHaveBeenCalledTimes(1)
    unmount()
    expect(frames.size).toBe(0)
  })

  it('restarts readiness when a newer model arrives before the pending frame', () => {
    const onSceneReady = vi.fn()
    const props = { shapes, selectedId: null, mode: 'rotate' as const, onSelect: vi.fn(), onTransformEnd: vi.fn(), onSceneReady }
    const { rerender } = render(createElement(ModelViewport, props))
    frame()
    rerender(createElement(ModelViewport, { ...props, shapes: shapes.map((shape) => ({ ...shape, color: '#56bb85' })) }))
    frame()
    expect(onSceneReady).not.toHaveBeenCalled()
    frame()
    expect(onSceneReady).toHaveBeenCalledTimes(1)
  })
})

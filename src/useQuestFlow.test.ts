import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OBSERVATION_MS } from './questFlow'
import { useQuestFlow } from './useQuestFlow'

const scopeElements: HTMLElement[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})

afterEach(() => {
  cleanup()
  for (const element of scopeElements.splice(0)) element.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function advance(milliseconds: number) {
  act(() => { vi.advanceTimersByTime(milliseconds) })
}

function visibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

describe('useQuestFlow observation lifecycle', () => {
  it('waits for the rendered model before starting the full two-second observation', () => {
    const { result } = renderHook(useQuestFlow)
    act(() => { result.current.dispatch({ type: 'inspect-main' }) })
    advance(5000)
    expect(result.current.state).toMatchObject({ phase: 'main-showcase', rendered: false, observedMs: 0 })
    expect(result.current.ready).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    act(() => { result.current.onSceneReady() })
    advance(OBSERVATION_MS - 100)
    expect(result.current.state.observedMs).toBe(1900)
    expect(result.current.ready).toBe(false)
    act(() => { result.current.dispatch({ type: 'practice' }) })
    expect(result.current.state.phase).toBe('main-showcase')
    advance(100)
    expect(result.current.ready).toBe(true)
    expect(result.current.state.phase).toBe('main-showcase')
    expect(vi.getTimerCount()).toBe(0)
    act(() => { result.current.dispatch({ type: 'practice' }) })
    expect(result.current.state.phase).toBe('practice')
  })

  it('unlocks final rewards after two visible seconds but never opens them automatically', () => {
    const { result } = renderHook(useQuestFlow)
    act(() => { result.current.dispatch({ type: 'inspect-final' }) })
    act(() => { result.current.onSceneReady() })
    advance(OBSERVATION_MS - 1)
    act(() => { result.current.dispatch({ type: 'reward' }) })
    expect(result.current.ready).toBe(false)
    expect(result.current.state.phase).toBe('final-showcase')
    advance(1)
    expect(result.current.ready).toBe(true)
    expect(result.current.state.observedMs).toBe(OBSERVATION_MS)
    advance(20_000)
    expect(result.current.state.phase).toBe('final-showcase')
    expect(vi.getTimerCount()).toBe(0)
    act(() => { result.current.dispatch({ type: 'reward' }) })
    expect(result.current.state.phase).toBe('reward')
  })

  it('pauses observation in the background and resumes only the remaining foreground time', () => {
    const { result } = renderHook(useQuestFlow)
    act(() => { result.current.dispatch({ type: 'inspect-final' }) })
    act(() => { result.current.onSceneReady() })
    advance(600)
    expect(result.current.state.observedMs).toBe(600)
    visibility('hidden')
    advance(10_000)
    expect(result.current.state.observedMs).toBe(600)
    expect(result.current.ready).toBe(false)
    visibility('visible')
    advance(1399)
    expect(result.current.ready).toBe(false)
    advance(1)
    expect(result.current.state.observedMs).toBe(OBSERVATION_MS)
    expect(result.current.ready).toBe(true)
    expect(result.current.state.phase).toBe('final-showcase')
  })

  it('does not count a rendered scene while the page is already hidden', () => {
    visibility('hidden')
    const { result } = renderHook(useQuestFlow)
    act(() => { result.current.dispatch({ type: 'inspect-main' }) })
    act(() => { result.current.onSceneReady() })
    advance(5000)
    expect(result.current.state.observedMs).toBe(0)
    expect(result.current.ready).toBe(false)
    visibility('visible')
    advance(OBSERVATION_MS)
    expect(result.current.ready).toBe(true)
  })

  it('invalidates old rendered callbacks and pending observations after reset', () => {
    const { result } = renderHook(useQuestFlow)
    act(() => { result.current.dispatch({ type: 'inspect-main' }) })
    const oldSceneReady = result.current.onSceneReady
    const oldGeneration = result.current.state.generation
    act(() => { oldSceneReady() })
    advance(300)
    act(() => { result.current.dispatch({ type: 'reset' }) })
    expect(result.current.state).toMatchObject({ phase: 'editing', rendered: false, observedMs: 0 })
    expect(vi.getTimerCount()).toBe(0)
    act(() => { result.current.dispatch({ type: 'inspect-final' }) })
    act(() => {
      oldSceneReady()
      result.current.dispatch({ type: 'observe', generation: oldGeneration, milliseconds: OBSERVATION_MS })
    })
    advance(5000)
    expect(result.current.state).toMatchObject({ phase: 'final-showcase', rendered: false, observedMs: 0 })
    expect(result.current.ready).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    act(() => { result.current.onSceneReady() })
    advance(OBSERVATION_MS)
    expect(result.current.ready).toBe(true)
  })

  it('clears its interval and removes the same visibility listener on unmount', () => {
    const addListener = vi.spyOn(document, 'addEventListener')
    const removeListener = vi.spyOn(document, 'removeEventListener')
    const { result, unmount } = renderHook(useQuestFlow)
    act(() => { result.current.dispatch({ type: 'inspect-final' }) })
    act(() => { result.current.onSceneReady() })
    const registered = addListener.mock.calls.find(([name]) => name === 'visibilitychange')
    expect(registered).toBeDefined()
    expect(vi.getTimerCount()).toBe(1)
    advance(200)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', registered![1])
    visibility('hidden')
    advance(5000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['hidden', 'inert'])('pauses while the retained workspace has a %s ancestor', async (attribute) => {
    const wrapper = document.createElement('div')
    const workspace = document.createElement('section')
    wrapper.append(workspace)
    document.body.append(wrapper)
    scopeElements.push(wrapper)
    const scopeRef = { current: workspace }
    const { result } = renderHook(() => useQuestFlow(scopeRef))
    act(() => { result.current.dispatch({ type: 'inspect-final' }) })
    act(() => { result.current.onSceneReady() })
    advance(600)
    await act(async () => { wrapper.setAttribute(attribute, ''); await Promise.resolve() })
    advance(5000)
    expect(document.visibilityState).toBe('visible')
    expect(result.current.state.observedMs).toBe(600)
    expect(result.current.ready).toBe(false)
    await act(async () => { wrapper.removeAttribute(attribute); await Promise.resolve() })
    advance(1399)
    expect(result.current.ready).toBe(false)
    advance(1)
    expect(result.current.ready).toBe(true)
    expect(result.current.state.phase).toBe('final-showcase')
  })

  it('disconnects its scoped visibility observer when unmounted', () => {
    const workspace = document.createElement('section')
    document.body.append(workspace)
    scopeElements.push(workspace)
    const scopeRef = { current: workspace }
    const observe = vi.spyOn(MutationObserver.prototype, 'observe')
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const { result, unmount } = renderHook(() => useQuestFlow(scopeRef))
    act(() => { result.current.dispatch({ type: 'inspect-main' }) })
    act(() => { result.current.onSceneReady() })
    expect(observe).toHaveBeenCalledWith(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'inert'] })
    const observer = observe.mock.contexts[0]
    unmount()
    expect(disconnect.mock.contexts).toContain(observer)
    expect(vi.getTimerCount()).toBe(0)
  })
})

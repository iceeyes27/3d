import { useCallback, useEffect, useReducer, type RefObject } from 'react'
import { canContinueShowcase, initialQuestFlow, isShowcase, questFlowReducer } from './questFlow'

/** Observation starts after the real model frame, and only counts visible time. */
export function useQuestFlow(scopeRef?: RefObject<HTMLElement | null>) {
  const [state, dispatch] = useReducer(questFlowReducer, undefined, initialQuestFlow)
  const ready = canContinueShowcase(state)
  const observing = isShowcase(state)
  const onSceneReady = useCallback(() => dispatch({ type: 'rendered', generation: state.generation }), [state.generation])
  useEffect(() => {
    if (!observing || !state.rendered || ready) return
    let previous = performance.now()
    const isVisible = () => document.visibilityState !== 'hidden' && !scopeRef?.current?.closest('[hidden], [inert]')
    let visible = isVisible()
    const tick = () => {
      const now = performance.now()
      if (visible) dispatch({ type: 'observe', generation: state.generation, milliseconds: now - previous })
      previous = now
    }
    const visibility = () => {
      tick()
      visible = isVisible()
    }
    const timer = window.setInterval(tick, 100)
    document.addEventListener('visibilitychange', visibility)
    // The profile chooser retains the previous workspace under a hidden parent.
    const observer = scopeRef ? new MutationObserver(visibility) : null
    observer?.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'inert'] })
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); observer?.disconnect() }
  }, [observing, ready, scopeRef, state.generation, state.rendered])
  return { state, dispatch, observing, ready, onSceneReady }
}

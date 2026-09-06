import { describe, expect, it } from 'vitest'
import { canContinueShowcase, initialQuestFlow, questFlowReducer } from './questFlow'

describe('quest completion presentation stages', () => {
  it('requires the model frame and two visible seconds before opening a reward', () => {
    let state = questFlowReducer(initialQuestFlow(), { type: 'inspect-final' })
    state = questFlowReducer(state, { type: 'observe', generation: state.generation, milliseconds: 5000 })
    expect(canContinueShowcase(state)).toBe(false)
    state = questFlowReducer(state, { type: 'rendered', generation: state.generation })
    state = questFlowReducer(state, { type: 'observe', generation: state.generation, milliseconds: 1999 })
    expect(questFlowReducer(state, { type: 'reward' }).phase).toBe('final-showcase')
    state = questFlowReducer(state, { type: 'observe', generation: state.generation, milliseconds: 1 })
    expect(canContinueShowcase(state)).toBe(true)
    expect(state.phase).toBe('final-showcase') // Never opens the dialog automatically.
    state = questFlowReducer(state, { type: 'reward' })
    expect(state.phase).toBe('reward')
    expect(questFlowReducer(state, { type: 'reward' })).toBe(state)
    expect(questFlowReducer(state, { type: 'keep-looking' }).phase).toBe('final-showcase')
  })

  it('observes the main model before moving to an independent practice', () => {
    let state = questFlowReducer(initialQuestFlow(), { type: 'inspect-main' })
    expect(questFlowReducer(state, { type: 'practice' })).toBe(state)
    state = questFlowReducer(state, { type: 'rendered', generation: state.generation })
    state = questFlowReducer(state, { type: 'observe', generation: state.generation, milliseconds: 2000 })
    state = questFlowReducer(state, { type: 'practice' })
    expect(state.phase).toBe('practice')
    state = questFlowReducer(state, { type: 'inspect-final' })
    expect(state.observedMs).toBe(0)
    expect(state.rendered).toBe(false)
  })

  it('ignores callbacks from an abandoned observation after editing again', () => {
    let state = questFlowReducer(initialQuestFlow(), { type: 'inspect-main' })
    const old = state.generation
    state = questFlowReducer(state, { type: 'reset' })
    state = questFlowReducer(state, { type: 'inspect-main' })
    state = questFlowReducer(state, { type: 'rendered', generation: old })
    state = questFlowReducer(state, { type: 'observe', generation: old, milliseconds: 9999 })
    expect(state.rendered).toBe(false)
    expect(canContinueShowcase(state)).toBe(false)
  })
})

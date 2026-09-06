export type QuestPhase = 'editing' | 'main-showcase' | 'practice' | 'final-showcase' | 'reward'
export interface QuestFlowState {
  phase: QuestPhase
  generation: number
  rendered: boolean
  observedMs: number
}
export type QuestFlowEvent =
  | { type: 'inspect-main' | 'inspect-final' | 'reset' }
  | { type: 'rendered'; generation: number }
  | { type: 'observe'; generation: number; milliseconds: number }
  | { type: 'practice' | 'reward' | 'keep-looking' }

export const OBSERVATION_MS = 2000
export const initialQuestFlow = (): QuestFlowState => ({ phase: 'editing', generation: 0, rendered: false, observedMs: 0 })
export const isShowcase = (state: QuestFlowState) => state.phase === 'main-showcase' || state.phase === 'final-showcase'
export const canContinueShowcase = (state: QuestFlowState) => isShowcase(state) && state.rendered && state.observedMs >= OBSERVATION_MS

export function questFlowReducer(state: QuestFlowState, event: QuestFlowEvent): QuestFlowState {
  switch (event.type) {
    case 'reset': return { ...initialQuestFlow(), generation: state.generation + 1 }
    case 'inspect-main':
      if (state.phase !== 'editing') return state
      return { phase: 'main-showcase', generation: state.generation + 1, rendered: false, observedMs: 0 }
    case 'inspect-final':
      if (state.phase !== 'practice' && state.phase !== 'editing') return state
      return { phase: 'final-showcase', generation: state.generation + 1, rendered: false, observedMs: 0 }
    case 'rendered':
      return isShowcase(state) && event.generation === state.generation && !state.rendered ? { ...state, rendered: true } : state
    case 'observe':
      if (!isShowcase(state) || !state.rendered || event.generation !== state.generation) return state
      return { ...state, observedMs: Math.min(OBSERVATION_MS, state.observedMs + Math.max(0, event.milliseconds)) }
    case 'practice':
      return state.phase === 'main-showcase' && canContinueShowcase(state) ? { ...state, phase: 'practice', rendered: false, observedMs: 0 } : state
    case 'reward':
      return state.phase === 'final-showcase' && canContinueShowcase(state) ? { ...state, phase: 'reward' } : state
    case 'keep-looking':
      return state.phase === 'reward' ? { ...state, phase: 'final-showcase' } : state
  }
}

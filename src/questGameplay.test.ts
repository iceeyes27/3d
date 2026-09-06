import { describe, expect, it } from 'vitest'
import { evaluateQuest, quests } from './course'
import { createPracticeScenario, evaluatePracticeScenario, recognizeShapeChoice, type PracticeScenario } from './questGameplay'
import type { QuestProject } from './types'

const passed: QuestProject = {
  courseVersion: 2,
  shapes: [{ id: 'precious-work', name: '已经通过的作品', type: 'sphere', color: '#ffffff', position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 } }],
  operations: [{ type: 'plan', at: 1 }], updatedAt: 123,
}

function solve(scenario: PracticeScenario): QuestProject {
  const project = structuredClone(scenario.initialProject)
  switch (scenario.kind) {
    case 'shape-choice':
      project.shapes = recognizeShapeChoice('practice-candle', 'cylinder', project).shapes!
      break
    case 'target':
    case 'align':
      project.shapes = scenario.targetShapes.map((item) => structuredClone(item))
      break
    case 'symmetry':
      project.shapes = scenario.targetShapes.map((item) => structuredClone(item))
      break
    case 'tunnels': {
      const cheese = project.shapes.find((item) => item.id === 'cheese')!
      cheese.holes = project.shapes.filter((item) => item.type === 'cylinder').map((item) => ({ ...item, isHole: false }))
      project.shapes = [cheese]
      break
    }
    case 'wall': {
      const cup = project.shapes[0]
      const core = cup.holes![0]
      const ratio = { x: 5.75 / 5, y: 6.75 / 6, z: 5.75 / 5 }
      for (const axis of ['x', 'y', 'z'] as const) {
        core.position[axis] = cup.position[axis] + (core.position[axis] - cup.position[axis]) * ratio[axis]
        core.scale[axis] *= ratio[axis]
      }
      cup.scale = { x: 5.75, y: 6.75, z: 5.75 }
      break
    }
    case 'repair':
      project.shapes.find((item) => item.id === 'floating-part')!.position.y = 1.1
      break
    case 'brief':
      project.operations = [{ type: 'plan', at: 123 }]
      project.shapes.find((item) => item.id === 'practice-sign')!.position = { x: 0.5, y: 2.5, z: 0 }
      break
    case 'capstone':
      project.shapes.find((item) => item.id === 'organizer-knob')!.position.y = 2
      project.shapes.forEach((item) => { item.grouped = true })
      break
  }
  return project
}

describe('isolated result-based practice scenes', () => {
  it.each(quests)('quest $id starts incomplete and has a reachable final result', (quest) => {
    const scenario = createPracticeScenario(quest, passed)
    expect(evaluatePracticeScenario(scenario, scenario.initialProject).complete).toBe(false)
    expect(evaluatePracticeScenario(scenario, solve(scenario))).toMatchObject({ complete: true })
    expect(scenario.tools.length).toBeLessThanOrEqual(6)
  })

  it.each(quests)('quest $id cannot pass by appending an operation without changing the model', (quest) => {
    const scenario = createPracticeScenario(quest, passed)
    const untouched = structuredClone(scenario.initialProject)
    untouched.operations = ['add', 'move', 'scale', 'rotate', 'align', 'duplicate', 'hole', 'group', 'plan'].map((type) => ({ type: type as QuestProject['operations'][number]['type'], at: 124 }))
    expect(evaluatePracticeScenario(scenario, untouched).complete).toBe(false)
  })

  it('never mutates or borrows passed work, even after a reset of the same scenario', () => {
    const original = structuredClone(passed)
    for (const quest of quests) {
      const first = createPracticeScenario(quest, passed)
      const second = createPracticeScenario(quest, passed)
      if (first.initialProject.shapes.length) first.initialProject.shapes[0].scale.x = 999
      expect(second.initialProject.shapes[0]?.scale.x).not.toBe(999)
      expect(passed).toEqual(original)
      expect(second.initialProject.operations).toEqual([])
      expect(second.initialProject.shapes.every((item) => item.id !== 'precious-work')).toBe(true)
    }
  })

  it('changes the roof direction and requires more than one correct rotation', () => {
    const scenario = createPracticeScenario(quests[3], passed)
    const project = structuredClone(scenario.initialProject)
    expect(project.shapes[0].rotation.z).toBeCloseTo(Math.PI / 3)
    project.shapes[0].rotation.z -= Math.PI / 6
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(false)
    project.shapes[0].rotation.z -= Math.PI / 6
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(true)
    project.shapes[0].rotation.x = Math.PI / 2
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(false)
  })

  it('starts the repair order with only its floating/connection problem, and rejects deleting the bad part', () => {
    const scenario = createPracticeScenario(quests[9], passed)
    const initial = evaluateQuest(10, scenario.initialProject.shapes, [])
    expect(initial.map((item) => item.complete)).toEqual([true, false, false])
    const deleted = structuredClone(scenario.initialProject)
    deleted.shapes = deleted.shapes.filter((item) => item.id !== 'floating-part')
    expect(evaluatePracticeScenario(scenario, deleted).complete).toBe(false)
    const grounded = structuredClone(scenario.initialProject)
    grounded.shapes.find((item) => item.id === 'floating-part')!.position.y = 0.6
    expect(evaluatePracticeScenario(scenario, grounded).complete).toBe(true)
  })

  it('requires subtraction, not just toggling the remaining cylinder into a hole', () => {
    const scenario = createPracticeScenario(quests[7], passed)
    const project = structuredClone(scenario.initialProject)
    project.shapes.find((item) => item.id === 'practice-tunnel-2')!.isHole = true
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(false)
    expect(evaluatePracticeScenario(scenario, solve(scenario)).complete).toBe(true)
  })

  it('requires both a plan and a repaired result for the new brief', () => {
    const scenario = createPracticeScenario(quests[10], passed)
    const project = solve(scenario)
    project.operations = []
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(false)
    project.operations = [{ type: 'plan', at: 2 }]
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(true)
  })

  it('keeps the capstone repair target reachable with the viewport quarter-unit snap', () => {
    const scenario = createPracticeScenario(quests[11], passed)
    const project = solve(scenario)
    const knob = project.shapes.find((item) => item.id === 'organizer-knob')!
    knob.position.y = Math.round(knob.position.y / 0.25) * 0.25
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(true)
  })

  it('requires both new shelves to reach the line, not a no-op alignment of an already fixed one', () => {
    const scenario = createPracticeScenario(quests[4], passed)
    const project = structuredClone(scenario.initialProject)
    project.shapes[0].position.y = 0.5
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(false)
    project.shapes[0].position.y = 0.5
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(false)
    project.shapes[1].position.y = 0.5
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(true)
  })

  it('does not accept a fresh duplicate until the second arm reaches the opposite side', () => {
    const scenario = createPracticeScenario(quests[6], passed)
    const project = structuredClone(scenario.initialProject)
    const copy = { ...structuredClone(project.shapes[0]), id: 'copy' }
    copy.position.x += 1.5
    project.shapes.push(copy)
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(false)
    copy.position.x += 1.5
    expect(evaluatePracticeScenario(scenario, project).complete).toBe(true)
  })
})

describe('shape detective choices', () => {
  it('keeps a wrong guess retryable without writing a wrong shape', () => {
    const original = structuredClone(passed)
    expect(recognizeShapeChoice('find-round', 'box', passed)).toMatchObject({ correct: false })
    expect(recognizeShapeChoice('find-round', 'box', passed).shapes).toBeUndefined()
    expect(passed).toEqual(original)
  })

  it('automatically assembles one recognizable object after each correct choice', () => {
    const project: QuestProject = { courseVersion: 2, shapes: [], operations: [], updatedAt: 1 }
    project.shapes = recognizeShapeChoice('find-round', 'sphere', project).shapes!
    expect(project.shapes.map((item) => item.id)).toEqual(['snow-body', 'snow-head'])
    expect(evaluateQuest(1, project.shapes, []).map((item) => item.complete)).toEqual([true, false, false])
    project.shapes = recognizeShapeChoice('find-tall', 'cylinder', project).shapes!
    expect(evaluateQuest(1, project.shapes, []).map((item) => item.complete)).toEqual([true, true, false])
    project.shapes = recognizeShapeChoice('find-point', 'cone', project).shapes!
    expect(evaluateQuest(1, project.shapes, []).every((item) => item.complete)).toBe(true)
    const repeated = recognizeShapeChoice('find-point', 'cone', project)
    expect(repeated.shapes).toHaveLength(project.shapes.length)
  })

  it('makes the new candle a different object instead of adding another sweet cone', () => {
    const scenario = createPracticeScenario(quests[0], passed)
    expect(scenario.choice?.options).toHaveLength(3)
    const wrong = recognizeShapeChoice('practice-candle', 'sphere', scenario.initialProject)
    expect(wrong.correct).toBe(false)
    const correct = recognizeShapeChoice('practice-candle', 'cylinder', scenario.initialProject)
    expect(correct.shapes?.[0].id).toBe('birthday-candle')
  })
})

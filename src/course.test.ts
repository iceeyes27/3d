import { describe, expect, it } from 'vitest'
import { evaluatePrintChecks, evaluateQuest, holePassesThroughBase, quests, tunnelsAreDistinct } from './course'
import type { ModelShape } from './types'

const model = (type: ModelShape['type'], id: string, overrides: Partial<ModelShape> = {}): ModelShape => ({
  id,
  name: id,
  type,
  color: '#ffffff',
  position: { x: 0, y: 0.5, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  ...overrides,
})

describe('v2 course definition', () => {
  it('contains three playable worlds with four one-skill quests each', () => {
    expect(quests).toHaveLength(12)
    expect(quests.every((quest) => quest.available)).toBe(true)
    expect([1, 2, 3].map((worldId) => quests.filter((quest) => quest.worldId === worldId).length)).toEqual([4, 4, 4])
    expect(new Set(quests.map((quest) => quest.skillId)).size).toBe(12)
    expect(quests.every((quest) => quest.steps.every((item) => item.tools.length <= 6))).toBe(true)
  })

  it('uses final shape evidence for the shape detective', () => {
    const shapes = [model('sphere', 'snow'), model('cylinder', 'cup'), model('cone', 'ice-cream')]
    expect(evaluateQuest(1, shapes, []).every((task) => task.complete)).toBe(true)
    expect(evaluateQuest(1, shapes.slice(0, 2), []).at(-1)?.feedback).toContain('圆锥')
  })

  it('requires the block to end inside its target instead of merely recording a move', () => {
    const block = model('box', 'moving-block', { position: { x: -2, y: 0.75, z: 0 } })
    expect(evaluateQuest(2, [block], [{ type: 'move' }]).every((task) => task.complete)).toBe(false)
    block.position = { x: 2, y: 0.75, z: -1.5 }
    expect(evaluateQuest(2, [block], []).every((task) => task.complete)).toBe(true)
  })

  it('checks the final scale and roof rotation', () => {
    const sized = model('box', 'scale-block', { scale: { x: 1.5, y: 1.5, z: 1.5 } })
    expect(evaluateQuest(3, [sized], []).every((task) => task.complete)).toBe(true)
    const roof = model('cone', 'roof', { rotation: { x: 0, y: 0, z: -Math.PI / 6 } })
    expect(evaluateQuest(4, [roof], [{ type: 'rotate' }])[0].complete).toBe(false)
    roof.rotation.z = 0
    expect(evaluateQuest(4, [roof], [])[0].complete).toBe(true)
    roof.rotation.x = Math.PI / 2
    expect(evaluateQuest(4, [roof], [])[0].complete).toBe(false)
  })

  it('offers three actual choices for each detective card and more than one roof turn', () => {
    expect(quests[0].steps.every((item) => item.tools.length === 3)).toBe(true)
    expect(quests[0].tasks.map((item) => item.label).join('')).not.toMatch(/球体|圆柱|圆锥/)
    expect(quests[0].steps.map((item) => item.instruction).join('')).not.toMatch(/加入一个球体|加入一个圆柱|加入一个圆锥/)
    expect(quests[3].starterShapes?.[0].rotation.z).toBeCloseTo(-Math.PI / 3)
    expect(quests[3].steps[0].instruction).toContain('向左或向右')
  })

  it('checks real alignment and exact millimetre dimensions', () => {
    const shelves = ['left', 'middle', 'right'].map((side, index) => model('box', `shelf-${side}`, { position: { x: index * 2, y: 0.5, z: 0 } }))
    expect(evaluateQuest(5, shelves, []).every((task) => task.complete)).toBe(true)
    const exact = model('box', 'size-block', { scale: { x: 12, y: 8, z: 5 } })
    expect(evaluateQuest(6, [exact], []).every((task) => task.complete)).toBe(true)
  })

  it('requires two equal, mirrored robot arms', () => {
    const left = model('box', 'left-arm', { name: '左臂', position: { x: -1.5, y: 2, z: 0 }, scale: { x: 0.7, y: 2, z: 0.7 } })
    const right = { ...structuredClone(left), id: 'right-arm', name: '左臂 的复制品', position: { x: 1.5, y: 2, z: 0 } }
    expect(evaluateQuest(7, [left, right], []).every((task) => task.complete)).toBe(true)
    right.scale.x = 1.2
    expect(evaluateQuest(7, [left, right], []).at(-1)?.complete).toBe(false)
  })

  it('requires three distinct, truly penetrating cheese tunnels', () => {
    const cheese = model('box', 'cheese', { position: { x: 0, y: 1.8, z: 0 }, scale: { x: 5.5, y: 3.6, z: 3.2 } })
    cheese.holes = [-0.9, 0, 0.9].map((z, index) => model('cylinder', `hole-${index}`, {
      position: { x: 0, y: 1.8, z }, rotation: { x: 0, y: 0, z: Math.PI / 2 }, scale: { x: 0.7, y: 6, z: 0.7 },
    }))
    expect(evaluateQuest(8, [cheese], []).every((task) => task.complete)).toBe(true)
    expect(tunnelsAreDistinct([cheese.holes[0], { ...cheese.holes[0], id: 'overlap' }])).toBe(false)
  })

  it('keeps tunnel preparation active until all live holes are valid', () => {
    const cheese = model('box', 'cheese', { position: { x: 0, y: 1.8, z: 0 }, scale: { x: 5.5, y: 3.6, z: 3.2 } })
    const liveHoles = [-0.9, 0, 0.9].map((z, index) => model('cylinder', `hole-${index}`, {
      isHole: true,
      position: { x: 0, y: 1.8, z },
      scale: { x: 0.7, y: 6, z: 0.7 },
    }))
    const preparation = evaluateQuest(8, [cheese, ...liveHoles], [])[0]
    expect(preparation.complete).toBe(false)
    expect(preparation.feedback).toContain('旋转')

    liveHoles.forEach((hole) => { hole.rotation.z = Math.PI / 2 })
    expect(evaluateQuest(8, [cheese, ...liveHoles], [])[0].complete).toBe(true)
  })

  it('rejects a tunnel that only clips the cheese edge', () => {
    const cheese = model('box', 'cheese', { position: { x: 0, y: 1.8, z: 0 }, scale: { x: 5.5, y: 3.6, z: 3.2 } })
    const diagonal = model('cylinder', 'diagonal', { position: { x: 0, y: 3.3, z: 0 }, rotation: { x: 0, y: 0, z: -Math.PI / 4 }, scale: { x: 0.4, y: 8, z: 0.4 } })
    expect(holePassesThroughBase(cheese, diagonal)).toBe(false)
  })

  it('checks wall thickness and a sealed cup bottom', () => {
    const cup = model('cylinder', 'pen-cup', { position: { x: 0, y: 3, z: 0 }, scale: { x: 5, y: 6, z: 5 } })
    cup.holes = [model('cylinder', 'cup-core', { position: { x: 0, y: 3.3, z: 0 }, scale: { x: 3.8, y: 5.4, z: 3.8 } })]
    expect(evaluateQuest(9, [cup], []).every((task) => task.complete)).toBe(true)
    cup.holes[0].position.y = 3
    cup.holes[0].scale.y = 6
    expect(evaluateQuest(9, [cup], []).at(-1)?.complete).toBe(false)
  })

  it('offers a wall-thickness variation that remains operable after subtraction', () => {
    expect(quests[8].practice).toMatchObject({ tools: ['scale'], operationTypes: ['scale'] })
    expect(quests[8].practice?.instruction).toContain('外壳')
  })

  it('checks thin, floating, and disconnected print issues', () => {
    const base = model('box', 'base', { position: { x: 0, y: 0.3, z: 0 }, scale: { x: 4, y: 0.6, z: 2.5 } })
    const fixed = model('box', 'part', { position: { x: 0, y: 0.9, z: 0 }, scale: { x: 1.2, y: 1.2, z: 1.2 } })
    const side = model('box', 'side', { position: { x: 1.3, y: 0.9, z: 0 }, scale: { x: 0.65, y: 1.2, z: 1 } })
    expect(evaluateQuest(10, [base, fixed, side], []).every((task) => task.complete)).toBe(true)
    fixed.position.y = 3
    expect(evaluateQuest(10, [base, fixed, side], []).at(-1)?.complete).toBe(false)
    expect(evaluateQuest(10, [], []).at(-1)?.complete).toBe(false)
  })

  it('reports independent repair lights instead of treating the whole result as connection evidence', () => {
    const shapes = structuredClone(quests[9].starterShapes!)
    shapes.find((item) => item.id === 'floating-part')!.position.y = 0.9
    expect(evaluatePrintChecks(shapes)).toEqual({ thickness: false, support: true, connection: true })
    expect(evaluateQuest(10, shapes, []).at(-1)?.complete).toBe(false)
    shapes.find((item) => item.id === 'thin-part')!.scale.x = 0.65
    expect(evaluatePrintChecks(shapes)).toEqual({ thickness: true, support: true, connection: true })
    expect(evaluatePrintChecks([])).toEqual({ thickness: false, support: false, connection: false })
  })

  it('keeps planning as evidence but judges final brief and capstone models', () => {
    const base = model('box', 'base', { position: { x: 0, y: 0.5, z: 0 } })
    const post = model('cylinder', 'post', { position: { x: 0, y: 1.5, z: 0 } })
    const sign = model('box', 'sign', { position: { x: 0, y: 2.5, z: 0 } })
    expect(evaluateQuest(11, [base, post, sign], []).at(0)?.complete).toBe(false)
    expect(evaluateQuest(11, [base, post, sign], [{ type: 'plan' }]).every((task) => task.complete)).toBe(true)
    const capstone = [base, post, sign, model('sphere', 'top', { position: { x: 0, y: 3.5, z: 0 } })].map((item) => ({ ...item, grouped: true }))
    expect(evaluateQuest(12, capstone, []).every((task) => task.complete)).toBe(true)
    capstone[0].grouped = false
    expect(evaluateQuest(12, capstone, []).at(-1)?.complete).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { evaluateQuest, holePassesThroughBase, quests, tunnelsAreDistinct } from './course'
import type { ModelShape } from './types'

const shape = (type: ModelShape['type'], id: string): ModelShape => ({
  id,
  name: id,
  type,
  color: '#fff',
  position: { x: 0, y: 1, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
})

describe('course definition', () => {
  it('contains a twelve-quest world with four playable quests', () => {
    expect(quests).toHaveLength(12)
    expect(quests.filter((quest) => quest.available).map((quest) => quest.id)).toEqual([1, 2, 3, 4])
  })

  it('evaluates the first quest by skill evidence', () => {
    const shapes = [shape('box', 'a'), shape('sphere', 'b'), shape('cylinder', 'c')]
    const result = evaluateQuest(1, shapes, [{ type: 'move' }, { type: 'scale' }])
    expect(result.every((task) => task.complete)).toBe(true)
  })

  it('requires three applied holes to finish the subtraction quest', () => {
    const cheese = shape('box', 'cheese')
    cheese.scale = { x: 5.5, y: 3.6, z: 3.2 }
    cheese.position = { x: 0, y: 1.8, z: 0 }
    cheese.holes = ['h1', 'h2', 'h3'].map((id, index) => ({
      ...shape('cylinder', id),
      position: { x: 0, y: 1.2, z: index - 1 },
      rotation: { x: 0, y: 0, z: Math.PI / 2 },
      scale: { x: 0.7, y: 6, z: 0.7 },
    }))
    const result = evaluateQuest(4, [cheese], [{ type: 'rotate', shapeId: 'h1' }, { type: 'group', shapeId: 'cheese' }])
    expect(result.every((task) => task.complete)).toBe(true)
  })

  it('rejects a cylinder that does not cross the base', () => {
    const cheese = { ...shape('box', 'cheese'), scale: { x: 5.5, y: 3.6, z: 3.2 } }
    const farHole = { ...shape('cylinder', 'hole'), position: { x: 20, y: 1, z: 0 }, scale: { x: 1, y: 8, z: 1 } }
    expect(holePassesThroughBase(cheese, farHole)).toBe(false)
  })

  it('rejects a diagonal cylinder that exits adjacent faces', () => {
    const cheese = { ...shape('box', 'cheese'), position: { x: 0, y: 1.8, z: 0 }, scale: { x: 5.5, y: 3.6, z: 3.2 } }
    const diagonal = {
      ...shape('cylinder', 'diagonal'),
      position: { x: 0, y: 3.3, z: 0 },
      rotation: { x: 0, y: 0, z: -Math.PI / 4 },
      scale: { x: 0.4, y: 8, z: 0.4 },
    }
    expect(holePassesThroughBase(cheese, diagonal)).toBe(false)
  })

  it('does not count overlapping cylinders as separate tunnels', () => {
    const tunnel = { ...shape('cylinder', 'a'), rotation: { x: 0, y: 0, z: Math.PI / 2 } }
    expect(tunnelsAreDistinct([tunnel, { ...tunnel, id: 'b' }, { ...tunnel, id: 'c' }])).toBe(false)
  })

  it('does not count collinear cylinders as separate tunnels', () => {
    const tunnel = {
      ...shape('cylinder', 'a'),
      rotation: { x: 0, y: 0, z: Math.PI / 2 },
      scale: { x: 0.75, y: 10, z: 0.75 },
    }
    const shiftedAlongItsAxis = { ...tunnel, id: 'b', position: { x: 3, y: 1, z: 0 } }
    expect(tunnelsAreDistinct([tunnel, shiftedAlongItsAxis])).toBe(false)
  })

  it('requires the robot to remain fully grouped', () => {
    const shapes = Array.from({ length: 6 }, (_, index) => ({ ...shape('box', `part-${index}`), grouped: index < 5 }))
    const result = evaluateQuest(3, shapes, [{ type: 'duplicate' }, { type: 'group' }])
    expect(result.find((task) => task.taskId === 'group')?.complete).toBe(false)
  })
})

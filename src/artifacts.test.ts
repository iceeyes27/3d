import { describe, expect, it } from 'vitest'
import { createProjectArchive } from './artifacts'
import { quests } from './course'
import type { QuestProject } from './types'

describe('project artifact', () => {
  it('keeps the editable model and summarizes the learning process', () => {
    const project: QuestProject = {
      shapes: [
        {
          id: 'part-1',
          name: '方块',
          type: 'box',
          color: '#ff9b56',
          position: { x: 0, y: 0.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
      operations: [
        { type: 'move', shapeId: 'part-1', at: 1 },
        { type: 'move', shapeId: 'part-1', at: 2 },
        { type: 'scale', shapeId: 'part-1', at: 3 },
      ],
      updatedAt: 3,
    }

    const archive = createProjectArchive(quests[0], project)
    expect(archive).toMatchObject({
      format: 'maker-island-project',
      version: 2,
      quest: { id: 1 },
      project,
      process: [
        { action: '移动', count: 2 },
        { action: '改变大小', count: 1 },
      ],
    })
  })
})

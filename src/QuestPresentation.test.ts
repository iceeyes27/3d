import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createQuestBackdrop, createModelGroupForExport, disposeModelObject } from './ModelViewport'
import { QuestPresentation } from './QuestPresentation'
import type { ModelShape } from './types'

const part = (id: string, type: ModelShape['type']): ModelShape => ({
  id, type, name: id, color: '#56bb85',
  position: { x: 0, y: 1, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
})

afterEach(cleanup)

describe('quest presentation', () => {
  it('shows repair lights from checked results, not operation history or celebration alone', () => {
    const { rerender } = render(createElement(QuestPresentation, {
      questId: 10, celebrating: true,
      evaluations: [
        { taskId: 'fix-thin', complete: true },
        { taskId: 'fix-floating', complete: false },
        { taskId: 'print-ready', complete: false },
      ],
    }))
    expect(screen.getAllByText('通过')).toHaveLength(1)
    expect(screen.getAllByText('待修')).toHaveLength(2)
    expect(screen.queryByText('三盏绿灯亮了！转动视角，看看你修好的作品。')).toBeNull()
    rerender(createElement(QuestPresentation, {
      questId: 10, celebrating: true,
      evaluations: ['fix-thin', 'fix-floating', 'print-ready'].map((taskId) => ({ taskId, complete: true })),
    }))
    expect(screen.getAllByText('通过')).toHaveLength(3)
    expect(screen.getByText('三盏绿灯亮了！转动视角，看看你修好的作品。')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps the independent candle challenge separate from the snowman assembly', () => {
    render(createElement(QuestPresentation, { questId: 1, celebrating: true, practice: true, evaluations: [] }))
    expect(screen.getByText('新谜面也解开了！看看你找到的小蜡烛。')).toBeTruthy()
    const backdrop = createQuestBackdrop(1, [part('practice-candle', 'cylinder')], true)
    expect(backdrop.children).toHaveLength(0)
    disposeModelObject(backdrop)
  })

  it('shows support and connection independently, even when the combined check differs', () => {
    render(createElement(QuestPresentation, {
      questId: 10, celebrating: false,
      evaluations: ['fix-thin', 'fix-floating', 'print-ready'].map((taskId) => ({ taskId, complete: true })),
      printChecks: { thickness: true, support: true, connection: false },
    }))
    expect(screen.getByText('零件有支撑').closest('li')?.textContent).toContain('通过')
    expect(screen.getByText('零件相连').closest('li')?.textContent).toContain('待修')
    expect(screen.getAllByText('通过')).toHaveLength(2)
    expect(screen.queryByText('完整体检')).toBeNull()
  })

  it('does not turn off support or connection when only thickness needs repair', () => {
    render(createElement(QuestPresentation, {
      questId: 10, celebrating: true,
      evaluations: ['fix-thin', 'fix-floating', 'print-ready'].map((taskId) => ({ taskId, complete: false })),
      printChecks: { thickness: false, support: true, connection: true },
    }))
    expect(screen.getByText('厚度安全').closest('li')?.textContent).toContain('待修')
    expect(screen.getByText('零件有支撑').closest('li')?.textContent).toContain('通过')
    expect(screen.getByText('零件相连').closest('li')?.textContent).toContain('通过')
    expect(screen.queryByText('三盏绿灯亮了！转动视角，看看你修好的作品。')).toBeNull()
  })

  it('does not add a card to unrelated quests', () => {
    const { container } = render(createElement(QuestPresentation, { questId: 2, celebrating: false, evaluations: [] }))
    expect(container.children).toHaveLength(0)
  })

  it('lights the story house only on success without editing or exporting it', () => {
    const shapes = [part('roof', 'cone')]
    const snapshot = JSON.stringify(shapes)
    const waiting = createQuestBackdrop(4, shapes, false)
    const success = createQuestBackdrop(4, shapes, true)
    const before = waiting.getObjectByName('story-house-window-front') as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
    const after = success.getObjectByName('story-house-window-front') as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
    expect(before.material.emissiveIntensity).toBe(0)
    expect(after.material.emissiveIntensity).toBeGreaterThan(0)
    success.traverse((object) => expect(object.userData.shapeId).toBeUndefined())
    expect(JSON.stringify(shapes)).toBe(snapshot)
    const exported = createModelGroupForExport(shapes)
    expect(exported.children).toHaveLength(1)
    expect(exported.getObjectByName('story-house-walls')).toBeUndefined()
    ;[waiting, success, exported].forEach(disposeModelObject)
  })

  it('decorates only the named story pieces and leaves their source untouched', () => {
    const shapes = [part('snow-head', 'sphere'), part('icecream-scoop', 'sphere'), part('detective-cup', 'cylinder')]
    const snapshot = JSON.stringify(shapes)
    const backdrop = createQuestBackdrop(1, shapes, true)
    expect(backdrop.children.map((child) => child.name)).toEqual(['story-snowman-face', 'story-cup-handle'])
    expect(JSON.stringify(shapes)).toBe(snapshot)
    backdrop.traverse((object) => expect(object.userData.shapeId).toBeUndefined())
    disposeModelObject(backdrop)
  })
})

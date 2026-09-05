import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  downloadProcessReport,
  downloadProjectArchive,
  downloadStl,
  downloadViewportImage,
} from './artifacts'
import { evaluateQuest, holePassesThroughBase, tunnelsAreDistinct } from './course'
import { ModelViewport } from './ModelViewport'
import { ProfileBadge } from './ProfileBadge'
import type { CloudSaveState } from './cloudWriter'
import type {
  ModelShape,
  OperationRecord,
  OperationType,
  PrimitiveType,
  ProgressBadge,
  Quest,
  QuestPractice,
  QuestProject,
  TransformMode,
  Vector3Value,
} from './types'

interface StudioProps {
  quest: Quest
  savedProject?: QuestProject
  totalStars: number
  storageHealthy: boolean
  saveState: CloudSaveState
  username: string
  onSwitchProfile: () => void
  onBack: () => void
  onProjectChange: (questId: number, project: QuestProject) => void
  onComplete: (
    questId: number,
    stars: number,
    project: QuestProject,
    badges: ProgressBadge[],
    practiceId?: string,
  ) => void
}

const defaultPracticeByQuest: Record<number, QuestPractice> = {
  1: { id: 'q1-shape-variation', title: '变式小挑战：甜筒帽', instruction: '再加入一个圆锥，认出它和球体的不同。', tools: ['cone'], operationTypes: ['add'] },
  2: { id: 'q2-move-variation', title: '变式小挑战：轻轻挪一步', instruction: '把方块向任意方向再移动一小格。', tools: ['move'], operationTypes: ['move'] },
  3: { id: 'q3-scale-variation', title: '变式小挑战：大小对比', instruction: '把零件再变大或变小一次，观察轮廓变化。', tools: ['scale'], operationTypes: ['scale'] },
  4: { id: 'q4-rotate-variation', title: '变式小挑战：换个角度', instruction: '再旋转一次屋顶，看看角度怎样改变。', tools: ['rotate'], operationTypes: ['rotate'] },
  5: { id: 'q5-align-variation', title: '变式小挑战：重新排齐', instruction: '再使用一次对齐工具，确认共同基准。', tools: ['align'], operationTypes: ['align'] },
  6: { id: 'q6-size-variation', title: '变式小挑战：改一毫米', instruction: '把任意一个尺寸改动一次，感受精确数字。', tools: ['size-input'], operationTypes: ['scale'] },
  7: { id: 'q7-copy-variation', title: '变式小挑战：再复制一个', instruction: '再复制一个零件，观察复制品是否完全相同。', tools: ['duplicate'], operationTypes: ['duplicate'] },
  8: { id: 'q8-hole-variation', title: '变式小挑战：试一个洞', instruction: '加入一个圆柱，再把它切换成空洞。', tools: ['cylinder', 'hole'], operationTypes: ['hole'] },
  9: { id: 'q9-wall-variation', title: '变式小挑战：比较壁厚', instruction: '调整一次内芯大小，观察壁厚怎样变化。', tools: ['scale'], operationTypes: ['scale'] },
  10: { id: 'q10-check-variation', title: '变式小挑战：再次体检', instruction: '选择一个零件，再使用一次“稳稳落地”复查支撑。', tools: ['align'], operationTypes: ['align'] },
  11: { id: 'q11-brief-variation', title: '变式小挑战：复述计划', instruction: '再次确认三步计划，再按计划检查作品。', tools: ['plan'], operationTypes: ['plan'] },
  12: { id: 'q12-capstone-variation', title: '最后的小改进', instruction: '选择一个零件完成一次有理由的修改。', tools: ['move', 'scale', 'rotate'], operationTypes: ['move', 'scale', 'rotate'] },
}

const primitiveInfo: Record<PrimitiveType, { label: string; icon: string; color: string }> = {
  box: { label: '方块', icon: '■', color: '#ff9b56' },
  sphere: { label: '球体', icon: '●', color: '#60b8ff' },
  cylinder: { label: '圆柱', icon: '⬮', color: '#9b7cf6' },
  cone: { label: '圆锥', icon: '▲', color: '#f36e79' },
}

const cloneProject = (project: QuestProject): QuestProject => structuredClone(project)

const newId = (type: PrimitiveType) =>
  `${type}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`

function makeShape(type: PrimitiveType, count: number): ModelShape {
  const info = primitiveInfo[type]
  const lane = count % 5
  return {
    id: newId(type),
    name: `${info.label} ${count + 1}`,
    type,
    color: info.color,
    position: { x: (lane - 2) * 1.15, y: 0.75, z: Math.floor(count / 5) * 1.1 - 0.7 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1.4, y: 1.4, z: 1.4 },
  }
}

function initialProject(quest: Quest, savedProject?: QuestProject): QuestProject {
  if (savedProject?.courseVersion === 2) return cloneProject(savedProject)
  const now = Date.now()
  return {
    courseVersion: 2,
    shapes: structuredClone(quest.starterShapes ?? []),
    operations: [],
    updatedAt: now,
    startedAt: now,
  }
}

function shapeVolume(shape: ModelShape) {
  return Math.abs(shape.scale.x * shape.scale.y * shape.scale.z)
}

function operation(type: OperationType, shapeId?: string): OperationRecord {
  return { type, shapeId, at: Date.now() }
}

function updateVector(value: Vector3Value, axis: keyof Vector3Value, amount: number): Vector3Value {
  return { ...value, [axis]: value[axis] + amount }
}

function shapeMatrix(shape: ModelShape) {
  const position = new THREE.Vector3(shape.position.x, shape.position.y, shape.position.z)
  const rotation = new THREE.Euler(shape.rotation.x, shape.rotation.y, shape.rotation.z, 'XYZ')
  const scale = new THREE.Vector3(shape.scale.x, shape.scale.y, shape.scale.z)
  return new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale)
}

function keepNestedHolesWithBase(source: ModelShape, updated: ModelShape): ModelShape {
  if (!source.holes?.length) return updated
  const inverseOldBase = shapeMatrix(source).invert()
  const newBase = shapeMatrix(updated)
  return {
    ...updated,
    holes: source.holes.map((hole) => {
      const nextWorld = newBase.clone().multiply(inverseOldBase.clone().multiply(shapeMatrix(hole)))
      const position = new THREE.Vector3()
      const quaternion = new THREE.Quaternion()
      const scale = new THREE.Vector3()
      nextWorld.decompose(position, quaternion, scale)
      const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ')
      return {
        ...hole,
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
        scale: { x: Math.abs(scale.x), y: Math.abs(scale.y), z: Math.abs(scale.z) },
      }
    }),
  }
}

export function Studio({ quest, savedProject, totalStars, storageHealthy, saveState, username, onSwitchProfile, onBack, onProjectChange, onComplete }: StudioProps) {
  const [project, setProject] = useState<QuestProject>(() => initialProject(quest, savedProject))
  const [selectedId, setSelectedId] = useState<string | null>(() => project.shapes[0]?.id ?? null)
  const [mode, setMode] = useState<TransformMode>('translate')
  const [undoStack, setUndoStack] = useState<QuestProject[]>([])
  const [redoStack, setRedoStack] = useState<QuestProject[]>([])
  const [status, setStatus] = useState('选中一个形状，就可以开始动手。')
  const [showSuccess, setShowSuccess] = useState(false)
  const [hintLevel, setHintLevel] = useState(0)
  const [usedHint, setUsedHint] = useState(false)
  const [failedCheckCount, setFailedCheckCount] = useState(0)
  const [resetViewSignal, setResetViewSignal] = useState(0)
  const [viewGuideStep, setViewGuideStep] = useState(() => quest.id === 1 ? 1 : 0)
  const [passedProject, setPassedProject] = useState<QuestProject | null>(null)
  const [practiceActive, setPracticeActive] = useState(false)
  const [practiceOperationStart, setPracticeOperationStart] = useState(0)
  const [timerVisible, setTimerVisible] = useState(() => quest.id >= 11)
  const [clock, setClock] = useState(Date.now())
  const [showDemo, setShowDemo] = useState(() => savedProject?.courseVersion !== 2)
  const successModalRef = useRef<HTMLElement>(null)
  const successInitialFocusRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    onProjectChange(quest.id, (practiceActive || showSuccess) && passedProject ? passedProject : project)
  }, [onProjectChange, passedProject, practiceActive, project, quest.id, showSuccess])

  useEffect(() => {
    if (quest.id < 11) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [quest.id])

  useEffect(() => {
    if (!showDemo) return
    const timer = window.setTimeout(() => setShowDemo(false), 6000)
    return () => window.clearTimeout(timer)
  }, [showDemo])

  useEffect(() => {
    if (!showSuccess) return
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    successInitialFocusRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (passedProject) {
          const restored = cloneProject(passedProject)
          setProject(restored)
          setSelectedId(restored.shapes[0]?.id ?? null)
          setPassedProject(null)
          setPracticeActive(false)
          setStatus('已回到通过检查的作品，可以继续修改；修改后请重新检查。')
        }
        setShowSuccess(false)
        return
      }
      if (event.key !== 'Tab') return
      const modal = successModalRef.current
      if (!modal) return
      const controls = Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
      if (controls.length === 0) return
      const first = controls[0]
      const last = controls.at(-1) ?? first
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [passedProject, showSuccess])

  const selected = project.shapes.find((shape) => shape.id === selectedId) ?? null
  const evaluations = useMemo(
    () => evaluateQuest(quest.id, project.shapes, project.operations),
    [project.operations, project.shapes, quest.id],
  )
  const completeTaskIds = new Set(evaluations.filter((item) => item.complete).map((item) => item.taskId))
  const coreComplete = evaluations.length > 0 && evaluations.every((item) => item.complete)
  const practice = quest.practice ?? defaultPracticeByQuest[quest.id]
  const currentTask = practiceActive ? undefined : quest.tasks.find((task) => !completeTaskIds.has(task.id))
  const currentStep = currentTask
    ? quest.steps.find((step) => step.id === currentTask.id || step.taskId === currentTask.id)
    : undefined
  const plannedTools = practiceActive ? practice?.tools : currentStep?.tools
  const activeTools = new Set(
    plannedTools?.length
      ? plannedTools
      : currentTask
        ? [...quest.palette, ...quest.allowedTools]
        : [],
  )
  const targetShapes = practiceActive ? [] : quest.targetShapes
  const dataHints = currentStep?.hints?.length ? currentStep.hints : quest.hints
  const hints = [
    dataHints?.[0] ?? '先看看目标和现在的作品，找出它们最明显的不同。',
    dataHints?.[1] ?? quest.tip,
    dataHints?.[2] ?? '看着淡蓝目标轮廓，使用右边亮起的工具完成这一步。',
  ]
  const badgeResults: Array<{ id: ProgressBadge; icon: string; name: string; detail: string; earned: boolean }> = [
    { id: 'completion', icon: '✓', name: '完成徽章', detail: '最终作品通过全部检查', earned: Boolean(passedProject) || coreComplete },
    { id: 'accuracy', icon: '◎', name: '精准徽章', detail: '第一次检查就全部通过', earned: (Boolean(passedProject) || coreComplete) && failedCheckCount === 0 },
    { id: 'independence', icon: '★', name: '独立徽章', detail: '没有打开提示完成作品', earned: (Boolean(passedProject) || coreComplete) && !usedHint },
  ]
  const earnedBadges = badgeResults.filter((badge) => badge.earned).map((badge) => badge.id)
  const elapsedSeconds = Math.max(0, Math.round((clock - (project.startedAt ?? project.updatedAt)) / 1000))
  const currentElapsedSeconds = () => Math.max(0, Math.round((Date.now() - (project.startedAt ?? project.updatedAt)) / 1000))
  const formattedTime = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`

  useEffect(() => {
    if (!practiceActive || !practice) return
    const completed = project.operations.slice(practiceOperationStart).some((item) => practice.operationTypes.includes(item.type))
    if (!completed) return
    setPracticeActive(false)
    setShowSuccess(true)
    setStatus('变式小挑战完成！现在领取你的能力徽章。')
  }, [practice, practiceActive, practiceOperationStart, project.operations])

  useEffect(() => {
    setHintLevel(0)
    if (activeTools.has('move')) setMode('translate')
    else if (activeTools.has('rotate')) setMode('rotate')
    else if (activeTools.has('scale')) setMode('scale')
  }, [currentTask?.id])

  const moveDirections: ReadonlyArray<{ axis: keyof Vector3Value; amount: number; label: string }> = quest.id >= 6
    ? [
        { axis: 'x', amount: -0.5, label: 'X−' }, { axis: 'x', amount: 0.5, label: 'X＋' },
        { axis: 'y', amount: -0.5, label: 'Y−' }, { axis: 'y', amount: 0.5, label: 'Y＋' },
        { axis: 'z', amount: -0.5, label: 'Z−' }, { axis: 'z', amount: 0.5, label: 'Z＋' },
      ]
    : [
        { axis: 'x', amount: -0.5, label: '向左' }, { axis: 'x', amount: 0.5, label: '向右' },
        { axis: 'y', amount: 0.5, label: '向上' }, { axis: 'y', amount: -0.5, label: '向下' },
        { axis: 'z', amount: -0.5, label: '向前' }, { axis: 'z', amount: 0.5, label: '向后' },
      ]

  const commit = (shapes: ModelShape[], nextOperation?: OperationRecord, message?: string) => {
    setUndoStack((stack) => [...stack.slice(-29), cloneProject(project)])
    setRedoStack([])
    setProject({
      shapes,
      operations: (nextOperation ? [...project.operations, nextOperation] : project.operations).slice(-1000),
      updatedAt: Date.now(),
      startedAt: project.startedAt ?? Date.now(),
      ...(project.elapsedSeconds === undefined ? {} : { elapsedSeconds: project.elapsedSeconds }),
    })
    if (message) setStatus(message)
  }

  const updateSelected = (
    updater: (shape: ModelShape) => ModelShape,
    operationType?: OperationType,
    message?: string,
  ) => {
    if (!selectedId) return
    const shapes = project.shapes.map((shape) => {
      if (shape.id !== selectedId) return shape
      const updated = keepNestedHolesWithBase(shape, updater(shape))
      return quest.id === 7 && shape.grouped && operationType ? { ...updated, grouped: false } : updated
    })
    commit(shapes, operationType ? operation(operationType, selectedId) : undefined, message)
  }

  const addShape = (type: PrimitiveType) => {
    const shape = makeShape(type, project.shapes.length)
    if (quest.id === 8 && type === 'cylinder') {
      const tunnelCount = project.shapes.reduce(
        (count, current) => count
          + Number(current.type === 'cylinder')
          + (current.holes?.filter((hole) => hole.type === 'cylinder').length ?? 0),
        0,
      )
      const tunnelPositions = [-0.8, 0, 0.8, -1.2, 1.2]
      shape.name = '隧道'
      shape.color = '#71d6e8'
      shape.position = { x: 0, y: 0.9, z: tunnelPositions[tunnelCount % tunnelPositions.length] }
      shape.scale = { x: 0.75, y: 6, z: 0.75 }
    }
    commit([...project.shapes, shape], operation('add', shape.id), `${primitiveInfo[type].label}已经来到工作台。`)
    setSelectedId(shape.id)
  }

  const duplicateSelected = () => {
    if (!selected) return
    let copy = structuredClone(selected)
    copy.id = newId(copy.type)
    copy.name = `${selected.name} 的复制品`
    if (copy.isHole) copy.position.z += 0.8
    else copy.position.x += 1.5
    copy.grouped = false
    copy = keepNestedHolesWithBase(selected, copy)
    copy.holes = copy.holes?.map((hole) => ({ ...hole, id: newId(hole.type) }))
    commit([...project.shapes, copy], operation('duplicate', copy.id), '复制成功！现在可以把两个零件放到不同位置。')
    setSelectedId(copy.id)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    if (!window.confirm(`要移走“${selected?.name ?? '这个零件'}”吗？移走后可以立即点击撤销。`)) return
    const removedWasGrouped = project.shapes.find((shape) => shape.id === selectedId)?.grouped
    const next = project.shapes
      .filter((shape) => shape.id !== selectedId)
      .map((shape) => quest.id === 7 && removedWasGrouped ? { ...shape, grouped: false } : shape)
    commit(next, undefined, '形状已移走，需要时可以点击撤销。')
    setSelectedId(next[0]?.id ?? null)
  }

  const toggleHole = () => {
    if (!selected || quest.id < 4 || selected.type !== 'cylinder') return
    updateSelected(
      (shape) => ({ ...shape, isHole: !shape.isHole }),
      'hole',
      selected.isHole ? '它又变回实体了。' : '它已经变成半透明的洞，让它穿过要挖空的物体。',
    )
  }

  const alignToGround = () => {
    if (quest.id === 8 && selected?.type === 'cylinder') return
    updateSelected(
      (shape) => ({ ...shape, position: { ...shape.position, y: Math.max(0.1, shape.scale.y / 2) } }),
      'align',
      '已经稳稳地落到地面上。',
    )
  }

  const setExactDimension = (axis: keyof Vector3Value, rawValue: string) => {
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value < 0.1 || value > 100) {
      setStatus('请输入 0.1 到 100 毫米之间的尺寸。')
      return
    }
    updateSelected(
      (shape) => ({ ...shape, scale: { ...shape.scale, [axis]: value } }),
      'scale',
      `${axis.toUpperCase()} 尺寸已设为 ${value} 毫米。`,
    )
  }

  const confirmPlan = () => {
    commit(project.shapes, operation('plan'), '三步计划已记录：先读要求，再搭主体，最后检查修改。')
  }

  const groupScene = () => {
    const holes = project.shapes.filter((shape) => shape.isHole)
    const solids = project.shapes.filter((shape) => !shape.isHole)
    if (holes.length > 0) {
      if (solids.length === 0) {
        setStatus('还需要一个实体，洞才能从它里面减掉。')
        return
      }
      const base = quest.id === 8
        ? solids.find((shape) => shape.id === 'cheese')
        : [...solids].sort((a, b) => shapeVolume(b) - shapeVolume(a))[0]
      if (!base) {
        setStatus('没有找到要挖空的奶酪，点击重新开始可以恢复它。')
        return
      }
      if (quest.id === 8 && (holes.length < 3 || holes.some((hole) => !holePassesThroughBase(base, hole)))) {
        setStatus('隧道还没有从奶酪的一边穿到另一边。把圆柱转横、放进奶酪中间，再试一次。')
        return
      }
      if (quest.id === 8 && !tunnelsAreDistinct([...(base.holes ?? []), ...holes])) {
        setStatus('有些隧道重叠在一起了。把它们移开一点，让奶酪上出现三个不同的洞。')
        return
      }
      const next = solids.map((shape) =>
        shape.id === base.id
          ? { ...shape, grouped: true, holes: [...(shape.holes ?? []), ...holes.map((hole) => ({ ...hole, isHole: false }))] }
          : shape,
      )
      commit(next, operation('group', base.id), quest.id === 9
        ? '笔筒挖孔完成，系统会检查开口、壁厚和封底。'
        : `组合完成：${holes.length} 个洞已经从奶酪中减掉。`)
      setSelectedId(base.id)
      return
    }

    if (project.shapes.length < 2) {
      setStatus('至少需要两个形状才能组合。')
      return
    }
    commit(project.shapes.map((shape) => ({ ...shape, grouped: true })), operation('group'), '组合完成，所有零件现在属于同一个作品。')
  }

  const onTransformEnd = (changed: ModelShape, type: 'move' | 'rotate' | 'scale') => {
    const shapes = project.shapes.map((shape) => (
      shape.id === changed.id
        ? quest.id === 7 && shape.grouped ? { ...changed, grouped: false } : changed
        : shape
    ))
    commit(shapes, operation(type, changed.id), type === 'move' ? '位置调整好了。' : type === 'rotate' ? '旋转完成。' : '大小调整好了。')
  }

  const nudgePosition = (axis: keyof Vector3Value, amount: number) => {
    updateSelected(
      (shape) => ({ ...shape, position: updateVector(shape.position, axis, amount) }),
      'move',
      '轻轻移动了一格。',
    )
  }

  const changeScale = (amount: number) => {
    updateSelected(
      (shape) => ({
        ...shape,
        scale: {
          x: Math.max(0.25, shape.scale.x + amount),
          y: Math.max(0.25, shape.scale.y + amount),
          z: Math.max(0.25, shape.scale.z + amount),
        },
      }),
      'scale',
      amount > 0 ? '变大了一点。' : '变小了一点。',
    )
  }

  const rotateSelected = () => {
    updateSelected(
      (shape) => shape.type === 'cylinder'
        ? { ...shape, rotation: { ...shape.rotation, z: shape.rotation.z + Math.PI / 2 } }
        : shape.type === 'cone'
          ? { ...shape, rotation: { ...shape.rotation, z: shape.rotation.z + Math.PI / 6 } }
          : { ...shape, rotation: { ...shape.rotation, y: shape.rotation.y + Math.PI / 6 } },
      'rotate',
      selected?.type === 'cylinder' ? '圆柱转了 90°，现在可以成为横向隧道。' : '向右旋转了 30°。',
    )
  }

  const changeColor = (color: string) => {
    updateSelected((shape) => ({ ...shape, color }), undefined, '换上新颜色了。')
  }

  const undo = () => {
    const previous = undoStack.at(-1)
    if (!previous) return
    setRedoStack((stack) => [...stack, cloneProject(project)])
    setUndoStack((stack) => stack.slice(0, -1))
    setProject(cloneProject(previous))
    setSelectedId(previous.shapes[0]?.id ?? null)
    setStatus('已经撤销上一步。')
  }

  const redo = () => {
    const next = redoStack.at(-1)
    if (!next) return
    setUndoStack((stack) => [...stack, cloneProject(project)])
    setRedoStack((stack) => stack.slice(0, -1))
    setProject(cloneProject(next))
    setSelectedId(next.shapes[0]?.id ?? null)
    setStatus('已经重做这一步。')
  }

  const resetQuest = () => {
    if (!window.confirm('重新开始会清空这一关当前的作品，确定吗？')) return
    const fresh = initialProject(quest)
    setUndoStack([])
    setRedoStack([])
    setProject(fresh)
    setSelectedId(fresh.shapes[0]?.id ?? null)
    setHintLevel(0)
    setUsedHint(false)
    setFailedCheckCount(0)
    setPassedProject(null)
    setPracticeActive(false)
    setPracticeOperationStart(0)
    setStatus('工作台已经整理干净，可以重新开始了。')
  }

  const checkWork = () => {
    if (practiceActive) {
      setStatus('先完成上方写着的变式小挑战，完成后会自动发放徽章。')
      return
    }
    if (coreComplete) {
      const completedProject = {
        ...cloneProject(project),
        elapsedSeconds: Math.max(project.elapsedSeconds ?? 0, currentElapsedSeconds()),
      }
      setPassedProject(completedProject)
      if (practice) {
        setPracticeOperationStart(project.operations.length)
        setPracticeActive(true)
        setHintLevel(0)
        setStatus('主任务通过！再完成一个同本领的小挑战。')
      } else {
        setShowSuccess(true)
      }
      return
    }
    setFailedCheckCount((count) => count + 1)
    const firstMissingEvaluation = evaluations.find((item) => !item.complete) as (typeof evaluations[number] & { feedback?: string }) | undefined
    const firstMissing = quest.tasks.find((task) => task.id === firstMissingEvaluation?.taskId)
      ?? quest.tasks.find((task) => !completeTaskIds.has(task.id))
    setStatus(firstMissingEvaluation?.feedback ?? (firstMissing ? `下一步：${firstMissing.label}` : '再检查一下任务要求。'))
  }

  const claimReward = () => {
    const completedProject = passedProject ?? (coreComplete ? project : null)
    if (!completedProject) {
      setShowSuccess(false)
      setStatus('作品刚刚发生了变化，请再检查一次任务。')
      return
    }
    const savedCompletion = {
      ...completedProject,
      elapsedSeconds: Math.max(completedProject.elapsedSeconds ?? 0, currentElapsedSeconds()),
      updatedAt: Date.now(),
    }
    onComplete(quest.id, Math.max(1, earnedBadges.length), savedCompletion, earnedBadges, practice?.id)
    setShowSuccess(false)
    onBack()
  }

  const continueEditing = () => {
    if (passedProject) {
      const restored = cloneProject(passedProject)
      setProject(restored)
      setSelectedId(restored.shapes[0]?.id ?? null)
    }
    setPassedProject(null)
    setPracticeActive(false)
    setShowSuccess(false)
    setStatus('已回到通过检查的作品，可以继续修改；修改后请重新检查。')
  }

  const revealHint = () => {
    setUsedHint(true)
    setHintLevel((level) => Math.min(3, level + 1))
  }

  const runExport = async (action: () => void | Promise<void>, successMessage: string) => {
    try {
      await action()
      setStatus(successMessage)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '导出失败，请稍后再试。')
    }
  }

  const speakCurrentTask = () => {
    if (!('speechSynthesis' in window)) {
      setStatus('这台设备暂时不能朗读。')
      return
    }
    window.speechSynthesis.cancel()
    const text = practiceActive
      ? practice?.instruction ?? '请完成变式小挑战。'
      : currentStep?.instruction ?? currentTask?.label ?? '本关任务已经全部完成。'
    const speech = new SpeechSynthesisUtterance(text)
    speech.lang = 'zh-CN'
    speech.rate = 0.9
    window.speechSynthesis.speak(speech)
  }

  return (
    <div className="studio-page">
      <header className="studio-topbar" inert={showSuccess ? true : undefined} aria-hidden={showSuccess || undefined}>
        <button className="back-button" type="button" onClick={onBack}>← 返回地图</button>
        <div className="studio-title"><span>{quest.icon}</span><div><small>第 {quest.id} 关</small><strong>{quest.title}</strong></div></div>
        <div className="studio-head-status">
          <ProfileBadge name={username} onSwitch={onSwitchProfile} />
          {quest.id >= 11 && timerVisible && <span className="gentle-timer" aria-label={`已经用时 ${formattedTime}`}>⏱ {formattedTime}<button type="button" onClick={() => setTimerVisible(false)} aria-label="隐藏计时">×</button></span>}
          <span className={`work-state ${passedProject ? 'finished' : ''}`}>{passedProject ? '通关作品' : coreComplete ? '待检查草稿' : '草稿'}</span>
          <span className="studio-score">⭐ {totalStars}</span>
        </div>
      </header>

      <main className="studio-layout" inert={showSuccess ? true : undefined} aria-hidden={showSuccess || undefined}>
        <aside className="mission-panel">
          <div className="mission-progress"><span>{practiceActive ? '小挑战' : `${completeTaskIds.size} / ${quest.tasks.length}`}</span><div><i style={{ width: `${practiceActive || passedProject ? 100 : quest.tasks.length ? (completeTaskIds.size / quest.tasks.length) * 100 : 0}%` }} /></div></div>
          <div className="mission-kicker"><p className="eyebrow">{practiceActive ? '同本领变式挑战' : coreComplete ? '可以检查作品' : '现在只做这一步'}</p><button type="button" onClick={speakCurrentTask} aria-label="朗读当前任务">🔊 朗读</button></div>
          <h1>{practiceActive ? practice?.title : currentStep?.title ?? currentTask?.label ?? '作品已经完成'}</h1>
          <p className="mission-story">{practiceActive ? practice?.instruction : currentStep?.instruction ?? (coreComplete ? '所有要求都已满足，点击检查后进入小挑战。' : quest.story)}</p>
          <div className="learn-one"><strong>这一关的主目标</strong><span>{quest.objective}</span></div>
          {currentTask && !practiceActive && (
            <section className="hint-ladder" aria-label="三级提示">
              <div className="hint-dots" aria-label={`已打开 ${hintLevel} 级提示`}><i className={hintLevel >= 1 ? 'on' : ''} /><i className={hintLevel >= 2 ? 'on' : ''} /><i className={hintLevel >= 3 ? 'on' : ''} /></div>
              {hintLevel > 0 && <p><strong>第 {hintLevel} 级提示</strong>{hints[hintLevel - 1]}</p>}
              {hintLevel < 3 && <button type="button" onClick={revealHint}>{hintLevel === 0 ? '我需要一点提示' : '再给我一点提示'}</button>}
            </section>
          )}
          <button className={`check-button ${coreComplete ? 'ready' : ''}`} type="button" onClick={checkWork}>
            {practiceActive ? '完成动作后自动通过' : coreComplete ? '检查最终作品' : '检查这一步'}
          </button>
        </aside>

        <section className="workbench" aria-label="3D 建模工作台">
          <div className="studio-toolbar" aria-label="安全和历史工具">
            <div className="tool-group history-tools">
              <button type="button" onClick={undo} disabled={undoStack.length === 0}>↶ 撤销</button>
              <button type="button" onClick={redo} disabled={redoStack.length === 0}>↷ 重做</button>
              <button type="button" onClick={() => setResetViewSignal((signal) => signal + 1)}>⌖ 复位视角</button>
            </div>
            <div className="tool-group safety-tools">
              <button type="button" onClick={deleteSelected} disabled={!selected} className="delete-safe">移走选中零件</button>
              <button type="button" onClick={resetQuest} className="quiet-danger">重新开始</button>
            </div>
          </div>

          <div className="viewport-wrap">
            <ModelViewport
              shapes={project.shapes}
              targetShapes={targetShapes}
              selectedId={selectedId}
              mode={mode}
              transformEnabled={activeTools.has('move') || activeTools.has('scale')}
              resetViewSignal={resetViewSignal}
              onSelect={setSelectedId}
              onTransformEnd={onTransformEnd}
            />
            {targetShapes.length > 0 && <div className="target-key"><i />淡蓝轮廓是本关目标</div>}
            <div className="view-help">拖动空白处看四周 · 点形状选中</div>
            {showDemo && <section className="quest-demo" aria-label="本关动态演示"><button type="button" onClick={() => setShowDemo(false)}>跳过演示</button><div className="demo-object" aria-hidden="true">{quest.icon}</div><strong>{quest.objective}</strong><p>看清淡蓝目标，再使用右边亮起的工具。</p><i /></section>}
            {!practiceActive && hintLevel >= 3 && <div className="action-ghost" aria-label="半透明动作示范"><span aria-hidden="true">☝</span><p>{hints[2]}</p></div>}
            {!showDemo && viewGuideStep > 0 && <section className="view-guide" aria-label="视角小练习"><button className="guide-skip" type="button" onClick={() => setViewGuideStep(0)}>跳过</button><span aria-hidden="true">{viewGuideStep === 1 ? '👆' : '⌖'}</span><strong>{viewGuideStep === 1 ? '先学会看四周' : '再回到最好看的角度'}</strong><p>{viewGuideStep === 1 ? '按住画布空白处拖一拖，看看模型的另一面。' : '点一下“复位视角”，画布会回到初始位置。'}</p><button className="guide-next" type="button" onClick={() => { if (viewGuideStep === 1) setViewGuideStep(2); else { setResetViewSignal((signal) => signal + 1); setViewGuideStep(0) } }}>{viewGuideStep === 1 ? '我试过了' : '复位视角并开始'}</button></section>}
          </div>
          <div className="studio-status" role="status"><span aria-hidden="true">🐼</span>{status}<span className={`autosave ${storageHealthy || saveState === 'saving' ? '' : 'save-error'}`}>{saveState === 'saving' ? '正在同步…' : saveState === 'pending' ? '已存本机，等待同步' : storageHealthy ? '已同步到云端' : saveState === 'conflict' ? '请处理进度冲突' : '暂时无法保存'}</span></div>
        </section>

        <aside className={`tools-panel ${!practiceActive && hintLevel >= 2 ? 'hint-highlight' : ''}`}>
          <section className="step-tools">
            <p className="panel-label">这一步需要的工具</p>
            <div className="step-tool-grid">
              {quest.palette.filter((type) => activeTools.has(type)).map((type) => (
                <button key={type} type="button" onClick={() => addShape(type)}>
                  <span style={{ color: primitiveInfo[type].color }}>{primitiveInfo[type].icon}</span>加入{primitiveInfo[type].label}
                </button>
              ))}
              {activeTools.has('move') && activeTools.size > 1 && <button type="button" className={mode === 'translate' ? 'active' : ''} onClick={() => setMode('translate')}>✥ 拖动移动</button>}
              {activeTools.has('scale') && activeTools.size > 1 && <button type="button" className={mode === 'scale' ? 'active' : ''} onClick={() => setMode('scale')}>⤢ 拖动变大小</button>}
              {activeTools.has('rotate') && <button type="button" onClick={rotateSelected} disabled={!selected}>↻ {selected?.type === 'cylinder' ? '转成横向' : '转一下'}</button>}
              {activeTools.has('duplicate') && <button type="button" onClick={duplicateSelected} disabled={!selected}>⧉ 复制一个</button>}
              {activeTools.has('align') && <button type="button" onClick={alignToGround} disabled={!selected}>⌄ 稳稳落地</button>}
              {activeTools.has('hole') && <button type="button" onClick={toggleHole} disabled={!selected || selected.type !== 'cylinder'}>◌ {selected?.isHole ? '变回实体' : '设为空洞'}</button>}
              {activeTools.has('group') && <button type="button" onClick={groupScene}>⬡ {quest.id === 8 || quest.id === 9 ? '完成挖孔' : '组合成作品'}</button>}
              {activeTools.has('plan') && <button type="button" onClick={confirmPlan}>☑ 确认三步计划</button>}
            </div>
          </section>

          <section className="selected-panel">
            <label className="part-picker"><span>当前选中</span><select value={selectedId ?? ''} onChange={(event) => setSelectedId(event.target.value || null)}><option value="">请在画布上选一个</option>{project.shapes.map((shape) => <option key={shape.id} value={shape.id}>{shape.isHole ? '◌' : '◆'} {shape.name}</option>)}</select></label>
            {activeTools.has('move') && activeTools.size === 1 && <div className="direction-grid">{moveDirections.map((item) => <button key={`${item.axis}-${item.amount}`} type="button" disabled={!selected} onClick={() => nudgePosition(item.axis, item.amount)}>{item.label}</button>)}</div>}
            {activeTools.has('scale') && activeTools.size === 1 && <div className="size-buttons"><button type="button" disabled={!selected} onClick={() => changeScale(-0.25)}>− 变小</button><button type="button" disabled={!selected} onClick={() => changeScale(0.25)}>＋ 变大</button></div>}
            {activeTools.has('size-input') && selected && <fieldset className="size-inputs"><legend>精确尺寸（毫米）</legend>{(['x', 'y', 'z'] as const).map((axis) => <label key={axis}><span>{axis.toUpperCase()}</span><input key={`${selected.id}-${axis}-${selected.scale[axis]}`} type="number" min="0.1" max="100" step="0.1" defaultValue={Number(selected.scale[axis].toFixed(2))} onBlur={(event) => setExactDimension(axis, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>)}</fieldset>}
            {activeTools.has('color') && selected && <div className="color-row" aria-label="选择颜色">{[['#ff9b56', '橙色'], ['#f4c844', '黄色'], ['#60b8ff', '蓝色'], ['#56bb85', '绿色'], ['#9b7cf6', '紫色'], ['#f36e79', '红色']].map(([color, name]) => <button key={color} type="button" aria-pressed={selected.color === color} style={{ background: color }} className={selected.color === color ? 'selected' : ''} onClick={() => changeColor(color)} aria-label={`换成${name}`} />)}</div>}
          </section>

          {quest.id >= 9 && <details className="work-archive"><summary>🗂️ 作品档案</summary><div><button type="button" onClick={() => runExport(() => downloadProjectArchive(quest, project), '可编辑工程已下载。')}>可编辑工程</button><button type="button" onClick={() => runExport(() => downloadStl(quest, project), 'STL 模型已下载。')}>STL 模型</button><button type="button" onClick={() => runExport(() => downloadViewportImage(quest), '作品图已下载。')}>作品图</button><button type="button" onClick={() => runExport(() => downloadProcessReport(quest, project), '过程记录已下载。')}>过程记录</button></div></details>}
        </aside>
      </main>

      <div className="phone-notice" inert={showSuccess ? true : undefined} aria-hidden={showSuccess || undefined}><span aria-hidden="true">🖥️</span><h2>请换到电脑或横屏平板</h2><p>小屏幕可以查看地图，但 3D 建模需要更大的工作台和更精确的操作。</p><button type="button" onClick={onBack}>返回地图</button></div>

      {showSuccess && (
        <div className="modal-backdrop success-backdrop" role="presentation">
          <section ref={successModalRef} className="success-modal" role="dialog" aria-modal="true" aria-labelledby="success-title">
            <div className="success-burst" aria-hidden="true">🎉</div>
            <p className="eyebrow">检查完成</p>
            <h2 id="success-title">作品已达到本关目标！</h2>
            <p>徽章由任务记录自动判定，不需要自己打勾。</p>
            {quest.reflectionPrompt && <p className="reflection-prompt"><strong>说一说</strong>{quest.reflectionPrompt}</p>}
            <div className="badge-results">
              {badgeResults.map((badge) => <div key={badge.name} className={badge.earned ? 'earned' : ''}><span aria-hidden="true">{badge.earned ? badge.icon : '·'}</span><p><strong>{badge.name}</strong><small>{badge.detail}</small></p></div>)}
            </div>
            <div className="earned-stars" aria-label={`本次获得 ${earnedBadges.length} 颗星`}>{'⭐'.repeat(earnedBadges.length)}</div>
            <button ref={successInitialFocusRef} className="primary-button full-width" type="button" onClick={claimReward}>领取 {quest.reward}</button>
            <button className="secondary-button full-width" type="button" onClick={continueEditing}>再修改一下</button>
          </section>
        </div>
      )}
    </div>
  )
}

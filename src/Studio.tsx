import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { evaluateQuest, holePassesThroughBase, tunnelsAreDistinct } from './course'
import { ModelViewport } from './ModelViewport'
import type {
  ModelShape,
  OperationRecord,
  OperationType,
  PrimitiveType,
  Quest,
  QuestProject,
  TransformMode,
  Vector3Value,
} from './types'

interface StudioProps {
  quest: Quest
  savedProject?: QuestProject
  totalStars: number
  storageHealthy: boolean
  onBack: () => void
  onProjectChange: (questId: number, project: QuestProject) => void
  onComplete: (questId: number, stars: number, project: QuestProject) => void
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
  if (savedProject) return cloneProject(savedProject)
  return {
    shapes: structuredClone(quest.starterShapes ?? []),
    operations: [],
    updatedAt: Date.now(),
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

export function Studio({ quest, savedProject, totalStars, storageHealthy, onBack, onProjectChange, onComplete }: StudioProps) {
  const [project, setProject] = useState<QuestProject>(() => initialProject(quest, savedProject))
  const [selectedId, setSelectedId] = useState<string | null>(() => project.shapes[0]?.id ?? null)
  const [mode, setMode] = useState<TransformMode>('translate')
  const [undoStack, setUndoStack] = useState<QuestProject[]>([])
  const [redoStack, setRedoStack] = useState<QuestProject[]>([])
  const [status, setStatus] = useState('选中一个形状，就可以开始动手。')
  const [showSuccess, setShowSuccess] = useState(false)
  const [creativeBonus, setCreativeBonus] = useState(false)
  const [reason, setReason] = useState('')
  const successModalRef = useRef<HTMLElement>(null)
  const successInitialFocusRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onProjectChange(quest.id, project)
  }, [onProjectChange, project, quest.id])

  useEffect(() => {
    if (!showSuccess) return
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    successInitialFocusRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
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
  }, [showSuccess])

  const selected = project.shapes.find((shape) => shape.id === selectedId) ?? null
  const evaluations = useMemo(
    () => evaluateQuest(quest.id, project.shapes, project.operations),
    [project.operations, project.shapes, quest.id],
  )
  const completeTaskIds = new Set(evaluations.filter((item) => item.complete).map((item) => item.taskId))
  const coreComplete = evaluations.length > 0 && evaluations.every((item) => item.complete)

  const commit = (shapes: ModelShape[], nextOperation?: OperationRecord, message?: string) => {
    setUndoStack((stack) => [...stack.slice(-29), cloneProject(project)])
    setRedoStack([])
    setProject({
      shapes,
      operations: (nextOperation ? [...project.operations, nextOperation] : project.operations).slice(-1000),
      updatedAt: Date.now(),
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
      return quest.id === 3 && shape.grouped && operationType ? { ...updated, grouped: false } : updated
    })
    commit(shapes, operationType ? operation(operationType, selectedId) : undefined, message)
  }

  const addShape = (type: PrimitiveType) => {
    const shape = makeShape(type, project.shapes.length)
    if (quest.id === 4 && type === 'cylinder') {
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
    const removedWasGrouped = project.shapes.find((shape) => shape.id === selectedId)?.grouped
    const next = project.shapes
      .filter((shape) => shape.id !== selectedId)
      .map((shape) => quest.id === 3 && removedWasGrouped ? { ...shape, grouped: false } : shape)
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
    if (quest.id === 4 && selected?.type === 'cylinder') return
    updateSelected(
      (shape) => ({ ...shape, position: { ...shape.position, y: Math.max(0.1, shape.scale.y / 2) } }),
      'align',
      '已经稳稳地落到地面上。',
    )
  }

  const groupScene = () => {
    const holes = project.shapes.filter((shape) => shape.isHole)
    const solids = project.shapes.filter((shape) => !shape.isHole)
    if (holes.length > 0) {
      if (solids.length === 0) {
        setStatus('还需要一个实体，洞才能从它里面减掉。')
        return
      }
      const base = quest.id === 4
        ? solids.find((shape) => shape.id === 'cheese')
        : [...solids].sort((a, b) => shapeVolume(b) - shapeVolume(a))[0]
      if (!base) {
        setStatus('没有找到要挖空的奶酪，点击重新开始可以恢复它。')
        return
      }
      if (quest.id === 4 && (holes.length < 3 || holes.some((hole) => !holePassesThroughBase(base, hole)))) {
        setStatus('隧道还没有从奶酪的一边穿到另一边。把圆柱转横、放进奶酪中间，再试一次。')
        return
      }
      if (quest.id === 4 && !tunnelsAreDistinct([...(base.holes ?? []), ...holes])) {
        setStatus('有些隧道重叠在一起了。把它们移开一点，让奶酪上出现三个不同的洞。')
        return
      }
      const next = solids.map((shape) =>
        shape.id === base.id
          ? { ...shape, grouped: true, holes: [...(shape.holes ?? []), ...holes.map((hole) => ({ ...hole, isHole: false }))] }
          : shape,
      )
      commit(next, operation('group', base.id), `组合完成：${holes.length} 个洞已经从奶酪中减掉。`)
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
        ? quest.id === 3 && shape.grouped ? { ...changed, grouped: false } : changed
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
    setStatus('工作台已经整理干净，可以重新开始了。')
  }

  const checkWork = () => {
    if (coreComplete) {
      setShowSuccess(true)
      return
    }
    const firstMissing = quest.tasks.find((task) => !completeTaskIds.has(task.id))
    setStatus(firstMissing ? `下一步：${firstMissing.label}` : '再检查一下任务要求。')
  }

  const claimReward = () => {
    if (!coreComplete) {
      setShowSuccess(false)
      setStatus('作品刚刚发生了变化，请再检查一次任务。')
      return
    }
    const stars = 1 + Number(creativeBonus) + Number(Boolean(reason))
    onComplete(quest.id, stars, project)
    setShowSuccess(false)
    onBack()
  }

  return (
    <div className="studio-page">
      <header className="studio-topbar" inert={showSuccess ? true : undefined} aria-hidden={showSuccess || undefined}>
        <button className="back-button" type="button" onClick={onBack}>← 返回地图</button>
        <div className="studio-title"><span>{quest.icon}</span><div><small>第 {quest.id} 关</small><strong>{quest.title}</strong></div></div>
        <div className="studio-score">⭐ {totalStars}</div>
      </header>

      <main className="studio-layout" inert={showSuccess ? true : undefined} aria-hidden={showSuccess || undefined}>
        <aside className="mission-panel">
          <p className="eyebrow">本关任务</p>
          <h1>{quest.title}</h1>
          <p className="mission-story">{quest.story}</p>
          <div className="learn-one"><strong>今天的新本领</strong><span>{quest.objective}</span></div>
          <ol className="live-task-list">
            {quest.tasks.map((task, index) => {
              const complete = completeTaskIds.has(task.id)
              return <li key={task.id} className={complete ? 'done' : ''}><span>{complete ? '✓' : index + 1}</span><p>{task.label}</p></li>
            })}
          </ol>
          <div className="tip-card"><span aria-hidden="true">💡</span><p><strong>小提示</strong>{quest.tip}</p></div>
          <button className={`check-button ${coreComplete ? 'ready' : ''}`} type="button" onClick={checkWork}>
            {coreComplete ? '检查完成，领取奖励' : '检查我的作品'}
          </button>
        </aside>

        <section className="workbench" aria-label="3D 建模工作台">
          <div className="studio-toolbar" aria-label="建模工具栏">
            <div className="tool-group">
              <button type="button" aria-pressed={mode === 'translate'} className={mode === 'translate' ? 'active' : ''} onClick={() => setMode('translate')}>↔ 移动</button>
              {quest.id >= 2 && <button type="button" aria-pressed={mode === 'rotate'} className={mode === 'rotate' ? 'active' : ''} onClick={() => setMode('rotate')}>↻ 旋转</button>}
              <button type="button" aria-pressed={mode === 'scale'} className={mode === 'scale' ? 'active' : ''} onClick={() => setMode('scale')}>⤢ 缩放</button>
            </div>
            <div className="tool-group">
              <button type="button" onClick={undo} disabled={undoStack.length === 0} aria-label="撤销">↶</button>
              <button type="button" onClick={redo} disabled={redoStack.length === 0} aria-label="重做">↷</button>
              <button type="button" onClick={resetQuest} className="quiet-danger">重新开始</button>
            </div>
          </div>

          <div className="viewport-wrap">
            <ModelViewport
              shapes={project.shapes}
              selectedId={selectedId}
              mode={mode}
              onSelect={setSelectedId}
              onTransformEnd={onTransformEnd}
            />
            <div className="view-help">拖动空白处旋转视角 · 滚轮缩放 · 点击形状进行编辑</div>
          </div>
          <div className="studio-status" role="status"><span aria-hidden="true">🐼</span>{status}<span className={`autosave ${storageHealthy ? '' : 'save-error'}`}>{storageHealthy ? '已自动保存' : '暂时无法保存'}</span></div>
        </section>

        <aside className="tools-panel">
          <section>
            <p className="panel-label">添加形状</p>
            <div className="shape-palette">
              {quest.palette.map((type) => (
                <button key={type} type="button" onClick={() => addShape(type)}>
                  <span style={{ color: primitiveInfo[type].color }}>{primitiveInfo[type].icon}</span>{primitiveInfo[type].label}
                </button>
              ))}
            </div>
          </section>

          <section className="selected-panel">
            <p className="panel-label">编辑选中形状</p>
            {selected ? (
              <>
                <div className="selected-name"><span style={{ background: selected.color }} />{selected.name}{selected.isHole && <em>洞</em>}</div>
                <div className="quick-actions">
                  {quest.id >= 3 && <button type="button" onClick={duplicateSelected}>⧉ 复制</button>}
                  {quest.id >= 2 && !(quest.id === 4 && selected.type === 'cylinder') && <button type="button" onClick={alignToGround}>⌄ 落地</button>}
                  {quest.id >= 4 && selected.type === 'cylinder' && <button type="button" aria-pressed={Boolean(selected.isHole)} onClick={toggleHole} className={selected.isHole ? 'active' : ''}>◌ {selected.isHole ? '变实体' : '设为空洞'}</button>}
                  <button type="button" onClick={deleteSelected}>× 移走</button>
                </div>
                <div className="mini-control">
                  <span>移动</span>
                  <div><button type="button" onClick={() => nudgePosition('x', -0.5)}>X−</button><button type="button" onClick={() => nudgePosition('x', 0.5)}>X＋</button></div>
                  <div><button type="button" onClick={() => nudgePosition('y', -0.5)}>Y−</button><button type="button" onClick={() => nudgePosition('y', 0.5)}>Y＋</button></div>
                  <div><button type="button" onClick={() => nudgePosition('z', -0.5)}>Z−</button><button type="button" onClick={() => nudgePosition('z', 0.5)}>Z＋</button></div>
                </div>
                <div className="mini-control compact"><span>大小</span><div><button type="button" onClick={() => changeScale(-0.25)}>−</button><button type="button" onClick={() => changeScale(0.25)}>＋</button></div>{quest.id >= 2 && <button type="button" onClick={rotateSelected}>↻ {selected.type === 'cylinder' ? '旋转 90°' : '旋转 30°'}</button>}</div>
                <div className="color-row" aria-label="选择颜色">
                  {[['#ff9b56', '橙色'], ['#f4c844', '黄色'], ['#60b8ff', '蓝色'], ['#56bb85', '绿色'], ['#9b7cf6', '紫色'], ['#f36e79', '红色']].map(([color, name]) => (
                    <button key={color} type="button" aria-pressed={selected.color === color} style={{ background: color }} className={selected.color === color ? 'selected' : ''} onClick={() => changeColor(color)} aria-label={`换成${name}`} />
                  ))}
                </div>
              </>
            ) : <p className="empty-selection">先在工作台上点击一个形状。</p>}
            {project.shapes.length > 0 && (
              <div className="parts-list" aria-label="我的零件">
                <span>我的零件</span>
                <div>{project.shapes.map((shape) => <button key={shape.id} type="button" className={shape.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(shape.id)}>{shape.isHole ? '◌' : '◆'} {shape.name}</button>)}</div>
              </div>
            )}
          </section>

          {quest.id >= 3 && <button className="group-button" type="button" onClick={groupScene}>⬡ 组合场景中的形状</button>}
        </aside>
      </main>

      <div className="phone-notice" inert={showSuccess ? true : undefined} aria-hidden={showSuccess || undefined}><span aria-hidden="true">🖥️</span><h2>请换到电脑或横屏平板</h2><p>小屏幕可以查看地图，但 3D 建模需要更大的工作台和更精确的操作。</p><button type="button" onClick={onBack}>返回地图</button></div>

      {showSuccess && (
        <div className="modal-backdrop success-backdrop" role="presentation">
          <section ref={successModalRef} className="success-modal" role="dialog" aria-modal="true" aria-labelledby="success-title">
            <div className="success-burst" aria-hidden="true">🎉</div>
            <p className="eyebrow">闯关成功</p>
            <h2 id="success-title">核心本领已经学会！</h2>
            <p>第一颗星属于认真完成任务的你。再回想一下作品，还可以收集两颗成长星。</p>
            <label className="bonus-check"><input ref={successInitialFocusRef} type="checkbox" checked={creativeBonus} onChange={(event) => setCreativeBonus(event.target.checked)} /><span><strong>创意星</strong>我加入了和示例不一样的设计</span></label>
            <fieldset className="reason-picker"><legend><strong>表达星</strong>这次修改让作品……</legend>
              {['更稳了', '更像我的想法', '解决了一个问题'].map((item) => <button key={item} type="button" aria-pressed={reason === item} className={reason === item ? 'selected' : ''} onClick={() => setReason(item)}>{item}</button>)}
            </fieldset>
            <div className="earned-stars" aria-label={`本次获得 ${1 + Number(creativeBonus) + Number(Boolean(reason))} 颗星`}>{'⭐'.repeat(1 + Number(creativeBonus) + Number(Boolean(reason)))}</div>
            <button className="primary-button full-width" type="button" onClick={claimReward}>领取 {quest.reward}</button>
            <button className="secondary-button full-width" type="button" onClick={() => setShowSuccess(false)}>再修改一下</button>
          </section>
        </div>
      )}
    </div>
  )
}

import { evaluateQuest } from './course'
import type { ModelShape, PrimitiveType, Quest, QuestProject, QuestTool, Vector3Value } from './types'

export interface PracticeScenario {
  id: string
  title: string
  instruction: string
  tools: Array<QuestTool | PrimitiveType>
  hints: string[]
  initialProject: QuestProject
  targetShapes: ModelShape[]
  kind: 'shape-choice' | 'target' | 'align' | 'symmetry' | 'tunnels' | 'wall' | 'repair' | 'brief' | 'capstone'
  choice?: { taskId: string; expectedType: PrimitiveType; options: PrimitiveType[] }
  /** Final model evidence, not an operation counter. */
  targetProperty?: 'position' | 'scale' | 'upright'
  requiredShapeIds: string[]
}

export interface PracticeEvaluation { complete: boolean; feedback: string }
export interface ShapeChoiceResult { correct: boolean; feedback: string; shapes?: ModelShape[] }

const vector = (x: number, y: number, z: number): Vector3Value => ({ x, y, z })
const shape = (id: string, name: string, type: PrimitiveType, position: Vector3Value, scale: Vector3Value, color = '#ff9b56', rotation = vector(0, 0, 0)): ModelShape => ({ id, name, type, position, scale, color, rotation })
const near = (a: number, b: number, tolerance = 0.08) => Math.abs(a - b) <= tolerance
const sameVector = (a: Vector3Value, b: Vector3Value, tolerance = 0.08) => (['x', 'y', 'z'] as const).every((axis) => near(a[axis], b[axis], tolerance))
const upright = (item: ModelShape) => (['x', 'z'] as const).every((axis) => Math.abs(Math.sin(item.rotation[axis])) < 0.05 && Math.cos(item.rotation[axis]) > 0.99)

const shapeChoices: Record<string, { type: PrimitiveType; shapes: ModelShape[]; success: string; retry: string }> = {
  'find-round': {
    type: 'sphere',
    shapes: [
      shape('snow-body', '雪人的身体', 'sphere', vector(-2, 0.8, 0), vector(1.6, 1.6, 1.6), '#edf8ff'),
      shape('snow-head', '雪人的脑袋', 'sphere', vector(-2, 1.95, 0), vector(1, 1, 1), '#edf8ff'),
    ],
    success: '找对了！两个圆滚滚的身体自动组成了雪人。',
    retry: '再看看：雪人的身体没有平面，也没有尖角。换一个形状试试。',
  },
  'find-tall': {
    type: 'cylinder',
    shapes: [shape('detective-cup', '杯身', 'cylinder', vector(0, 0.9, 0), vector(1.2, 1.8, 1.2), '#9b7cf6')],
    success: '选对了！圆圆的上下两面和直直的侧面，组成了杯身。',
    retry: '再观察杯身：上下一样宽，有两个平平的圆面。选另一个试试。',
  },
  'find-point': {
    type: 'cone',
    shapes: [
      shape('detective-cone', '冰淇淋甜筒', 'cone', vector(2, 0.9, 0), vector(1.4, 1.8, 1.4), '#f4c844', vector(0, 0, Math.PI)),
      shape('icecream-scoop', '冰淇淋球', 'sphere', vector(2, 1.85, 0), vector(1.5, 1.5, 1.5), '#f5a5ba'),
    ],
    success: '甜筒接好了！尖尖的甜筒和圆圆的冰淇淋球组合在一起。',
    retry: '甜筒一边是宽宽的圆面，另一边收成尖端。再选一次。',
  },
  'practice-candle': {
    type: 'cylinder',
    shapes: [shape('birthday-candle', '生日蜡烛', 'cylinder', vector(0, 1.2, 0), vector(0.65, 2.4, 0.65), '#ffb25c')],
    success: '蜡烛站好了！换了一件物品，你也认出了它的形状。',
    retry: '蜡烛直直的，上下一样粗；想想哪个形状能稳稳站着。',
  },
}

/** Wrong guesses never add wrong parts or destroy a child's current scene. */
export function recognizeShapeChoice(taskId: string, type: PrimitiveType, project: QuestProject): ShapeChoiceResult {
  const choice = shapeChoices[taskId]
  if (!choice) return { correct: false, feedback: '请先观察当前侦探卡。' }
  if (type !== choice.type) return { correct: false, feedback: choice.retry }
  const ids = new Set(choice.shapes.map((item) => item.id))
  return {
    correct: true,
    feedback: choice.success,
    shapes: [...structuredClone(project.shapes.filter((item) => !ids.has(item.id))), ...structuredClone(choice.shapes)],
  }
}

/** Each retry gets its own scene. Passed work is deliberately never mutated or used as a scratchpad. */
export function createPracticeScenario(quest: Quest, passedProject: QuestProject): PracticeScenario {
  const stamp = passedProject.updatedAt
  const build = (definition: Omit<PracticeScenario, 'initialProject' | 'requiredShapeIds'>, shapes: ModelShape[]): PracticeScenario => ({
    ...definition,
    initialProject: { courseVersion: 2, shapes: structuredClone(shapes), operations: [], updatedAt: stamp, startedAt: stamp },
    targetShapes: structuredClone(definition.targetShapes),
    requiredShapeIds: shapes.map((item) => item.id),
  })
  switch (quest.id) {
    case 1:
      return build({ id: 'q1-shape-variation', title: '新侦探卡：生日蜡烛', instruction: '生日蛋糕缺了一根直直的蜡烛。从三个形状里选出适合的一个。', tools: ['box', 'cylinder', 'sphere'], hints: ['它上下同样粗。', '找两头平平、侧面直直的形状。', '选圆柱，看看蜡烛怎样站起来。'], kind: 'shape-choice', choice: { taskId: 'practice-candle', expectedType: 'cylinder', options: ['box', 'cylinder', 'sphere'] }, targetShapes: [] }, [])
    case 2: {
      const target = shape('delivery-block', '新包裹的家', 'box', vector(1.5, 0.75, 1), vector(1.4, 1.4, 1.4))
      return build({ id: 'q2-move-variation', title: '新地址：再送一个包裹', instruction: '这次目的地换了方向。把包裹完整送进淡蓝目标区。', tools: ['move'], hints: ['先看左右，再看前后。', '这次目标在右后方。', '把包裹向右、向后移动，直到两个轮廓重合。'], kind: 'target', targetProperty: 'position', targetShapes: [target] }, [{ ...structuredClone(target), name: '待送包裹', position: vector(-1.5, 0.75, -1) }])
    }
    case 3: {
      const target = shape('practice-size', '合身的礼物', 'box', vector(0, 0.75, 0), vector(1.5, 1.5, 1.5), '#56bb85')
      return build({ id: 'q3-scale-variation', title: '礼物盒太大了', instruction: '这次礼物盒太大。把它缩小，让三边都贴合淡蓝轮廓。', tools: ['scale'], hints: ['比较盒子和轮廓哪一个大。', '这次要缩小，而不是变大。', '每缩小一次都观察三条边，直到轮廓贴合。'], kind: 'target', targetProperty: 'scale', targetShapes: [target] }, [{ ...structuredClone(target), scale: vector(2, 2, 2) }])
    }
    case 4: {
      const roof = shape('roof', '另一间小屋的屋顶', 'cone', vector(0, 2, 0), vector(2.4, 1.8, 2.4), '#f4a251')
      return build({ id: 'q4-rotate-variation', title: '风向变了！', instruction: '另一间小屋也等着修好。先看这次歪向哪边，再把屋顶转正。', tools: ['rotate'], hints: ['这次屋顶向左歪了。', '如果越转越歪，换一个方向。', '尝试向右旋转，让屋顶贴合淡蓝轮廓。'], kind: 'target', targetProperty: 'upright', targetShapes: [roof] }, [{ ...structuredClone(roof), rotation: vector(0, 0, Math.PI / 3) }])
    }
    case 5: {
      const targets = [-1.5, 1.5].map((x, index) => shape(`practice-shelf-${index}`, `${index === 0 ? '左' : '右'}边新隔板`, 'box', vector(x, 0.5, 0), vector(1.4, 1, 2), index === 0 ? '#f4c844' : '#9b7cf6'))
      return build({ id: 'q5-align-variation', title: '再整理两块隔板', instruction: '两块新隔板高低不同。找到共同底线，让它们都稳稳落地。', tools: ['align'], hints: ['还有两块隔板悬着。', '先选一块落地，再选另一块。', '底部都贴住地面后，才是真正对齐。'], kind: 'align', targetShapes: targets }, targets.map((item, index) => ({ ...structuredClone(item), position: vector(item.position.x, 1.5 + index, 0) })))
    }
    case 6: {
      const target = shape('new-size-code', '新尺寸密码', 'box', vector(0, 4, 0), vector(10, 8, 4))
      return build({ id: 'q6-size-variation', title: '新密码：10 × 8 × 4 毫米', instruction: '新的尺寸卡是 X=10、Y=8、Z=4。准确输入三个方向的尺寸。', tools: ['size-input'], hints: ['这不是刚才的尺寸卡。', 'Y 已经正确，另外两个方向要调整。', '把 X 设为 10，Z 设为 4，再检查 Y 是 8。'], kind: 'target', targetProperty: 'scale', targetShapes: [target] }, [{ ...structuredClone(target), scale: vector(12, 8, 5) }])
    }
    case 7: {
      const left = shape('left-arm', '左臂', 'box', vector(-1.5, 1, 0), vector(0.7, 2, 0.7), '#f4c844')
      const right = { ...structuredClone(left), id: 'practice-right-arm', name: '右臂的目标', position: vector(1.5, 1, 0) }
      return build({ id: 'q7-copy-variation', title: '维修备用双臂', instruction: '复制这只备用手臂，把复制品移进右侧轮廓。两边的尺寸和位置都要对应。', tools: ['duplicate', 'move'], hints: ['复制保留了原件的尺寸。', '右臂应该离中心同样远。', '选左臂复制，再把复制品向右送进轮廓。'], kind: 'symmetry', targetShapes: [left, right] }, [left])
    }
    case 8: {
      const cheese = shape('cheese', '新奶酪', 'box', vector(0, 1.8, 0), vector(5.5, 3.6, 3.2), '#f4c844')
      const holes = [-0.9, 0, 0.9].map((z, index) => ({ ...shape(`practice-tunnel-${index}`, index === 2 ? '最后一条隧道' : `已准备隧道 ${index + 1}`, 'cylinder', vector(0, 1.8, z), vector(0.7, 6, 0.7), '#71d6e8', vector(0, 0, Math.PI / 2)), isHole: index !== 2 }))
      return build({ id: 'q8-hole-variation', title: '最后一条隧道还堵着', instruction: '三根圆柱已经摆好。把“最后一条隧道”设为空洞，再完成挖孔，让三条路都通。', tools: ['hole', 'group'], hints: ['两根已经半透明，还有一根是实体。', '选择“最后一条隧道”。', '先设为空洞，再点击完成挖孔。'], kind: 'tunnels', targetShapes: [] }, [cheese, ...holes])
    }
    case 9: {
      const cup = shape('pen-cup', '壁太薄的笔筒外壳', 'cylinder', vector(0, 3, 0), vector(5, 6, 5), '#9b7cf6')
      cup.holes = [shape('cup-core', '已挖出的内芯', 'cylinder', vector(0, 3.3, 0), vector(4.1, 5.4, 4.1), '#71d6e8')]
      return build({ id: 'q9-wall-variation', title: '给薄笔筒加点力量', instruction: '这个新笔筒的壁只有 0.45。把外壳整体变大，直到四周壁厚至少 0.5，顶部开口、底部仍然封闭。', tools: ['scale'], hints: ['外壳和内孔一起等比例变大，壁也会厚一些。', '选中外壳，向更大的轮廓靠近。', '尝试把外壳变大三小格，再检查壁厚。'], kind: 'wall', targetShapes: [{ ...structuredClone(cup), id: 'wall-target', holes: undefined, scale: vector(5.75, 6.75, 5.75) }] }, [cup])
    }
    case 10: {
      const base = shape('print-base', '新打印底座', 'box', vector(1, 0.3, 0), vector(4, 0.6, 2.5), '#56bb85')
      const part = shape('floating-part', '待检蓝色零件', 'box', vector(2, 2.1, 0), vector(1.2, 1.2, 1.2), '#60b8ff')
      const side = shape('thin-part', '已加厚的零件', 'box', vector(0, 0.9, 0), vector(0.65, 1.2, 1), '#f36e79')
      return build({ id: 'q10-check-variation', title: '修理站的新订单', instruction: '这件新模型的厚度已经合格，但还有一处故障。观察体检灯，把未被支撑的零件修好。', tools: ['move', 'align'], hints: ['不要重做已经合格的厚度。', '右边蓝色零件下面还有空隙。', '选择蓝色零件，向下移动到淡蓝轮廓或稳稳落地。'], kind: 'repair', targetShapes: [{ ...structuredClone(part), id: 'repair-target', position: vector(2, 1.1, 0) }] }, [base, part, side])
    }
    case 11: {
      const base = shape('brief-base', '路标底座', 'box', vector(0, 0.35, 0), vector(3, 0.7, 2), '#56bb85')
      const post = shape('brief-post', '路标柱', 'cylinder', vector(0, 1.7, 0), vector(0.8, 2.7, 0.8), '#f4c844')
      const sign = shape('practice-sign', '掉队的标牌', 'box', vector(3, 2.5, 0), vector(1.4, 1, 0.5), '#60b8ff')
      return build({ id: 'q11-brief-variation', title: '新任务书：修复路标', instruction: '新要求：保留三件零件和两种形状，把标牌接回淡蓝目标。先确认三步计划，再动手修好。', tools: ['plan', 'move', 'align'], hints: ['先读完三个必做项。', '标牌需要回到路标柱旁。', '确认计划后，把标牌向左送进淡蓝轮廓。'], kind: 'brief', targetShapes: [{ ...structuredClone(sign), position: vector(0.5, 2.5, 0) }] }, [base, post, sign])
    }
    case 12: {
      const base = shape('organizer-base', '收纳底座', 'box', vector(0, 0.3, 0), vector(4, 0.6, 3), '#56bb85')
      const post = shape('organizer-post', '收纳圆柱', 'cylinder', vector(-1, 1, 0), vector(0.8, 1.4, 0.8), '#f4c844')
      const divider = shape('organizer-divider', '收纳隔板', 'box', vector(0.8, 1, 0), vector(0.6, 1.4, 2), '#60b8ff')
      const knob = shape('organizer-knob', '待安装圆头', 'sphere', vector(0.8, 3, 0), vector(0.8, 0.8, 0.8), '#f36e79')
      return build({ id: 'q12-capstone-variation', title: '最后的改进：装稳圆头', instruction: '这个备用收纳发明还缺一次修整。把悬着的圆头装到淡蓝目标，确认四件零件稳固连接，再组合。', tools: ['move', 'align', 'group'], hints: ['圆头下方有一条大缝。', '圆头要接在隔板上方。', '向下移动圆头到轮廓，再组合成完整作品。'], kind: 'capstone', targetShapes: [{ ...structuredClone(knob), position: vector(0.8, 2, 0) }] }, [base, post, divider, knob])
    }
    default:
      throw new Error(`Unsupported quest: ${quest.id}`)
  }
}

function allShapeIds(shapes: ModelShape[]): Set<string> {
  return new Set(shapes.flatMap((item) => [item.id, ...allShapeIds(item.holes ?? [])]))
}

export function evaluatePracticeScenario(scenario: PracticeScenario, project: QuestProject): PracticeEvaluation {
  const result = (complete: boolean, feedback: string): PracticeEvaluation => ({ complete, feedback: complete ? '新挑战通过了！转动视角，看看你刚刚完成的效果。' : feedback })
  const ids = allShapeIds(project.shapes)
  if (!scenario.requiredShapeIds.every((id) => ids.has(id))) return result(false, '挑战中还有零件被移走了；撤销或重新开始小挑战，再完成目标。')
  const solids = project.shapes.filter((item) => !item.isHole)
  const targetsMatch = (property: 'position' | 'scale') => scenario.targetShapes.every((target) => {
    const current = solids.find((item) => item.id === target.id)
    return Boolean(current && current.type === target.type && sameVector(current[property], target[property]))
  })
  switch (scenario.kind) {
    case 'shape-choice': {
      const candle = solids.find((item) => item.id === 'birthday-candle')
      return result(Boolean(candle && candle.type === scenario.choice?.expectedType), '蜡烛还没选好；观察直直的侧面和上下两面，再做选择。')
    }
    case 'target': {
      if (scenario.targetProperty === 'upright') {
        const roof = solids.find((item) => item.id === 'roof' && item.type === 'cone')
        return result(Boolean(roof && upright(roof)), '屋顶仍然歪着；观察尖端的位置，试试另一个旋转方向。')
      }
      const property = scenario.targetProperty === 'scale' ? 'scale' : 'position'
      return result(targetsMatch(property), property === 'scale' ? '尺寸还没贴合新目标；检查三个方向是否都正确。' : '包裹还没完整进入新目标；再检查左右、前后和上下。')
    }
    case 'align':
      return result(targetsMatch('position'), '还有隔板没到共同底线；选择悬着的隔板，让它稳稳落地。')
    case 'symmetry': {
      const [leftTarget, rightTarget] = scenario.targetShapes
      const left = solids.find((item) => item.id === 'left-arm')
      const right = solids.find((item) => item.id !== 'left-arm' && item.type === leftTarget.type && sameVector(item.position, rightTarget.position) && sameVector(item.scale, rightTarget.scale) && upright(item))
      return result(Boolean(left && right && sameVector(left.position, leftTarget.position) && sameVector(left.scale, leftTarget.scale) && upright(left)), '还没有一对尺寸相同、左右对称的手臂；把复制品送进右侧目标。')
    }
    case 'tunnels':
      return result(evaluateQuest(8, project.shapes, []).every((item) => item.complete), '隧道还没有真正挖通；把第三根圆柱设为空洞，再完成挖孔。')
    case 'wall':
      return result(evaluateQuest(9, project.shapes, []).every((item) => item.complete), '壁厚还不到 0.5，或开口、封底不合格；继续调整外壳大小。')
    case 'repair': {
      const issues = evaluateQuest(10, project.shapes, [])
      return result(issues.every((item) => item.complete), issues.find((item) => !item.complete)?.feedback ?? '再检查三个体检灯。')
    }
    case 'brief':
      return result(evaluateQuest(11, project.shapes, project.operations).every((item) => item.complete) && targetsMatch('position'), '先确认三步计划，再把标牌接回淡蓝目标；三个必做项都要满足。')
    case 'capstone':
      return result(evaluateQuest(12, project.shapes, project.operations).every((item) => item.complete) && targetsMatch('position'), '圆头还没稳固装到目标，或零件尚未组合；完成修整后再组合。')
  }
}

import type { ModelShape, PrimitiveType, Quest, TaskEvaluation } from './types'

const vec = (x: number, y: number, z: number) => ({ x, y, z })

const starter = (
  id: string,
  name: string,
  type: PrimitiveType,
  color: string,
  position = vec(0, 1, 0),
  scale = vec(1, 1, 1),
): ModelShape => ({
  id,
  name,
  type,
  color,
  position,
  rotation: vec(0, 0, 0),
  scale,
})

export const quests: Quest[] = [
  {
    id: 1,
    title: '认识形状',
    shortTitle: '认识形状',
    subtitle: '移动 · 缩放',
    story: '港口散落着几块神奇积木。把方块、球和圆柱放进场景，再改变它们的大小。',
    objective: '认识三种基本形状，并学会移动和缩放。',
    minutes: 25,
    icon: '🧊',
    reward: '积木徽章',
    available: true,
    palette: ['box', 'sphere', 'cylinder'],
    tasks: [
      { id: 'three-types', label: '放入方块、球体和圆柱' },
      { id: 'move', label: '移动至少一个形状' },
      { id: 'scale', label: '改变至少一个形状的大小' },
    ],
    tip: '先点击一个形状，再用彩色箭头移动它。',
  },
  {
    id: 2,
    title: '建造小屋',
    shortTitle: '建造小屋',
    subtitle: '旋转 · 对齐',
    story: '造物岛下雨啦！用方块和圆锥搭一间小屋，让屋顶端端正正地落在房子上。',
    objective: '学习旋转形状，并把物体对齐到地面。',
    minutes: 30,
    icon: '🏠',
    reward: '小屋徽章',
    available: true,
    palette: ['box', 'cone'],
    starterShapes: [starter('house-body', '房子', 'box', '#ffb45c', vec(0, 1.25, 0), vec(2.4, 2.5, 2.2))],
    tasks: [
      { id: 'house-parts', label: '把屋顶放到房子上方' },
      { id: 'rotate', label: '旋转一次屋顶' },
      { id: 'align', label: '让房子使用一次“落到地面”' },
    ],
    tip: '圆锥也可以做屋顶。选中它，试试旋转或改变大小。',
  },
  {
    id: 3,
    title: '机器人朋友',
    shortTitle: '机器人朋友',
    subtitle: '复制 · 组合',
    story: '造物岛需要一位新帮手。给机器人装上成对的手臂和腿，再把零件组合起来。',
    objective: '用复制制造相同零件，并完成第一次组合。',
    minutes: 35,
    icon: '🤖',
    reward: '机器人徽章',
    available: true,
    palette: ['box', 'sphere', 'cylinder'],
    starterShapes: [
      starter('robot-body', '身体', 'box', '#5b9dff', vec(0, 1.7, 0), vec(2.2, 2.6, 1.3)),
      starter('robot-head', '脑袋', 'box', '#80c6ff', vec(0, 3.7, 0), vec(1.7, 1.4, 1.3)),
    ],
    tasks: [
      { id: 'robot-parts', label: '机器人至少有六个零件' },
      { id: 'duplicate', label: '使用“复制”制造相同零件' },
      { id: 'group', label: '把所有零件组合起来' },
    ],
    tip: '先做一只手臂，再复制它，比从头再做一次更快。',
  },
  {
    id: 4,
    title: '会挖洞的奶酪',
    shortTitle: '奶酪隧道',
    subtitle: '挖孔 · 分组',
    story: '小老鼠找不到回家的路。给奶酪加上三个圆柱，把它们变成洞，再组合出隧道。',
    objective: '用“洞”形状从实体中减去一部分。',
    minutes: 35,
    icon: '🧀',
    reward: '奶酪徽章',
    available: true,
    palette: ['box', 'cylinder'],
    starterShapes: [starter('cheese', '奶酪', 'box', '#f4c844', vec(0, 1.8, 0), vec(5.5, 3.6, 3.2))],
    tasks: [
      { id: 'holes', label: '把三个圆柱设为空洞' },
      { id: 'rotate-holes', label: '至少旋转一个隧道' },
      { id: 'subtract', label: '点击组合，真正挖出隧道' },
    ],
    tip: '圆柱变成洞以后会半透明。让它穿过奶酪，再点击组合。',
  },
  {
    id: 5,
    title: '我的姓名牌', shortTitle: '我的姓名牌', subtitle: '文字 · 穿孔', story: '给自己的工作台做一块独一无二的姓名牌。', objective: '认识文字和穿孔。', minutes: 35, icon: '🏷️', reward: '设计师徽章', available: false, palette: ['box'], tasks: [], tip: '即将开放。',
  },
  {
    id: 6,
    title: '不会漏水的笔筒', shortTitle: '神奇笔筒', subtitle: '中空 · 壁厚', story: '造一个能装下彩笔的笔筒。', objective: '理解内部空间和壁厚。', minutes: 35, icon: '✏️', reward: '容器徽章', available: false, palette: ['cylinder'], tasks: [], tip: '即将开放。',
  },
  {
    id: 7,
    title: '跨河小桥', shortTitle: '跨河小桥', subtitle: '支撑 · 结构', story: '帮助小动物跨过造物河。', objective: '理解支撑和稳定。', minutes: 40, icon: '🌉', reward: '工程师徽章', available: false, palette: ['box', 'cylinder'], tasks: [], tip: '即将开放。',
  },
  {
    id: 8,
    title: '迷你家具屋', shortTitle: '迷你家具', subtitle: '尺寸 · 比例', story: '为小熊布置一间迷你房间。', objective: '建立尺寸和比例意识。', minutes: 40, icon: '🪑', reward: '空间徽章', available: false, palette: ['box', 'cylinder'], tasks: [], tip: '即将开放。',
  },
  {
    id: 9,
    title: '秘密盒子', shortTitle: '秘密盒子', subtitle: '间隙 · 装配', story: '做一个能打开又能合上的秘密盒。', objective: '理解零件之间需要间隙。', minutes: 40, icon: '🎁', reward: '装配徽章', available: false, palette: ['box'], tasks: [], tip: '即将开放。',
  },
  {
    id: 10,
    title: '旋转花园', shortTitle: '旋转花园', subtitle: '角度 · 重复', story: '让花瓣围着中心整齐开放。', objective: '认识角度、重复和对称。', minutes: 40, icon: '🌻', reward: '规律徽章', available: false, palette: ['sphere', 'cylinder'], tasks: [], tip: '即将开放。',
  },
  {
    id: 11,
    title: '修理失败作品', shortTitle: '修理大师', subtitle: '检查 · 修改', story: '找出模型里的三个问题并修好它们。', objective: '训练诊断和迭代。', minutes: 40, icon: '🛠️', reward: '修理大师徽章', available: false, palette: ['box', 'sphere', 'cylinder'], tasks: [], tip: '即将开放。',
  },
  {
    id: 12,
    title: '造物岛大挑战', shortTitle: '发明家挑战', subtitle: '想法 · 作品', story: '设计一个属于自己的玩具，并完成第二版。', objective: '完成观察、设计、制作和修改的完整过程。', minutes: 45, icon: '🏆', reward: '小小发明家徽章', available: false, palette: ['box', 'sphere', 'cylinder', 'cone'], tasks: [], tip: '即将开放。',
  },
]

const hasOperation = (operations: { type: string; shapeId?: string }[], type: string, shapeIds?: Set<string>) =>
  operations.some((operation) => operation.type === type && (!shapeIds || (operation.shapeId ? shapeIds.has(operation.shapeId) : false)))

type Point = { x: number; y: number; z: number }

function rotationMatrix(rotation: Point) {
  const a = Math.cos(rotation.x)
  const b = Math.sin(rotation.x)
  const c = Math.cos(rotation.y)
  const d = Math.sin(rotation.y)
  const e = Math.cos(rotation.z)
  const f = Math.sin(rotation.z)
  return [
    [c * e, -c * f, d],
    [a * f + b * e * d, a * e - b * f * d, -b * c],
    [b * f - a * e * d, b * e + a * f * d, a * c],
  ]
}

function rotate(point: Point, matrix: number[][]): Point {
  return {
    x: matrix[0][0] * point.x + matrix[0][1] * point.y + matrix[0][2] * point.z,
    y: matrix[1][0] * point.x + matrix[1][1] * point.y + matrix[1][2] * point.z,
    z: matrix[2][0] * point.x + matrix[2][1] * point.y + matrix[2][2] * point.z,
  }
}

function inverseRotate(point: Point, matrix: number[][]): Point {
  return {
    x: matrix[0][0] * point.x + matrix[1][0] * point.y + matrix[2][0] * point.z,
    y: matrix[0][1] * point.x + matrix[1][1] * point.y + matrix[2][1] * point.z,
    z: matrix[0][2] * point.x + matrix[1][2] * point.y + matrix[2][2] * point.z,
  }
}

function cylinderAxis(hole: ModelShape) {
  return rotate({ x: 0, y: 1, z: 0 }, rotationMatrix(hole.rotation))
}

export function tunnelsAreDistinct(holes: ModelShape[]) {
  return holes.every((hole, index) => holes.slice(index + 1).every((other) => {
    const firstAxis = cylinderAxis(hole)
    const secondAxis = cylinderAxis(other)
    const parallel = Math.abs(
      firstAxis.x * secondAxis.x + firstAxis.y * secondAxis.y + firstAxis.z * secondAxis.z,
    ) > 0.985
    if (!parallel) return true

    const delta = {
      x: hole.position.x - other.position.x,
      y: hole.position.y - other.position.y,
      z: hole.position.z - other.position.z,
    }
    const perpendicularDistance = Math.hypot(
      delta.y * firstAxis.z - delta.z * firstAxis.y,
      delta.z * firstAxis.x - delta.x * firstAxis.z,
      delta.x * firstAxis.y - delta.y * firstAxis.x,
    )
    const firstRadius = Math.max(hole.scale.x, hole.scale.z) / 2
    const secondRadius = Math.max(other.scale.x, other.scale.z) / 2
    return perpendicularDistance >= firstRadius + secondRadius - 1e-6
  }))
}

/**
 * Checks the finite cylinder centre-line against two opposite faces of the
 * cheese in cheese-local coordinates. Requiring both exit points to sit
 * safely inside their faces rejects holes that merely clip adjacent edges.
 */
export function holePassesThroughBase(base: ModelShape, hole: ModelShape) {
  if (base.type !== 'box' || hole.type !== 'cylinder') return false
  const holeAxis = cylinderAxis(hole)
  const halfLength = hole.scale.y / 2
  const endpoints = [-1, 1].map((sign) => ({
    x: hole.position.x + holeAxis.x * halfLength * sign,
    y: hole.position.y + holeAxis.y * halfLength * sign,
    z: hole.position.z + holeAxis.z * halfLength * sign,
  }))
  const baseRotation = rotationMatrix(base.rotation)
  const local = endpoints.map((point) => {
    const unrotated = inverseRotate({
      x: point.x - base.position.x,
      y: point.y - base.position.y,
      z: point.z - base.position.z,
    }, baseRotation)
    return {
      x: unrotated.x / base.scale.x,
      y: unrotated.y / base.scale.y,
      z: unrotated.z / base.scale.z,
    }
  })
  const axes = ['x', 'y', 'z'] as const
  const radius = Math.max(hole.scale.x, hole.scale.z) / 2

  return axes.some((axis) => {
    const start = local[0][axis]
    const end = local[1][axis]
    if (!((start <= -0.5 && end >= 0.5) || (end <= -0.5 && start >= 0.5))) return false
    const delta = end - start
    if (Math.abs(delta) < 1e-8) return false
    const crossings = [-0.5, 0.5].map((face) => (face - start) / delta)
    return axes.filter((other) => other !== axis).every((other) => {
      const safeHalfFace = 0.5 - radius / base.scale[other]
      if (safeHalfFace <= 0) return false
      return crossings.every((t) => {
        const coordinate = local[0][other] + (local[1][other] - local[0][other]) * t
        return Math.abs(coordinate) <= safeHalfFace
      })
    })
  })
}

export function evaluateQuest(questId: number, shapes: ModelShape[], operations: { type: string; shapeId?: string }[]): TaskEvaluation[] {
  if (questId === 1) {
    const types = new Set(shapes.filter((shape) => !shape.isHole).map((shape) => shape.type))
    return [
      { taskId: 'three-types', complete: ['box', 'sphere', 'cylinder'].every((type) => types.has(type as PrimitiveType)) },
      { taskId: 'move', complete: hasOperation(operations, 'move') },
      { taskId: 'scale', complete: hasOperation(operations, 'scale') },
    ]
  }

  if (questId === 2) {
    const body = shapes.find((shape) => shape.type === 'box')
    const roofs = shapes.filter((shape) => shape.type === 'cone')
    const roofIds = new Set(roofs.map((shape) => shape.id))
    const bodyIds = new Set(body ? [body.id] : [])
    const roofOnHouse = Boolean(body && roofs.some((roof) => (
      roof.position.y > body.position.y + body.scale.y * 0.35
      && Math.abs(roof.position.x - body.position.x) <= body.scale.x * 0.55
      && Math.abs(roof.position.z - body.position.z) <= body.scale.z * 0.55
    )))
    return [
      { taskId: 'house-parts', complete: roofOnHouse },
      { taskId: 'rotate', complete: hasOperation(operations, 'rotate', roofIds) },
      { taskId: 'align', complete: hasOperation(operations, 'align', bodyIds) },
    ]
  }

  if (questId === 3) {
    return [
      { taskId: 'robot-parts', complete: shapes.length >= 6 },
      { taskId: 'duplicate', complete: hasOperation(operations, 'duplicate') },
      { taskId: 'group', complete: shapes.length >= 6 && shapes.every((shape) => shape.grouped === true) },
    ]
  }

  if (questId === 4) {
    const liveHoles = shapes.filter((shape) => shape.isHole).length
    const cheese = shapes.find((shape) => shape.id === 'cheese')
    const appliedHoles = cheese?.holes ?? []
    const appliedHoleIds = new Set(appliedHoles.map((hole) => hole.id))
    const validTunnels = Boolean(
      cheese
      && !cheese.isHole
      && appliedHoles.length >= 3
      && appliedHoles.every((hole) => hole.type === 'cylinder' && holePassesThroughBase(cheese, hole))
      && tunnelsAreDistinct(appliedHoles),
    )
    return [
      { taskId: 'holes', complete: liveHoles + appliedHoles.length >= 3 },
      { taskId: 'rotate-holes', complete: hasOperation(operations, 'rotate', new Set([...appliedHoleIds, ...shapes.filter((shape) => shape.isHole).map((shape) => shape.id)])) },
      { taskId: 'subtract', complete: validTunnels && hasOperation(operations, 'group', new Set(['cheese'])) },
    ]
  }

  return []
}

import type {
  ModelShape,
  OperationRecord,
  PrimitiveType,
  Quest,
  QuestStep,
  TaskEvaluation,
  Vector3Value,
} from './types'

const vec = (x: number, y: number, z: number): Vector3Value => ({ x, y, z })

const shape = (
  id: string,
  name: string,
  type: PrimitiveType,
  color: string,
  position = vec(0, 0.7, 0),
  scale = vec(1.4, 1.4, 1.4),
  rotation = vec(0, 0, 0),
): ModelShape => ({ id, name, type, color, position, rotation, scale })

const step = (taskId: string, title: string, instruction: string, tools: QuestStep['tools'], hints: string[]): QuestStep => ({
  id: taskId,
  taskId,
  title,
  instruction,
  tools,
  hints,
})

const safeTools: Quest['allowedTools'] = ['select', 'undo', 'redo', 'delete', 'reset', 'view-reset', 'check']

export const quests: Quest[] = [
  {
    id: 1, worldId: 1, skillId: 'shape-decomposition', title: '形状侦探', shortTitle: '形状侦探', subtitle: '认出基本形状',
    story: '港口来了三件神秘物品。找出能组成它们的基本形状。', objective: '把物体拆成基本形状', minutes: 10,
    icon: '🔎', reward: '形状侦探徽章', available: true, palette: ['box', 'sphere', 'cylinder', 'cone'], starterShapes: [], targetShapes: [],
    tasks: [{ id: 'find-round', label: '为雪人找到球体' }, { id: 'find-tall', label: '为杯子找到圆柱' }, { id: 'find-point', label: '为冰淇淋找到圆锥' }],
    steps: [
      step('find-round', '雪人的身体是什么形状？', '从右边加入一个球体。', ['sphere'], ['雪人的身体是圆滚滚的。', '找没有棱角的形状。', '点击“加入球体”。']),
      step('find-tall', '杯身是什么形状？', '加入一个圆柱，看看它平平的顶部。', ['cylinder'], ['杯身上下都有圆面。', '找又高又圆的形状。', '点击“加入圆柱”。']),
      step('find-point', '甜筒是什么形状？', '最后加入一个圆锥。', ['cone'], ['甜筒一头尖、一头圆。', '找像小山一样的形状。', '点击“加入圆锥”。']),
    ],
    allowedTools: safeTools, constraints: [{ id: 'basic-types', label: '三种基本形状', kind: 'required-types', value: ['sphere', 'cylinder', 'cone'] }],
    hints: ['先观察物体是圆的、方的还是尖的。', '比较每个形状的边和面。', '按当前任务只加入亮起的形状。'], tip: '每完成一个形状，下一张侦探卡会自动出现。', timingMode: 'hidden',
  },
  {
    id: 2, worldId: 1, skillId: 'move', title: '方块回家', shortTitle: '方块回家', subtitle: '左右、上下、前后',
    story: '小方块迷路了。把它送进淡蓝色的家。', objective: '移动', minutes: 12, icon: '📦', reward: '方向徽章', available: true,
    palette: ['box'], starterShapes: [shape('moving-block', '迷路方块', 'box', '#ff9b56', vec(-2.5, 0.75, -0.5))],
    targetShapes: [shape('target-block', '方块的家', 'box', '#65c9e8', vec(2, 0.75, -1.5))],
    tasks: [{ id: 'move-sideways', label: '先移动到目标的左右位置' }, { id: 'move-home', label: '完整进入目标区' }],
    steps: [
      step('move-sideways', '先向右移动', '选中方块，把它移动到淡蓝目标的正下方。', ['move'], ['先只看左右距离。', '方块要向右走。', '点“向右”，也可以拖动红色控制柄。']),
      step('move-home', '再调整前后位置', '继续移动，让橙色方块完整进入淡蓝目标。', ['move'], ['转动视角看看前后距离。', '目标中心在方块的右前方。', '使用“向前/向后”微调，直到轮廓重合。']),
    ],
    allowedTools: [...safeTools, 'move'], constraints: [{ id: 'home', label: '进入目标区', kind: 'position', targetShapeId: 'moving-block', value: vec(2, 0.75, -1.5), tolerance: 0.36 }],
    hints: ['先比较左右，再比较前后。', '淡蓝轮廓就是方块的家。', '每次移动一小格，更容易对准。'], tip: '前五关不用记字母轴，只看左右、上下、前后。', timingMode: 'hidden',
  },
  {
    id: 3, worldId: 1, skillId: 'scale', title: '大小魔法', shortTitle: '大小魔法', subtitle: '变大与变小',
    story: '绿色积木要穿上淡蓝色外套。把它调成正合适的大小。', objective: '缩放', minutes: 12, icon: '🪄', reward: '大小魔法徽章', available: true,
    palette: ['box'], starterShapes: [shape('scale-block', '绿色积木', 'box', '#56bb85', vec(0, 0.75, 0), vec(0.75, 0.75, 0.75))],
    targetShapes: [shape('target-scale', '目标外套', 'box', '#65c9e8', vec(0, 0.75, 0), vec(1.5, 1.5, 1.5))],
    tasks: [{ id: 'scale-width', label: '把积木变宽' }, { id: 'scale-fit', label: '让三个方向都贴合轮廓' }],
    steps: [
      step('scale-width', '先把积木变大', '使用变大工具，让积木的宽度接近目标。', ['scale'], ['现在的积木太小。', '先连续变大几次。', '点击“变大”，观察两侧距离。']),
      step('scale-fit', '贴合整个轮廓', '继续调整大小，直到三个方向都接近淡蓝轮廓。', ['scale'], ['旋转视角检查深度。', '不要只看正面。', '从斜上方看，确认没有明显露出或空隙。']),
    ],
    allowedTools: [...safeTools, 'scale'], constraints: [{ id: 'fit-size', label: '贴合轮廓', kind: 'dimensions', targetShapeId: 'scale-block', value: vec(1.5, 1.5, 1.5), tolerance: 0.08 }],
    hints: ['先判断太大还是太小。', '从不同方向检查。', '用变大和变小逐步靠近。'], tip: '接近目标时一次只调一点。', timingMode: 'hidden',
  },
  {
    id: 4, worldId: 1, skillId: 'rotate', title: '屋顶转正', shortTitle: '屋顶转正', subtitle: '认识旋转',
    story: '风把屋顶吹歪了。只用旋转把它端端正正地放回去。', objective: '旋转', minutes: 12, icon: '🏠', reward: '旋转徽章', available: true,
    palette: ['cone'], starterShapes: [shape('roof', '歪屋顶', 'cone', '#f36e79', vec(0, 2, 0), vec(2.4, 1.8, 2.4), vec(0, 0, -Math.PI / 6))],
    targetShapes: [shape('target-roof', '正确屋顶', 'cone', '#65c9e8', vec(0, 2, 0), vec(2.4, 1.8, 2.4))],
    tasks: [{ id: 'roof-upright', label: '把屋顶转到正确角度' }],
    steps: [step('roof-upright', '把屋顶转正', '选中屋顶，点击一次“转一下”。', ['rotate'], ['屋顶向左歪了。', '要向相反方向转回来。', '点击右边的“转一下”。'])],
    allowedTools: [...safeTools, 'rotate'], constraints: [{ id: 'upright', label: '屋顶角度正确', kind: 'rotation', targetShapeId: 'roof', value: vec(0, 0, 0), tolerance: 3, unit: 'degree' }],
    hints: ['看屋顶尖端是否在中间。', '比较红色屋顶和蓝色轮廓。', '旋转一次是 30 度。'], tip: '最终角度正确才算通过，不是点过按钮就算。', reflectionPrompt: '用 20 秒说说：我认出了哪些形状？', timingMode: 'hidden',
  },
  {
    id: 5, worldId: 2, skillId: 'align', title: '整齐书架', shortTitle: '整齐书架', subtitle: '找到共同基准',
    story: '三块书架隔板高高低低。让它们的底部排成一条直线。', objective: '对齐', minutes: 15, icon: '📚', reward: '整齐徽章', available: true,
    palette: ['box'], starterShapes: [
      shape('shelf-left', '左隔板', 'box', '#f4c844', vec(-2, 1.4, 0), vec(1, 1, 2)),
      shape('shelf-middle', '中隔板', 'box', '#60b8ff', vec(0, 2, 0), vec(1, 1, 2)),
      shape('shelf-right', '右隔板', 'box', '#9b7cf6', vec(2, 0.9, 0), vec(1, 1, 2)),
    ],
    targetShapes: [-2, 0, 2].map((x, index) => shape(`target-shelf-${index}`, '目标隔板', 'box', '#65c9e8', vec(x, 0.5, 0), vec(1, 1, 2))),
    tasks: [{ id: 'align-left', label: '让左隔板落到底线' }, { id: 'align-middle', label: '让中隔板落到底线' }, { id: 'align-all', label: '三块隔板真正对齐' }],
    steps: [
      step('align-left', '先整理左隔板', '从“当前选中”选择左隔板，点击“稳稳落地”。', ['align'], ['先处理左边黄色隔板。', '底部要碰到地面。', '选择左隔板后点击“稳稳落地”。']),
      step('align-middle', '再整理中隔板', '选择中间蓝色隔板，让它落到同一底线。', ['align'], ['中间隔板还悬着。', '用相同的对齐办法。', '选择中隔板后点击“稳稳落地”。']),
      step('align-all', '完成整齐书架', '最后让右隔板也和前两块底部对齐。', ['align'], ['还要检查紫色隔板。', '三块底部应该在同一直线。', '选择右隔板后点击“稳稳落地”。']),
    ],
    allowedTools: [...safeTools, 'align'], constraints: [{ id: 'aligned', label: '底部对齐', kind: 'grounded', tolerance: 0.08 }],
    hints: ['对齐要先找共同基准。', '这一关的共同基准是地面。', '依次选择三个隔板并落地。'], tip: '对齐检查的是最后位置。', timingMode: 'hidden',
  },
  {
    id: 6, worldId: 2, skillId: 'precision-size', title: '尺寸密码', shortTitle: '尺寸密码', subtitle: '毫米与精确尺寸',
    story: '尺寸卡写着 12 × 8 × 5 毫米。输入准确数字打开工坊门。', objective: '毫米和精确尺寸', minutes: 18, icon: '📏', reward: '毫米徽章', available: true,
    palette: ['box'], starterShapes: [shape('size-block', '密码积木', 'box', '#ff9b56', vec(0, 4, 0), vec(10, 8, 6))],
    targetShapes: [shape('target-size', '尺寸卡目标', 'box', '#65c9e8', vec(0, 4, 0), vec(12, 8, 5))],
    tasks: [{ id: 'size-x', label: '把 X 尺寸设为 12 毫米' }, { id: 'size-z', label: '把 Z 尺寸设为 5 毫米' }],
    steps: [
      step('size-x', '输入长度 12', '第六关开始认识 X/Y/Z。把 X 改成 12。', ['size-input'], ['X 表示左右方向的长度。', '尺寸卡第一个数字是 12。', '在 X 输入框填写 12。']),
      step('size-z', '输入深度 5', 'Y 已经是 8；现在把 Z 改成 5。', ['size-input'], ['Z 表示前后方向的深度。', '尺寸卡第三个数字是 5。', '在 Z 输入框填写 5。']),
    ],
    allowedTools: [...safeTools, 'size-input', 'scale'], constraints: [{ id: 'exact-size', label: '12×8×5毫米', kind: 'dimensions', targetShapeId: 'size-block', value: vec(12, 8, 5), tolerance: 0.05, unit: 'mm' }],
    hints: ['按 X、Y、Z 顺序读尺寸卡。', '数字输入比拖动更精确。', '目标是 12、8、5。'], tip: '从这一关开始才使用 X/Y/Z。', timingMode: 'hidden',
  },
  {
    id: 7, worldId: 2, skillId: 'duplicate', title: '双臂机器人', shortTitle: '双臂机器人', subtitle: '复制出左右对称',
    story: '机器人只有一只手臂。复制同样的零件，再把双臂摆成左右对称。', objective: '复制', minutes: 18, icon: '🤖', reward: '复制徽章', available: true,
    palette: ['box'], starterShapes: [
      shape('robot-body', '身体', 'box', '#60b8ff', vec(0, 1.8, 0), vec(2, 3, 1.5)),
      shape('robot-head', '脑袋', 'box', '#80c6ff', vec(0, 3.8, 0), vec(1.5, 1, 1.3)),
      shape('left-arm', '左臂', 'box', '#f4c844', vec(-1.5, 2, 0), vec(0.7, 2, 0.7)),
    ],
    targetShapes: [
      shape('target-left-arm', '左臂目标', 'box', '#65c9e8', vec(-1.5, 2, 0), vec(0.7, 2, 0.7)),
      shape('target-right-arm', '右臂目标', 'box', '#65c9e8', vec(1.5, 2, 0), vec(0.7, 2, 0.7)),
    ],
    tasks: [{ id: 'copy-arm', label: '复制出相同手臂' }, { id: 'symmetric-arms', label: '完成左右对称' }],
    steps: [
      step('copy-arm', '复制左臂', '选择黄色左臂，点击“复制一个”。', ['duplicate'], ['不要重新添加一个方块。', '复制能保留完全相同的尺寸。', '选择左臂后点击“复制一个”。']),
      step('symmetric-arms', '把复制品送到右边', '移动复制出的手臂，让它与左臂左右对称。', ['move'], ['两只手臂离身体中心要一样远。', '复制品需要继续向右。', '使用“向右”直到淡蓝轮廓重合。']),
    ],
    allowedTools: [...safeTools, 'duplicate', 'move'], constraints: [{ id: 'arms', label: '双臂对称', kind: 'symmetry', tolerance: 0.2 }],
    hints: ['先复制，再移动复制品。', '相同尺寸是复制的重要证据。', '两边到中心的距离要相同。'], tip: '最终对称比是否点过复制更重要。', timingMode: 'hidden',
  },
  {
    id: 8, worldId: 2, skillId: 'boolean-hole', title: '奶酪隧道', shortTitle: '奶酪隧道', subtitle: '真正贯通的孔洞',
    story: '小老鼠需要三条不同的隧道。让圆柱穿过奶酪，再真正挖掉它们。', objective: '挖孔', minutes: 18, icon: '🧀', reward: '隧道徽章', available: true,
    palette: ['box', 'cylinder'], starterShapes: [shape('cheese', '奶酪', 'box', '#f4c844', vec(0, 1.8, 0), vec(5.5, 3.6, 3.2))], targetShapes: [],
    tasks: [{ id: 'prepare-holes', label: '准备三个分开的贯通圆柱' }, { id: 'cut-tunnels', label: '真正挖出三条隧道' }],
    steps: [
      step('prepare-holes', '准备三条隧道', '依次加入圆柱、设为空洞并转成横向；三个洞要分开。', ['cylinder', 'hole', 'rotate', 'move'], ['每个圆柱都要横穿奶酪。', '三个圆柱不能叠在一起。', '加入后设为空洞、转成横向，重复三次。']),
      step('cut-tunnels', '真正挖掉圆柱', '三个洞摆好后，点击“完成挖孔”。', ['group'], ['先从不同角度检查。', '每个洞都要从一边穿到另一边。', '点击“完成挖孔”。']),
    ],
    allowedTools: [...safeTools, 'hole', 'rotate', 'move', 'group'], constraints: [{ id: 'tunnels', label: '三条贯通且不重叠的孔洞', kind: 'boolean-hole', min: 3 }],
    hints: ['圆柱要先变成半透明空洞。', '转横后放进奶酪中间。', '三个孔分开并贯通后再组合。'], tip: '系统检查真正的洞穿与重叠。', reflectionPrompt: '选三张过程图，说清任务、办法和修改。', timingMode: 'hidden',
  },
  {
    id: 9, worldId: 3, skillId: 'wall-thickness', title: '彩笔之家', shortTitle: '彩笔之家', subtitle: '顶部开口、底部封闭',
    story: '给彩笔造一个站得稳的家。内芯要挖空，但不能把底部挖穿。', objective: '壁厚', minutes: 20, icon: '🖍️', reward: '壁厚徽章', available: true,
    palette: ['cylinder'], starterShapes: [
      shape('pen-cup', '笔筒外壳', 'cylinder', '#9b7cf6', vec(0, 3, 0), vec(5, 6, 5)),
      shape('cup-core', '笔筒内芯', 'cylinder', '#71d6e8', vec(0, 3.3, 0), vec(3.8, 5.4, 3.8)),
    ], targetShapes: [],
    tasks: [{ id: 'make-core-hole', label: '把内芯设为空洞' }, { id: 'make-cup', label: '挖出顶部开口、底部封闭的笔筒' }],
    steps: [
      step('make-core-hole', '把内芯变成空洞', '选择“笔筒内芯”，点击“设为空洞”。', ['hole'], ['外壳要保留实体。', '内芯是较细的圆柱。', '选择内芯后点击“设为空洞”。']),
      step('make-cup', '完成安全壁厚', '确认内芯顶部露出、底部没有穿透，然后点击“完成挖孔”。', ['move', 'scale', 'group'], ['从侧面看内芯底部。', '四周至少留出明显的壁。', '位置正确后点击“完成挖孔”。']),
    ],
    allowedTools: [...safeTools, 'hole', 'move', 'scale', 'group'], constraints: [{ id: 'wall', label: '壁厚与封底合格', kind: 'wall-thickness', min: 0.5 }],
    hints: ['内芯比外壳更细。', '顶部要打开，底部要留住。', '内芯底面应高于外壳底面。'], tip: '本关只记录完成时间，不显示倒计时。',
    practice: { id: 'q9-wall-variation', title: '变式小挑战：比较壁厚', instruction: '把笔筒外壳变大或变小一次，观察四周壁厚怎样变化。', tools: ['scale'], operationTypes: ['scale'] },
    timingMode: 'recorded',
  },
  {
    id: 10, worldId: 3, skillId: 'print-check', title: '打印前体检', shortTitle: '打印前体检', subtitle: '检查并修复',
    story: '模型里藏着漂浮和过薄的问题。像工程师一样逐项修好。', objective: '检查与修复', minutes: 20, icon: '🩺', reward: '体检徽章', available: true,
    palette: ['box'], starterShapes: [
      shape('print-base', '打印底座', 'box', '#56bb85', vec(0, 0.3, 0), vec(4, 0.6, 2.5)),
      shape('floating-part', '漂浮零件', 'box', '#60b8ff', vec(0, 2, 0), vec(1.2, 1.2, 1.2)),
      shape('thin-part', '过薄零件', 'box', '#f36e79', vec(1.3, 0.9, 0), vec(0.25, 1.2, 1)),
    ],
    targetShapes: [
      shape('target-base', '底座目标', 'box', '#65c9e8', vec(0, 0.3, 0), vec(4, 0.6, 2.5)),
      shape('target-floating', '蓝色零件目标', 'box', '#65c9e8', vec(0, 0.9, 0), vec(1.2, 1.2, 1.2)),
      shape('target-thin', '红色零件目标', 'box', '#65c9e8', vec(1.3, 0.9, 0), vec(0.65, 1.2, 1)),
    ],
    tasks: [{ id: 'fix-thin', label: '把过薄零件修到安全厚度' }, { id: 'fix-floating', label: '修好漂浮或未连接零件' }, { id: 'print-ready', label: '通过完整打印体检' }],
    steps: [
      step('fix-thin', '先修过薄零件', '选择红色零件，用精确尺寸或缩放把最薄处调到至少 0.6。', ['size-input', 'scale'], ['红色零件最薄。', 'X 尺寸只有 0.25。', '把 X 改成 0.65。']),
      step('fix-floating', '再修漂浮零件', '选择蓝色零件，把它移到与底座接触。', ['move', 'align'], ['蓝色零件下面有空隙。', '它需要接触底座或地面。', '把它向下移动或使用“稳稳落地”。']),
      step('print-ready', '完成打印体检', '检查所有实体都不漂浮、不太薄，并彼此连接。', ['move', 'scale', 'align'], ['转一圈检查接触面。', '每个零件都要能连到底座。', '根据下方反馈完成最后微调。']),
    ],
    allowedTools: [...safeTools, 'size-input', 'move', 'scale', 'align'], constraints: [{ id: 'printable', label: '无漂浮、过薄、未连接', kind: 'printability', min: 0.6 }],
    hints: ['先找红色的薄零件。', '再找悬在空中的蓝色零件。', '最后检查所有零件是否相连。'], tip: '本关记录时间，但不会催促孩子。', timingMode: 'recorded',
  },
  {
    id: 11, worldId: 3, skillId: 'read-brief', title: '现场命题', shortTitle: '现场命题', subtitle: '读任务书并规划',
    story: '任务书要求：做一个至少三件零件、包含方块和圆柱、能稳稳落地的路标。', objective: '读任务书并规划', minutes: 25, icon: '📝', reward: '规划徽章', available: true,
    palette: ['box', 'cylinder'], starterShapes: [
      shape('brief-base', '路标底座', 'box', '#56bb85', vec(0, 0.35, 0), vec(3, 0.7, 2)),
      shape('brief-post', '路标柱', 'cylinder', '#f4c844', vec(0, 1.7, 0), vec(0.8, 2.7, 0.8)),
    ], targetShapes: [],
    tasks: [{ id: 'make-plan', label: '确认三步计划' }, { id: 'brief-parts', label: '满足零件与形状要求' }, { id: 'brief-result', label: '完成稳固路标' }],
    steps: [
      step('make-plan', '先做三步计划', '读完必做项，确认：搭主体—补零件—检查修改。', ['plan'], ['先圈出“至少三件”。', '再圈出“方块、圆柱、落地”。', '点击“确认三步计划”。']),
      step('brief-parts', '按计划补齐零件', '加入第三个方块或圆柱，让作品满足任务书。', ['box', 'cylinder', 'move', 'scale'], ['现在只有两件零件。', '新零件也要属于路标。', '加入一个形状并移到主体旁。']),
      step('brief-result', '最后检查和修改', '让所有零件稳固连接，完成现场命题。', ['move', 'scale', 'align'], ['先检查有没有漂浮。', '再检查新零件是否连着主体。', '根据反馈做最后调整。']),
    ],
    allowedTools: [...safeTools, 'plan', 'move', 'scale', 'align'], constraints: [{ id: 'brief', label: '满足任务书必做项', kind: 'brief', min: 3 }],
    hints: ['任务、办法、修改各说一句。', '计划不会替代最终作品检查。', '完成后准备 30～60 秒说明。'], tip: '计时可以随时关闭。', reflectionPrompt: '用 30～60 秒说明任务、办法和修改。', timingMode: 'optional',
  },
  {
    id: 12, worldId: 3, skillId: 'capstone', title: '发明家总决赛', shortTitle: '发明家总决赛', subtitle: '综合解决生活问题',
    story: '设计一个桌面收纳发明：至少四件零件、两种形状，结构稳固并组合成完整作品。', objective: '综合运用', minutes: 45, icon: '🏆', reward: '小小发明家徽章', available: true,
    palette: ['box', 'sphere', 'cylinder', 'cone'], starterShapes: [], targetShapes: [],
    tasks: [{ id: 'capstone-parts', label: '使用至少四件零件和两种形状' }, { id: 'capstone-stable', label: '让结构稳固连接' }, { id: 'capstone-finish', label: '组合成完整发明' }],
    steps: [
      step('capstone-parts', '先搭出发明主体', '加入至少四件零件，并使用至少两种基本形状。', ['box', 'sphere', 'cylinder', 'cone'], ['先想清要收纳什么。', '主体可以用方块或圆柱。', '连续加入四件零件，其中至少两种形状不同。']),
      step('capstone-stable', '调整成稳固结构', '移动、缩放或旋转，让零件相互接触并站稳。', ['move', 'scale', 'rotate', 'align'], ['从底部开始检查。', '零件之间不能有明显空隙。', '把散开的零件移近主体。']),
      step('capstone-finish', '完成最终发明', '确认作品后点击“组合成作品”。', ['group'], ['先转一圈做最后检查。', '组合前仍可撤销修改。', '点击“组合成作品”。']),
    ],
    allowedTools: [...safeTools, 'move', 'scale', 'rotate', 'align', 'group', 'color', 'export'],
    constraints: [{ id: 'capstone', label: '完整稳固发明', kind: 'brief', min: 4 }],
    hints: ['只综合已经学过的本领。', '先解决使用问题，再考虑颜色。', '系统只检查技术要求，创意由家长或老师点评。'], tip: '计时温和显示并可关闭。', reflectionPrompt: '介绍主题、创意、实用性和一次修改。', timingMode: 'optional',
  },
]

/** Optional post-course prompts kept outside the 12-step foundational path. */
export const creativeExpansionItems = [
  { title: '我的姓名牌', skill: '文字与穿孔', icon: '🏷️' },
  { title: '跨河小桥', skill: '支撑与结构', icon: '🌉' },
  { title: '秘密盒子', skill: '装配间隙', icon: '🎁' },
  { title: '旋转花园', skill: '角度与重复', icon: '🌻' },
  { title: '镜像实验', skill: '镜像', icon: '🪞' },
  { title: '阵列工坊', skill: '阵列', icon: '🔷' },
  { title: '装配实验室', skill: '装配间隙', icon: '⚙️' },
  { title: 'BlocksCAD 循环', skill: '循环思维', icon: '🧩' },
] as const

type Point = Vector3Value

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance
const hasOperation = (operations: Pick<OperationRecord, 'type'>[], type: OperationRecord['type']) => operations.some((item) => item.type === type)
const success = (taskId: string, complete: boolean, feedback: string, successMessage?: string): TaskEvaluation => ({ taskId, complete, feedback: complete ? undefined : feedback, successMessage: complete ? successMessage : undefined })
const bottom = (item: ModelShape) => item.position.y - item.scale.y / 2
const top = (item: ModelShape) => item.position.y + item.scale.y / 2

function rotationMatrix(rotation: Point) {
  const a = Math.cos(rotation.x); const b = Math.sin(rotation.x)
  const c = Math.cos(rotation.y); const d = Math.sin(rotation.y)
  const e = Math.cos(rotation.z); const f = Math.sin(rotation.z)
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
  return rotate(vec(0, 1, 0), rotationMatrix(hole.rotation))
}

export function tunnelsAreDistinct(holes: ModelShape[]) {
  return holes.every((hole, index) => holes.slice(index + 1).every((other) => {
    const firstAxis = cylinderAxis(hole)
    const secondAxis = cylinderAxis(other)
    const parallel = Math.abs(firstAxis.x * secondAxis.x + firstAxis.y * secondAxis.y + firstAxis.z * secondAxis.z) > 0.985
    if (!parallel) return true
    const delta = vec(hole.position.x - other.position.x, hole.position.y - other.position.y, hole.position.z - other.position.z)
    const perpendicularDistance = Math.hypot(
      delta.y * firstAxis.z - delta.z * firstAxis.y,
      delta.z * firstAxis.x - delta.x * firstAxis.z,
      delta.x * firstAxis.y - delta.y * firstAxis.x,
    )
    return perpendicularDistance >= Math.max(hole.scale.x, hole.scale.z) / 2 + Math.max(other.scale.x, other.scale.z) / 2 - 1e-6
  }))
}

/** A finite cylinder must leave two opposite faces without clipping adjacent faces. */
export function holePassesThroughBase(base: ModelShape, hole: ModelShape) {
  if (base.type !== 'box' || hole.type !== 'cylinder') return false
  const holeAxis = cylinderAxis(hole)
  const halfLength = hole.scale.y / 2
  const endpoints = [-1, 1].map((sign) => vec(
    hole.position.x + holeAxis.x * halfLength * sign,
    hole.position.y + holeAxis.y * halfLength * sign,
    hole.position.z + holeAxis.z * halfLength * sign,
  ))
  const baseRotation = rotationMatrix(base.rotation)
  const local = endpoints.map((point) => {
    const unrotated = inverseRotate(vec(point.x - base.position.x, point.y - base.position.y, point.z - base.position.z), baseRotation)
    return vec(unrotated.x / base.scale.x, unrotated.y / base.scale.y, unrotated.z / base.scale.z)
  })
  const axes = ['x', 'y', 'z'] as const
  const radius = Math.max(hole.scale.x, hole.scale.z) / 2
  return axes.some((axis) => {
    const start = local[0][axis]; const end = local[1][axis]
    if (!((start <= -0.5 && end >= 0.5) || (end <= -0.5 && start >= 0.5))) return false
    const delta = end - start
    if (Math.abs(delta) < 1e-8) return false
    const crossings = [-0.5, 0.5].map((face) => (face - start) / delta)
    return axes.filter((other) => other !== axis).every((other) => {
      const safeHalfFace = 0.5 - radius / base.scale[other]
      return safeHalfFace > 0 && crossings.every((t) => Math.abs(local[0][other] + (local[1][other] - local[0][other]) * t) <= safeHalfFace)
    })
  })
}

function isHorizontalCheeseTunnel(cheese: ModelShape, hole: ModelShape) {
  return Math.abs(cylinderAxis(hole).y) <= 0.2 && holePassesThroughBase(cheese, hole)
}

function shapesTouch(first: ModelShape, second: ModelShape, tolerance = 0.12) {
  return (['x', 'y', 'z'] as const).every((axis) => (
    Math.abs(first.position[axis] - second.position[axis]) <= (first.scale[axis] + second.scale[axis]) / 2 + tolerance
  ))
}

function allConnected(shapes: ModelShape[]) {
  if (shapes.length < 2) return shapes.length === 1
  const reached = new Set([0])
  let changed = true
  while (changed) {
    changed = false
    shapes.forEach((candidate, index) => {
      if (reached.has(index)) return
      if ([...reached].some((connectedIndex) => shapesTouch(candidate, shapes[connectedIndex]))) {
        reached.add(index); changed = true
      }
    })
  }
  return reached.size === shapes.length
}

function supported(shapes: ModelShape[]) {
  return shapes.every((item, index) => bottom(item) <= 0.08 || shapes.some((support, supportIndex) => (
    index !== supportIndex
    && support.position.y < item.position.y
    && bottom(item) <= top(support) + 0.12
    && top(item) >= top(support) - 0.12
    && Math.abs(support.position.x - item.position.x) <= (support.scale.x + item.scale.x) / 2
    && Math.abs(support.position.z - item.position.z) <= (support.scale.z + item.scale.z) / 2
  )))
}

export function evaluateQuest(questId: number, shapes: ModelShape[], operations: Pick<OperationRecord, 'type' | 'shapeId'>[]): TaskEvaluation[] {
  const solids = shapes.filter((item) => !item.isHole)
  if (questId === 1) {
    const types = new Set(solids.map((item) => item.type))
    return [
      success('find-round', types.has('sphere'), '还没有找到雪人需要的球体。'),
      success('find-tall', types.has('cylinder'), '再找一个顶部平平的圆柱。'),
      success('find-point', types.has('cone'), '最后还需要尖尖的圆锥。'),
    ]
  }
  if (questId === 2) {
    const block = shapes.find((item) => item.id === 'moving-block')
    return [
      success('move-sideways', Boolean(block && near(block.position.x, 2, 0.36)), '方块还没有移动到目标的左右位置；继续向右。'),
      success('move-home', Boolean(block && near(block.position.x, 2, 0.36) && near(block.position.y, 0.75, 0.36) && near(block.position.z, -1.5, 0.36)), '方块还没有完整进入淡蓝目标；检查前后和上下距离。'),
    ]
  }
  if (questId === 3) {
    const block = shapes.find((item) => item.id === 'scale-block')
    return [
      success('scale-width', Boolean(block && block.scale.x >= 1.25), '积木宽度还不够，再变大一点。'),
      success('scale-fit', Boolean(block && near(block.scale.x, 1.5, 0.08) && near(block.scale.y, 1.5, 0.08) && near(block.scale.z, 1.5, 0.08)), '大小还没有贴合轮廓；从斜上方检查三个方向。'),
    ]
  }
  if (questId === 4) {
    const roof = shapes.find((item) => item.id === 'roof')
    return [success('roof-upright', Boolean(roof && near(Math.sin(roof.rotation.z), 0, 0.05) && Math.cos(roof.rotation.z) > 0.99), '屋顶仍然是歪的；让尖端回到正中间。')]
  }
  if (questId === 5) {
    const left = shapes.find((item) => item.id === 'shelf-left')
    const middle = shapes.find((item) => item.id === 'shelf-middle')
    const right = shapes.find((item) => item.id === 'shelf-right')
    return [
      success('align-left', Boolean(left && near(bottom(left), 0, 0.08)), '左隔板底部还没有落到地面。'),
      success('align-middle', Boolean(middle && near(bottom(middle), 0, 0.08)), '中隔板底部还没有落到同一基准。'),
      success('align-all', Boolean(left && middle && right && [left, middle, right].every((item) => near(bottom(item), 0, 0.08))), '右隔板还没有与前两块真正对齐。'),
    ]
  }
  if (questId === 6) {
    const block = shapes.find((item) => item.id === 'size-block')
    return [
      success('size-x', Boolean(block && near(block.scale.x, 12, 0.05)), 'X 尺寸还不是 12 毫米。'),
      success('size-z', Boolean(block && near(block.scale.x, 12, 0.05) && near(block.scale.y, 8, 0.05) && near(block.scale.z, 5, 0.05)), '完整尺寸应为 12 × 8 × 5 毫米。'),
    ]
  }
  if (questId === 7) {
    const arms = solids.filter((item) => item.id === 'left-arm' || item.name.includes('左臂'))
    const matchingPair = arms.some((first, index) => arms.slice(index + 1).some((second) => (
      first.type === second.type
      && (['x', 'y', 'z'] as const).every((axis) => near(first.scale[axis], second.scale[axis], 0.05))
      && near(first.position.x, -second.position.x, 0.2)
      && near(first.position.y, second.position.y, 0.2)
      && near(first.position.z, second.position.z, 0.2)
    )))
    return [
      success('copy-arm', arms.length >= 2, '还缺少第二只相同手臂；先复制左臂。'),
      success('symmetric-arms', matchingPair, '两只手臂还没有左右对称；检查尺寸和到中心的距离。'),
    ]
  }
  if (questId === 8) {
    const cheese = shapes.find((item) => item.id === 'cheese')
    const liveHoles = shapes.filter((item) => item.isHole && item.type === 'cylinder')
    const applied = cheese?.holes ?? []
    const prepared = [...applied, ...liveHoles]
    const preparedValid = Boolean(
      cheese
      && prepared.length >= 3
      && prepared.every((hole) => isHorizontalCheeseTunnel(cheese, hole))
      && tunnelsAreDistinct(prepared),
    )
    const valid = Boolean(cheese && applied.length >= 3 && applied.every((hole) => isHorizontalCheeseTunnel(cheese, hole)) && tunnelsAreDistinct(applied))
    return [
      success('prepare-holes', preparedValid, prepared.length < 3
        ? `目前只有 ${prepared.length} 个洞，还需要准备 ${Math.max(0, 3 - prepared.length)} 个。`
        : '三个洞还没有全部贯通或彼此分开；继续旋转、移动后再检查。'),
      success('cut-tunnels', valid, '隧道还未真正完成；确认三个洞都贯通、不重叠，再完成挖孔。'),
    ]
  }
  if (questId === 9) {
    const cup = shapes.find((item) => item.id === 'pen-cup')
    const liveCore = shapes.find((item) => item.id === 'cup-core' && item.isHole)
    const core = cup?.holes?.find((item) => item.id === 'cup-core')
    const validWall = Boolean(cup && core
      && (cup.scale.x - core.scale.x) / 2 >= 0.5
      && (cup.scale.z - core.scale.z) / 2 >= 0.5
      && bottom(core) - bottom(cup) >= 0.3
      && top(core) >= top(cup) - 0.08)
    return [
      success('make-core-hole', Boolean(liveCore || core), '笔筒内芯还没有设为空洞。'),
      success('make-cup', validWall, '笔筒还未合格：顶部要开口、四周有壁厚，底部至少保留 0.3。'),
    ]
  }
  if (questId === 10) {
    const thickEnough = solids.every((item) => Math.min(item.scale.x, item.scale.y, item.scale.z) >= 0.6 - 1e-6)
    const noFloating = supported(solids)
    const connected = allConnected(solids)
    return [
      success('fix-thin', thickEnough, '仍有零件小于 0.6；先把最薄方向加厚。'),
      success('fix-floating', noFloating, '仍有零件漂浮；把它向下移动到支撑面。'),
      success('print-ready', thickEnough && noFloating && connected, '打印体检未通过：检查所有零件是否相连。'),
    ]
  }
  if (questId === 11) {
    const types = new Set(solids.map((item) => item.type))
    const meetsParts = solids.length >= 3 && types.has('box') && types.has('cylinder')
    const finalResult = meetsParts && supported(solids) && allConnected(solids)
    return [
      success('make-plan', hasOperation(operations, 'plan'), '先读任务书并确认三步计划。'),
      success('brief-parts', meetsParts, '任务书要求至少三件零件，并同时包含方块和圆柱。'),
      success('brief-result', finalResult, '路标还不稳固；检查漂浮和未连接的零件。'),
    ]
  }
  if (questId === 12) {
    const types = new Set(solids.map((item) => item.type))
    const enoughParts = solids.length >= 4 && types.size >= 2
    const stable = enoughParts && supported(solids) && allConnected(solids)
    const grouped = stable && solids.every((item) => item.grouped === true)
    return [
      success('capstone-parts', enoughParts, '至少需要四件零件和两种不同形状。'),
      success('capstone-stable', stable, '作品还不稳固；让零件相互接触并能连到地面。'),
      success('capstone-finish', grouped, '技术要求已接近完成；最后把所有零件组合成作品。'),
    ]
  }
  return []
}

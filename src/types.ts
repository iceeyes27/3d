export type PrimitiveType = 'box' | 'sphere' | 'cylinder' | 'cone'
export type TransformMode = 'translate' | 'rotate' | 'scale'

export interface Vector3Value {
  x: number
  y: number
  z: number
}

export interface ModelShape {
  id: string
  name: string
  type: PrimitiveType
  color: string
  position: Vector3Value
  rotation: Vector3Value
  scale: Vector3Value
  isHole?: boolean
  grouped?: boolean
  holes?: ModelShape[]
}

export type OperationType =
  | 'add'
  | 'move'
  | 'scale'
  | 'rotate'
  | 'duplicate'
  | 'align'
  | 'group'
  | 'hole'
  | 'plan'

export interface OperationRecord {
  type: OperationType
  shapeId?: string
  at: number
}

export interface QuestTask {
  id: string
  label: string
}

export type QuestWorldId = 1 | 2 | 3

export type QuestSkillId =
  | 'shape-decomposition'
  | 'move'
  | 'scale'
  | 'rotate'
  | 'align'
  | 'precision-size'
  | 'duplicate'
  | 'boolean-hole'
  | 'wall-thickness'
  | 'print-check'
  | 'read-brief'
  | 'capstone'

export type QuestTool =
  | OperationType
  | 'select'
  | 'delete'
  | 'color'
  | 'size-input'
  | 'view-reset'
  | 'export'
  | 'undo'
  | 'redo'
  | 'reset'
  | 'check'

export interface QuestStep {
  id: string
  taskId: string
  title: string
  instruction: string
  tools: Array<QuestTool | PrimitiveType>
  hints?: string[]
}

export interface QuestPractice {
  id: string
  title: string
  instruction: string
  tools: Array<QuestTool | PrimitiveType>
  operationTypes: OperationType[]
}

export type QuestConstraintKind =
  | 'shape-count'
  | 'required-types'
  | 'position'
  | 'dimensions'
  | 'rotation'
  | 'grounded'
  | 'symmetry'
  | 'boolean-hole'
  | 'wall-thickness'
  | 'printability'
  | 'brief'

export interface QuestConstraint {
  id: string
  label: string
  kind: QuestConstraintKind
  targetShapeId?: string
  min?: number
  max?: number
  value?: number | string | string[] | Vector3Value
  tolerance?: number
  unit?: 'scene-unit' | 'mm' | 'degree' | 'count'
}

export interface Quest {
  id: number
  worldId: QuestWorldId
  skillId: QuestSkillId
  title: string
  shortTitle: string
  subtitle: string
  story: string
  objective: string
  minutes: number
  icon: string
  reward: string
  tasks: QuestTask[]
  available: boolean
  palette: PrimitiveType[]
  starterShapes?: ModelShape[]
  targetShapes: ModelShape[]
  steps: QuestStep[]
  allowedTools: QuestTool[]
  constraints: QuestConstraint[]
  hints: string[]
  tip: string
  practice?: QuestPractice
  reflectionPrompt?: string
  timingMode?: 'hidden' | 'recorded' | 'optional'
}

export interface QuestProject {
  courseVersion?: 2
  shapes: ModelShape[]
  operations: OperationRecord[]
  updatedAt: number
  startedAt?: number
  elapsedSeconds?: number
}

export type ProgressBadge = 'completion' | 'accuracy' | 'independence'
export type ManualReviewStatus = 'pending' | 'reviewed'

export interface QuestManualReview {
  status: ManualReviewStatus
  score?: number
  comment?: string
  updatedAt?: number
}

export interface LearningProgress {
  version: 2
  curriculumVersion: 2
  completedQuestIds: number[]
  starsByQuest: Record<number, number>
  projects: Record<number, QuestProject>
  lastPlayedQuestId: number
  completedPracticeIds: string[]
  challengeBestByQuest: Record<number, number>
  badgesByQuest: Record<number, ProgressBadge[]>
  reviewsByQuest: Record<number, QuestManualReview>
  legacyProjects: Record<number, QuestProject>
}

export interface TaskEvaluation {
  taskId: string
  complete: boolean
  feedback?: string
  successMessage?: string
}

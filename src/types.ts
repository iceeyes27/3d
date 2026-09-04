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

export interface OperationRecord {
  type: OperationType
  shapeId?: string
  at: number
}

export interface QuestTask {
  id: string
  label: string
}

export interface Quest {
  id: number
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
  tip: string
}

export interface QuestProject {
  shapes: ModelShape[]
  operations: OperationRecord[]
  updatedAt: number
}

export interface LearningProgress {
  version: 1
  completedQuestIds: number[]
  starsByQuest: Record<number, number>
  projects: Record<number, QuestProject>
  lastPlayedQuestId: number
}

export interface TaskEvaluation {
  taskId: string
  complete: boolean
}

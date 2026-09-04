import type { LearningProgress, ModelShape, OperationRecord, PrimitiveType, QuestProject, Vector3Value } from './types'

export const PROGRESS_STORAGE_KEY = 'maker-island-progress-v1'

export const emptyProgress = (): LearningProgress => ({
  version: 1,
  completedQuestIds: [],
  starsByQuest: {},
  projects: {},
  lastPlayedQuestId: 1,
})

const primitiveTypes = new Set<PrimitiveType>(['box', 'sphere', 'cylinder', 'cone'])
const operationTypes = new Set<OperationRecord['type']>([
  'add', 'move', 'scale', 'rotate', 'duplicate', 'align', 'group', 'hole',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function cleanVector(value: unknown, scale = false): Vector3Value | null {
  if (!isRecord(value)) return null
  const coordinates = ['x', 'y', 'z'].map((axis) => value[axis])
  if (!coordinates.every((item) => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 10000)) return null
  if (scale && coordinates.some((item) => (item as number) < 0.05 || (item as number) > 100)) return null
  return { x: coordinates[0] as number, y: coordinates[1] as number, z: coordinates[2] as number }
}

function cleanShape(value: unknown, allowNestedHoles = true): ModelShape | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !value.id || value.id.length > 120) return null
  if (typeof value.name !== 'string' || value.name.length > 80) return null
  if (typeof value.type !== 'string' || !primitiveTypes.has(value.type as PrimitiveType)) return null
  if (typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.color)) return null
  const position = cleanVector(value.position)
  const rotation = cleanVector(value.rotation)
  const shapeScale = cleanVector(value.scale, true)
  if (!position || !rotation || !shapeScale) return null

  const shape: ModelShape = {
    id: value.id,
    name: value.name,
    type: value.type as PrimitiveType,
    color: value.color,
    position,
    rotation,
    scale: shapeScale,
  }
  if (typeof value.isHole === 'boolean') shape.isHole = value.isHole
  if (typeof value.grouped === 'boolean') shape.grouped = value.grouped
  if (allowNestedHoles && Array.isArray(value.holes)) {
    shape.holes = value.holes.slice(0, 40).map((item) => cleanShape(item, false)).filter((item): item is ModelShape => Boolean(item))
  }
  return shape
}

function cleanOperation(value: unknown): OperationRecord | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !operationTypes.has(value.type as OperationRecord['type'])) return null
  if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return null
  if (value.shapeId !== undefined && typeof value.shapeId !== 'string') return null
  return {
    type: value.type as OperationRecord['type'],
    at: value.at,
    ...(typeof value.shapeId === 'string' ? { shapeId: value.shapeId } : {}),
  }
}

function cleanProject(value: unknown): QuestProject | null {
  if (!isRecord(value) || !Array.isArray(value.shapes) || !Array.isArray(value.operations)) return null
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return null
  const shapes = value.shapes.slice(0, 200).map((item) => cleanShape(item)).filter((item): item is ModelShape => Boolean(item))
  if (shapes.length !== Math.min(value.shapes.length, 200)) return null
  const operations = value.operations.slice(-1000).map(cleanOperation).filter((item): item is OperationRecord => Boolean(item))
  return { shapes, operations, updatedAt: value.updatedAt }
}

export function loadProgress(storage: Pick<Storage, 'getItem'> = localStorage): LearningProgress {
  try {
    const raw = storage.getItem(PROGRESS_STORAGE_KEY)
    if (!raw) return emptyProgress()
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== 1) return emptyProgress()

    const requestedCompleted = Array.isArray(parsed.completedQuestIds)
      ? Array.from(new Set(parsed.completedQuestIds.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 12))).sort((a, b) => a - b)
      : []
    const completedQuestIds: number[] = []
    for (let id = 1; id <= 12 && requestedCompleted.includes(id); id += 1) completedQuestIds.push(id)

    const projects: Record<number, QuestProject> = {}
    if (isRecord(parsed.projects)) {
      for (const [key, value] of Object.entries(parsed.projects)) {
        const questId = Number(key)
        const project = cleanProject(value)
        if (Number.isInteger(questId) && questId >= 1 && questId <= 12 && project) projects[questId] = project
      }
    }

    const starsByQuest: Record<number, number> = {}
    if (isRecord(parsed.starsByQuest)) {
      for (const [key, value] of Object.entries(parsed.starsByQuest)) {
        const questId = Number(key)
        if (completedQuestIds.includes(questId) && Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 3) {
          starsByQuest[questId] = value as number
        }
      }
    }

    const firstIncomplete = Math.min(completedQuestIds.length + 1, 12)
    const requestedLast = typeof parsed.lastPlayedQuestId === 'number' && Number.isInteger(parsed.lastPlayedQuestId)
      ? parsed.lastPlayedQuestId
      : firstIncomplete
    return {
      version: 1,
      completedQuestIds,
      starsByQuest,
      projects,
      lastPlayedQuestId: Math.max(1, Math.min(requestedLast, firstIncomplete)),
    }
  } catch {
    return emptyProgress()
  }
}

export function saveProgress(progress: LearningProgress, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

export function saveProject(progress: LearningProgress, questId: number, project: QuestProject): LearningProgress {
  return {
    ...progress,
    lastPlayedQuestId: questId,
    projects: { ...progress.projects, [questId]: project },
  }
}

export function completeQuest(progress: LearningProgress, questId: number, stars: number): LearningProgress {
  return {
    ...progress,
    completedQuestIds: Array.from(new Set([...progress.completedQuestIds, questId])).sort((a, b) => a - b),
    starsByQuest: {
      ...progress.starsByQuest,
      [questId]: Math.max(progress.starsByQuest[questId] ?? 0, Math.min(3, Math.max(1, stars))),
    },
    lastPlayedQuestId: Math.min(questId + 1, 12),
  }
}

export function isQuestUnlocked(progress: LearningProgress, questId: number) {
  if (questId === 1) return true
  return Array.from({ length: questId - 1 }, (_, index) => index + 1).every((id) => progress.completedQuestIds.includes(id))
}

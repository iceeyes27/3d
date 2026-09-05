import type {
  LearningProgress,
  ModelShape,
  OperationRecord,
  PrimitiveType,
  ProgressBadge,
  QuestManualReview,
  QuestProject,
  Vector3Value,
} from './types'

export type { ProgressBadge } from './types'

export const PROGRESS_STORAGE_KEY = 'maker-island-progress-v2'
export const LEGACY_PROGRESS_STORAGE_KEY = 'maker-island-progress-v1'

type ProgressV2 = Omit<LearningProgress, 'version'> & {
  version: 2
  completedPracticeIds: string[]
  challengeBestByQuest: Record<number, number>
  badgesByQuest: Record<number, ProgressBadge[]>
  reviewsByQuest: Record<number, QuestManualReview>
}

const asV2 = (progress: LearningProgress): ProgressV2 => progress as unknown as ProgressV2
const asLearningProgress = (progress: ProgressV2): LearningProgress => progress as unknown as LearningProgress

export const emptyProgress = (): LearningProgress => ({
  version: 2,
  curriculumVersion: 2,
  completedQuestIds: [],
  starsByQuest: {},
  projects: {},
  lastPlayedQuestId: 1,
  completedPracticeIds: [],
  challengeBestByQuest: {},
  badgesByQuest: {},
  reviewsByQuest: {},
  legacyProjects: {},
} as unknown as LearningProgress)

const primitiveTypes = new Set<PrimitiveType>(['box', 'sphere', 'cylinder', 'cone'])
const operationTypes = new Set<OperationRecord['type']>([
  'add', 'move', 'scale', 'rotate', 'duplicate', 'align', 'group', 'hole', 'plan',
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
  const startedAt = typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) && value.startedAt >= 0
    ? value.startedAt
    : undefined
  const elapsedSeconds = typeof value.elapsedSeconds === 'number' && Number.isFinite(value.elapsedSeconds) && value.elapsedSeconds >= 0
    ? value.elapsedSeconds
    : undefined
  return {
    ...(value.courseVersion === 2 ? { courseVersion: 2 as const } : {}),
    shapes,
    operations,
    updatedAt: value.updatedAt,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(elapsedSeconds !== undefined ? { elapsedSeconds } : {}),
  }
}

function cleanQuestIds(value: unknown) {
  const requested = Array.isArray(value)
    ? Array.from(new Set(value.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 12))).sort((a, b) => a - b)
    : []
  const result: number[] = []
  for (let id = 1; id <= 12 && requested.includes(id); id += 1) result.push(id)
  return result
}

export function cleanProgress(parsed: Record<string, unknown>): LearningProgress {
  const completedQuestIds = cleanQuestIds(parsed.completedQuestIds)

  const projects: Record<number, QuestProject> = {}
  const legacyProjects: Record<number, QuestProject> = {}
  const currentCurriculum = parsed.version === 2 && parsed.curriculumVersion === 2
  if (isRecord(parsed.projects)) {
    for (const [key, value] of Object.entries(parsed.projects)) {
      const questId = Number(key)
      const project = cleanProject(value)
      if (!Number.isInteger(questId) || questId < 1 || questId > 12 || !project) continue
      if (currentCurriculum && project.courseVersion === 2) projects[questId] = project
      else legacyProjects[questId] = project
    }
  }
  if (isRecord(parsed.legacyProjects)) {
    for (const [key, value] of Object.entries(parsed.legacyProjects)) {
      const questId = Number(key)
      const project = cleanProject(value)
      if (Number.isInteger(questId) && questId >= 1 && questId <= 12 && project) legacyProjects[questId] = project
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

  const completedPracticeIds = parsed.version === 2 && Array.isArray(parsed.completedPracticeIds)
    ? Array.from(new Set(parsed.completedPracticeIds
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && id.length <= 120))).slice(0, 500)
    : []

  const challengeBestByQuest: Record<number, number> = {}
  if (parsed.version === 2 && isRecord(parsed.challengeBestByQuest)) {
    for (const [key, value] of Object.entries(parsed.challengeBestByQuest)) {
      const questId = Number(key)
      if (Number.isInteger(questId) && questId >= 1 && questId <= 12 && typeof value === 'number' && Number.isFinite(value)) {
        challengeBestByQuest[questId] = Math.min(100, Math.max(0, value))
      }
    }
  }

  const badgesByQuest: Record<number, ProgressBadge[]> = {}
  const validBadges = new Set<ProgressBadge>(['completion', 'accuracy', 'independence'])
  const storedBadges = parsed.version === 2 && isRecord(parsed.badgesByQuest) ? parsed.badgesByQuest : {}
  for (const questId of completedQuestIds) {
    const value = storedBadges[String(questId)]
    const validStored = Array.isArray(value)
      ? value.filter((badge): badge is ProgressBadge => typeof badge === 'string' && validBadges.has(badge as ProgressBadge))
      : []
    badgesByQuest[questId] = (['completion', 'accuracy', 'independence'] as const)
      .filter((badge) => badge === 'completion' || validStored.includes(badge))
  }

  const reviewsByQuest: Record<number, QuestManualReview> = {}
  if (parsed.version === 2 && isRecord(parsed.reviewsByQuest)) {
    for (const [key, value] of Object.entries(parsed.reviewsByQuest)) {
      const questId = Number(key)
      if (!Number.isInteger(questId) || questId < 1 || questId > 12 || !isRecord(value)) continue
      const hasValidScore = typeof value.score === 'number' && Number.isFinite(value.score)
      const status: QuestManualReview['status'] = value.status === 'reviewed' && hasValidScore ? 'reviewed' : 'pending'
      reviewsByQuest[questId] = {
        status,
        ...(status === 'reviewed' ? { score: Math.min(40, Math.max(0, value.score as number)) } : {}),
        ...(typeof value.comment === 'string' ? { comment: value.comment.slice(0, 2000) } : {}),
        ...(typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? { updatedAt: value.updatedAt } : {}),
      }
    }
  }

  return asLearningProgress({
    version: 2,
    curriculumVersion: 2,
    completedQuestIds,
    starsByQuest,
    projects,
    lastPlayedQuestId: Math.max(1, Math.min(requestedLast, firstIncomplete)),
    completedPracticeIds,
    challengeBestByQuest,
    badgesByQuest,
    reviewsByQuest,
    legacyProjects,
  })
}

export function loadProgress(storage: Pick<Storage, 'getItem'> = localStorage): LearningProgress {
  try {
    const rawV2 = storage.getItem(PROGRESS_STORAGE_KEY)
    if (rawV2) {
      try {
        const parsed: unknown = JSON.parse(rawV2)
        if (isRecord(parsed) && parsed.version === 2) return cleanProgress(parsed)
      } catch {
        // A damaged v2 value must not prevent recovery from the legacy key.
      }
    }

    const rawV1 = storage.getItem(LEGACY_PROGRESS_STORAGE_KEY)
    if (!rawV1) return emptyProgress()
    const parsed: unknown = JSON.parse(rawV1)
    return isRecord(parsed) && parsed.version === 1 ? cleanProgress(parsed) : emptyProgress()
  } catch {
    return emptyProgress()
  }
}

export function saveProgress(progress: LearningProgress, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    const source = progress as unknown as Record<string, unknown>
    const normalized = cleanProgress({ ...source, version: source.version === 1 ? 1 : 2 })
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(normalized))
    return true
  } catch {
    return false
  }
}

export function saveProject(progress: LearningProgress, questId: number, project: QuestProject): LearningProgress {
  return {
    ...progress,
    lastPlayedQuestId: questId,
    projects: { ...progress.projects, [questId]: { ...project, courseVersion: 2 } },
  }
}

export function completeQuest(progress: LearningProgress, questId: number, stars: number): LearningProgress {
  const v2 = asV2(progress)
  const previousBadges = v2.badgesByQuest?.[questId] ?? []
  return {
    ...progress,
    completedQuestIds: Array.from(new Set([...progress.completedQuestIds, questId])).sort((a, b) => a - b),
    starsByQuest: {
      ...progress.starsByQuest,
      [questId]: Math.max(progress.starsByQuest[questId] ?? 0, Math.min(3, Math.max(1, stars))),
    },
    lastPlayedQuestId: Math.min(questId + 1, 12),
    badgesByQuest: {
      ...(v2.badgesByQuest ?? {}),
      [questId]: Array.from(new Set([...previousBadges, 'completion' as const])),
    },
  } as LearningProgress
}

export function isQuestUnlocked(progress: LearningProgress, questId: number) {
  if (questId === 1) return true
  return Array.from({ length: questId - 1 }, (_, index) => index + 1).every((id) => progress.completedQuestIds.includes(id))
}

export function completePractice(progress: LearningProgress, practiceId: string): LearningProgress {
  const id = practiceId.trim()
  if (!id || id.length > 120) return progress
  const current = asV2(progress).completedPracticeIds ?? []
  if (current.includes(id)) return progress
  return { ...progress, completedPracticeIds: [...current, id] } as LearningProgress
}

export function recordChallengeScore(progress: LearningProgress, questId: number, score: number): LearningProgress {
  if (!Number.isInteger(questId) || questId < 1 || questId > 12 || !Number.isFinite(score)) return progress
  const current = asV2(progress).challengeBestByQuest ?? {}
  const safeScore = Math.min(100, Math.max(0, score))
  if ((current[questId] ?? -1) >= safeScore) return progress
  return {
    ...progress,
    challengeBestByQuest: { ...current, [questId]: safeScore },
  } as LearningProgress
}

export function awardQuestBadge(progress: LearningProgress, questId: number, badge: ProgressBadge): LearningProgress {
  if (!Number.isInteger(questId) || questId < 1 || questId > 12) return progress
  if (!(['completion', 'accuracy', 'independence'] as const).includes(badge)) return progress
  const current = asV2(progress).badgesByQuest ?? {}
  const badges = current[questId] ?? []
  if (badges.includes(badge)) return progress
  return {
    ...progress,
    badgesByQuest: { ...current, [questId]: [...badges, badge] },
  } as LearningProgress
}

export function setQuestReview(progress: LearningProgress, questId: number, review: QuestManualReview): LearningProgress {
  if (!Number.isInteger(questId) || questId < 1 || questId > 12) return progress
  const current = asV2(progress).reviewsByQuest ?? {}
  const reviewed = review.status === 'reviewed' && typeof review.score === 'number' && Number.isFinite(review.score)
  const cleanReview: QuestManualReview = {
    status: reviewed ? 'reviewed' : 'pending',
    ...(reviewed ? { score: Math.min(40, Math.max(0, review.score as number)) } : {}),
    ...(typeof review.comment === 'string' ? { comment: review.comment.slice(0, 2000) } : {}),
    ...(typeof review.updatedAt === 'number' && Number.isFinite(review.updatedAt) ? { updatedAt: review.updatedAt } : {}),
  }
  return {
    ...progress,
    reviewsByQuest: { ...current, [questId]: cleanReview },
  } as LearningProgress
}

export const markQuestReviewPending = (progress: LearningProgress, questId: number, updatedAt?: number) =>
  setQuestReview(progress, questId, { status: 'pending', updatedAt })

export const recordQuestReview = (
  progress: LearningProgress,
  questId: number,
  score: number,
  comment?: string,
  updatedAt?: number,
) => setQuestReview(progress, questId, { status: 'reviewed', score, comment, updatedAt })

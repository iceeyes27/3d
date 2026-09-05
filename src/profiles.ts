import { cleanProgress, emptyProgress, LEGACY_PROGRESS_STORAGE_KEY, PROGRESS_STORAGE_KEY } from './progress'
import type { LearningProgress } from './types'

export const PROFILE_STORAGE_PREFIX = 'maker-island-profile-v1:'
const PROFILE_WRITE_LOCK = 'maker-island-profiles-write-v1'
type ProfileStorage = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>

export interface ProfileSummary {
  id: string
  name: string
  normalizedName: string
  revision: number
  createdAt: number
  updatedAt: number
  migratedLegacy?: boolean
}

export interface ProfileEnvelope extends ProfileSummary {
  version: 1
  progress: LearningProgress
}

export type ProfileFailureCode = 'invalid-name' | 'storage-unavailable' | 'damaged' | 'not-found' | 'conflict' | 'locking-unavailable'
export interface ProfileFailure {
  ok: false
  code: ProfileFailureCode
  message: string
}
export type ProfileResult = { ok: true; profile: ProfileEnvelope } | ProfileFailure
export type EnterProfileResult = { ok: true; profile: ProfileEnvelope; created: boolean } | ProfileFailure
export type LegacyStatus = 'none' | 'available' | 'migrated' | 'damaged'
export type ProfileListResult = { ok: true; profiles: ProfileSummary[]; legacy: LegacyStatus } | ProfileFailure

const failureMessages: Record<ProfileFailureCode, string> = {
  'invalid-name': '用户名请填写 1～16 个中文、字母、数字或下划线。',
  'storage-unavailable': '这次没有保存成功，请检查浏览器的存储空间或隐私设置，再重试。',
  damaged: '发现无法读取的档案，原数据已保留。请先恢复档案，再继续。',
  'not-found': '找不到这个用户的档案，请重新选择用户。',
  conflict: '另一个页面已经更新了这个档案。请重新载入最新进度，避免覆盖。',
  'locking-unavailable': '当前浏览器无法安全保存多用户档案，请使用新版浏览器并通过 HTTPS 或本机地址打开。',
}
const fail = (code: ProfileFailureCode): ProfileFailure => ({ ok: false, code, message: failureMessages[code] })
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function normalizeProfileName(input: string): { name: string; normalizedName: string } | null {
  const name = input.normalize('NFKC').trim()
  if (!/^[\p{Script=Han}A-Za-z0-9_]{1,16}$/u.test(name)) return null
  return { name, normalizedName: name.toLowerCase() }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}

function normalizedProgress(value: unknown, legacy = false): LearningProgress | null {
  if (!isRecord(value) || (value.version !== 2 && !(legacy && value.version === 1))) return null
  if (!Array.isArray(value.completedQuestIds) || !isRecord(value.starsByQuest) || !isRecord(value.projects)) return null
  const progress = cleanProgress(value)
  if (!legacy) return canonicalJson(progress) === canonicalJson(value) ? progress : null
  // Legacy normalization may move projects to the old-course collection, but must never discard a damaged project.
  for (const [id, project] of Object.entries(value.projects)) {
    const cleaned = progress.projects[Number(id)] ?? progress.legacyProjects[Number(id)]
    if (!isRecord(project) || !cleaned || !Array.isArray(project.shapes) || cleaned.shapes.length !== project.shapes.length) return null
  }
  if (isRecord(value.legacyProjects)) {
    for (const [id, project] of Object.entries(value.legacyProjects)) {
      const cleaned = progress.legacyProjects[Number(id)]
      if (!isRecord(project) || !cleaned || !Array.isArray(project.shapes) || cleaned.shapes.length !== project.shapes.length) return null
    }
  }
  return progress
}

function readEnvelope(id: string, storage: ProfileStorage): ProfileResult {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return fail('not-found')
  const raw = storage.getItem(`${PROFILE_STORAGE_PREFIX}${id}`)
  if (raw === null) return fail('not-found')
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== 1 || value.id !== id || typeof value.name !== 'string') return fail('damaged')
    const name = normalizeProfileName(value.name)
    if (!name || name.name !== value.name || name.normalizedName !== value.normalizedName) return fail('damaged')
    if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) return fail('damaged')
    if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt < 0) return fail('damaged')
    if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return fail('damaged')
    if (value.migratedLegacy !== undefined && typeof value.migratedLegacy !== 'boolean') return fail('damaged')
    const progress = normalizedProgress(value.progress)
    if (!progress) return fail('damaged')
    return { ok: true, profile: { version: 1, id, ...name, revision: value.revision as number, createdAt: value.createdAt, updatedAt: value.updatedAt, progress, ...(value.migratedLegacy === true ? { migratedLegacy: true } : {}) } }
  } catch {
    return fail('damaged')
  }
}

function scanProfiles(storage: ProfileStorage): { ok: true; profiles: ProfileEnvelope[] } | ProfileFailure {
  const profiles: ProfileEnvelope[] = []
  const names = new Set<string>()
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(PROFILE_STORAGE_PREFIX)) continue
    const result = readEnvelope(key.slice(PROFILE_STORAGE_PREFIX.length), storage)
    if (!result.ok) return result.code === 'not-found' ? fail('damaged') : result
    if (names.has(result.profile.normalizedName)) return fail('damaged')
    names.add(result.profile.normalizedName)
    profiles.push(result.profile)
  }
  profiles.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
  return { ok: true, profiles }
}

function hasLearningData(progress: LearningProgress) {
  return progress.completedQuestIds.length > 0 || progress.completedPracticeIds.length > 0
    || [progress.projects, progress.legacyProjects, progress.challengeBestByQuest, progress.reviewsByQuest].some((items) => Object.keys(items).length > 0)
}

function legacyState(storage: ProfileStorage, profiles: ProfileSummary[]): { status: LegacyStatus; progress?: LearningProgress } {
  if (profiles.some((profile) => profile.migratedLegacy)) return { status: 'migrated' }
  let damaged = false
  for (const key of [PROGRESS_STORAGE_KEY, LEGACY_PROGRESS_STORAGE_KEY]) {
    const raw = storage.getItem(key)
    if (raw === null) continue
    try {
      const parsed: unknown = JSON.parse(raw)
      const expectedVersion = key === PROGRESS_STORAGE_KEY ? 2 : 1
      const progress = isRecord(parsed) && parsed.version === expectedVersion ? normalizedProgress(parsed, true) : null
      if (!progress) { damaged = true; continue }
      // A valid current key supersedes the historical key, including an intentionally empty current progress.
      return hasLearningData(progress) ? { status: 'available', progress } : { status: 'none' }
    } catch {
      damaged = true
    }
  }
  return { status: damaged ? 'damaged' : 'none' }
}

export function listProfiles(storage?: ProfileStorage): ProfileListResult {
  try {
    const target = storage ?? globalThis.localStorage
    const result = scanProfiles(target)
    if (!result.ok) return result
    return { ok: true, profiles: result.profiles.map(({ progress: _progress, version: _version, ...summary }) => summary), legacy: legacyState(target, result.profiles).status }
  } catch {
    return fail('storage-unavailable')
  }
}

export function getProfile(id: string, storage?: ProfileStorage): ProfileResult {
  try {
    return readEnvelope(id, storage ?? globalThis.localStorage)
  } catch {
    return fail('storage-unavailable')
  }
}

async function withWriteLock<T extends { ok: true }>(action: () => T | ProfileFailure): Promise<T | ProfileFailure> {
  try {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) return fail('locking-unavailable')
    return await navigator.locks.request(PROFILE_WRITE_LOCK, () => {
      try { return action() } catch { return fail('storage-unavailable') }
    })
  } catch {
    return fail('locking-unavailable')
  }
}

export async function enterProfile(input: string, storage?: ProfileStorage): Promise<EnterProfileResult> {
  const name = normalizeProfileName(input)
  if (!name) return fail('invalid-name')
  return withWriteLock(() => {
    const target = storage ?? globalThis.localStorage
    const result = scanProfiles(target)
    if (!result.ok) return result
    const existing = result.profiles.find((profile) => profile.normalizedName === name.normalizedName)
    if (existing) return { ok: true, profile: existing, created: false }
    const legacy = legacyState(target, result.profiles)
    if (legacy.status === 'damaged') return fail('damaged')
    let id = crypto.randomUUID()
    while (target.getItem(`${PROFILE_STORAGE_PREFIX}${id}`) !== null) id = crypto.randomUUID()
    const now = Date.now()
    const profile: ProfileEnvelope = { version: 1, id, ...name, revision: 1, createdAt: now, updatedAt: now, progress: legacy.progress ?? emptyProgress(), ...(legacy.status === 'available' ? { migratedLegacy: true } : {}) }
    // One atomic set stores the user directory entry, progress and migration marker together.
    target.setItem(`${PROFILE_STORAGE_PREFIX}${id}`, JSON.stringify(profile))
    return { ok: true, profile, created: true }
  })
}

export async function saveProfile(id: string, progress: LearningProgress, expectedRevision: number, storage?: ProfileStorage): Promise<ProfileResult> {
  return withWriteLock(() => {
    const target = storage ?? globalThis.localStorage
    const current = readEnvelope(id, target)
    if (!current.ok) return current
    if (current.profile.revision !== expectedRevision || !Number.isSafeInteger(expectedRevision + 1)) return fail('conflict')
    const normalized = cleanProgress(progress as unknown as Record<string, unknown>)
    const profile: ProfileEnvelope = { ...current.profile, progress: normalized, revision: expectedRevision + 1, updatedAt: Date.now() }
    target.setItem(`${PROFILE_STORAGE_PREFIX}${id}`, JSON.stringify(profile))
    return { ok: true, profile }
  })
}

import { normalizeProfileName } from './profiles'
import { cleanProgress } from './progress'
import type { LearningProgress } from './types'
import type { CloudFailure, CloudProfileEnvelope, CloudProfileSummary, CloudSpace } from './cloudTypes'
export type { CloudFailure, CloudProfileEnvelope, CloudProfileSummary, CloudSpace } from './cloudTypes'

export const CLOUD_PROFILE_CACHE_PREFIX = 'maker-island-cloud-profile-v1:'
export const CLOUD_SESSION_CACHE_KEY = 'maker-island-cloud-space-v1'
export type CloudProfileResult = { ok: true; profile: CloudProfileEnvelope; offline?: boolean } | CloudFailure
export interface CloudMutation { mutationId: string; baseRevision: number; progress: LearningProgress; attempted?: boolean }
export interface CloudCache {
  version: 1
  stamp: string
  profile: CloudProfileEnvelope
  desiredProgress: LearningProgress
  pending?: CloudMutation
  conflict?: { message: string; remote?: CloudProfileEnvelope }
}
export type CloudStorage = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>
export const cloudProfileCacheKey = (spaceId: string, profileId: string) => `${CLOUD_PROFILE_CACHE_PREFIX}${encodeURIComponent(spaceId)}:${encodeURIComponent(profileId)}`
export const cloudStorageFailure = (): CloudFailure => ({ ok: false, code: 'storage-unavailable', message: '本机保存失败，请检查浏览器存储空间后重试。当前内容仍保留在页面中。' })
export const isNetworkFailure = (result: CloudFailure) => result.code === 'network' || result.code === 'timeout'

async function request<T extends { ok: true }>(path: string, init: RequestInit = {}, spaceId?: string): Promise<T | CloudFailure> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(path, {
      ...init, credentials: 'same-origin', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(spaceId ? { 'X-Space-ID': spaceId } : {}), ...init.headers },
    })
    let body: T | CloudFailure
    try { body = await response.json() as T | CloudFailure }
    catch { return { ok: false, code: 'server', message: '云端返回了无法读取的数据，请稍后重试。' } }
    if (response.ok && body.ok === true) return body
    if (body.ok === false && typeof body.code === 'string' && typeof body.message === 'string') return body
    return { ok: false, code: 'server', message: '云端暂时无法保存，请稍后重试。' }
  } catch {
    return { ok: false, code: controller.signal.aborted ? 'timeout' : 'network', message: '暂时无法连接云端，请检查网络后重试。' }
  } finally { clearTimeout(timeout) }
}

function storage(target?: CloudStorage) { return target ?? globalThis.localStorage }
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
function validProgress(value: unknown): value is LearningProgress {
  return isRecord(value) && value.version === 2 && value.curriculumVersion === 2
    && canonical(cleanProgress(value)) === canonical(value)
}
function validProfile(value: unknown, spaceId: string, profileId: string): value is CloudProfileEnvelope {
  if (!isRecord(value) || value.version !== 1 || value.spaceId !== spaceId || value.id !== profileId || typeof value.name !== 'string') return false
  const name = normalizeProfileName(value.name)
  return !!name && name.name === value.name && name.normalizedName === value.normalizedName
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 1
    && typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
    && typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) && validProgress(value.progress)
}
export function readCloudCache(spaceId: string, profileId: string, target?: CloudStorage): CloudCache | null {
  const raw = storage(target).getItem(cloudProfileCacheKey(spaceId, profileId))
  if (!raw) return null
  const value = JSON.parse(raw) as CloudCache
  if (!value || value.version !== 1 || typeof value.stamp !== 'string' || !validProfile(value.profile, spaceId, profileId) || !validProgress(value.desiredProgress)
    || (value.pending && (typeof value.pending.mutationId !== 'string' || !Number.isSafeInteger(value.pending.baseRevision) || value.pending.baseRevision < 1 || !validProgress(value.pending.progress) || (value.pending.attempted !== undefined && typeof value.pending.attempted !== 'boolean')))
    || (value.conflict && (typeof value.conflict.message !== 'string' || (value.conflict.remote && !validProfile(value.conflict.remote, spaceId, profileId))))) {
    throw new Error('Invalid cloud cache')
  }
  return value
}

/** Guard the whole local read/compare/write, including against other tabs. */
export async function withCloudCacheLock<T>(spaceId: string, profileId: string, operation: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(`cloud-cache:${spaceId}:${profileId}`, operation)
  }
  return operation()
}

export async function cacheCloudProfile(profile: CloudProfileEnvelope, target?: CloudStorage): Promise<CloudProfileResult> {
  try {
    if (!validProfile(profile, profile.spaceId, profile.id)) return { ok: false, code: 'server', message: '云端档案格式无法读取，请稍后重试。' }
    return await withCloudCacheLock(profile.spaceId, profile.id, () => {
      const cached = readCloudCache(profile.spaceId, profile.id, target)
      // Opening a profile must never replace an offline or unresolved local draft.
      if (cached?.pending || cached?.conflict) return { ok: true, profile: { ...cached.profile, progress: cached.desiredProgress } }
      if (cached && cached.profile.revision > profile.revision) return { ok: true, profile: cached.profile }
      if (cached && canonical(cached.profile) === canonical(profile)) return { ok: true, profile: cached.profile }
      const record: CloudCache = { version: 1, stamp: crypto.randomUUID(), profile, desiredProgress: profile.progress }
      storage(target).setItem(cloudProfileCacheKey(profile.spaceId, profile.id), JSON.stringify(record))
      return { ok: true, profile }
    })
  } catch { return cloudStorageFailure() }
}

function cachedProfiles(spaceId: string): CloudProfileEnvelope[] {
  const target = storage()
  const prefix = `${CLOUD_PROFILE_CACHE_PREFIX}${encodeURIComponent(spaceId)}:`
  const result: CloudProfileEnvelope[] = []
  for (let index = 0; index < target.length; index += 1) {
    const key = target.key(index)
    if (!key?.startsWith(prefix)) continue
    const record = readCloudCache(spaceId, decodeURIComponent(key.slice(prefix.length)), target)
    if (record) result.push({ ...record.profile, progress: record.desiredProgress })
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getCachedCloudSpace(): CloudSpace | null {
  try {
    const raw = storage().getItem(CLOUD_SESSION_CACHE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as CloudSpace
    return typeof value.id === 'string' && value.id.length > 0 && typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value : null
  } catch { return null }
}

function rememberSpace<T extends { ok: true; space: CloudSpace }>(result: T | CloudFailure): T | CloudFailure {
  if (!result.ok) return result
  try { storage().setItem(CLOUD_SESSION_CACHE_KEY, JSON.stringify(result.space)); return result } catch { return cloudStorageFailure() }
}

export async function getCloudSession(): Promise<{ ok: true; space: CloudSpace; offline?: boolean } | CloudFailure> {
  const result = await request<{ ok: true; space: CloudSpace }>('/api/session')
  if (!result.ok && isNetworkFailure(result)) {
    const space = getCachedCloudSpace()
    if (space) return { ok: true, space, offline: true }
  }
  return rememberSpace(result)
}
export async function createCloudSpace() {
  return rememberSpace(await request<{ ok: true; space: CloudSpace; inviteToken: string }>('/api/spaces', { method: 'POST', body: '{}' }))
}
export async function joinCloudSpace(inviteToken: string) {
  return rememberSpace(await request<{ ok: true; space: CloudSpace }>('/api/session', { method: 'POST', body: JSON.stringify({ inviteToken }) }))
}
export async function listCloudProfiles(spaceId: string): Promise<{ ok: true; profiles: CloudProfileSummary[]; offline?: boolean } | CloudFailure> {
  const result = await request<{ ok: true; profiles: CloudProfileSummary[] }>('/api/profiles', {}, spaceId)
  if (!result.ok && isNetworkFailure(result)) {
    try { return { ok: true, profiles: cachedProfiles(spaceId), offline: true } } catch { return cloudStorageFailure() }
  }
  return result
}
export async function getCloudProfile(spaceId: string, id: string, options?: { discardPending?: boolean }): Promise<CloudProfileResult> {
  if (options?.discardPending) return reloadCloudProfile(spaceId, id)
  const result = await request<{ ok: true; profile: CloudProfileEnvelope }>(`/api/profiles/${encodeURIComponent(id)}`, {}, spaceId)
  if (result.ok) return cacheCloudProfile(result.profile)
  if (isNetworkFailure(result)) {
    try {
      const cached = readCloudCache(spaceId, id)
      if (cached) return { ok: true, profile: { ...cached.profile, progress: cached.desiredProgress }, offline: true }
    } catch { return cloudStorageFailure() }
  }
  return result
}
/** Explicit conflict resolution only: caller must first offer the current draft backup. */
export async function reloadCloudProfile(spaceId: string, id: string): Promise<CloudProfileResult> {
  const result = await request<{ ok: true; profile: CloudProfileEnvelope }>(`/api/profiles/${encodeURIComponent(id)}`, {}, spaceId)
  if (!result.ok) return result
  if (!validProfile(result.profile, spaceId, id)) return { ok: false, code: 'server', message: '云端档案格式无法读取，原本机作品已保留。' }
  try {
    return await withCloudCacheLock(spaceId, id, () => {
      const record: CloudCache = { version: 1, stamp: crypto.randomUUID(), profile: result.profile, desiredProgress: result.profile.progress }
      storage().setItem(cloudProfileCacheKey(spaceId, id), JSON.stringify(record))
      return result
    })
  } catch { return cloudStorageFailure() }
}
export async function enterCloudProfile(spaceId: string, input: string): Promise<({ ok: true; profile: CloudProfileEnvelope; created: boolean; offline?: boolean }) | CloudFailure> {
  const name = normalizeProfileName(input)
  if (!name) return { ok: false, code: 'invalid-name', message: '用户名请填写 1～16 个中文、字母、数字或下划线。' }
  const result = await request<{ ok: true; profile: CloudProfileEnvelope; created: boolean }>('/api/profiles', { method: 'POST', body: JSON.stringify({ name: name.name }) }, spaceId)
  if (result.ok) {
    const cached = await cacheCloudProfile(result.profile)
    return cached.ok ? { ...cached, created: result.created } : cached
  }
  if (isNetworkFailure(result)) {
    try {
      const profile = cachedProfiles(spaceId).find((item) => item.normalizedName === name.normalizedName)
      if (profile) return { ok: true, profile, created: false, offline: true }
      return { ok: false, code: 'offline-new-profile', message: '连接网络后才能建立新用户。你可以先打开本机已有的用户。' }
    } catch { return cloudStorageFailure() }
  }
  return result
}
export function saveCloudProfile(spaceId: string, id: string, progress: LearningProgress, expectedRevision: number, mutationId: string) {
  return request<{ ok: true; profile: CloudProfileEnvelope }>(`/api/profiles/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ progress, expectedRevision, mutationId }) }, spaceId)
}

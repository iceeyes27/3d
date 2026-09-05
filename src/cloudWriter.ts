import { cloudProfileCacheKey, cloudStorageFailure, getCachedCloudSpace, isNetworkFailure, readCloudCache, saveCloudProfile, withCloudCacheLock } from './cloudProfiles'
import type { CloudCache, CloudFailure, CloudProfileEnvelope, CloudProfileResult, CloudStorage } from './cloudProfiles'
import type { LearningProgress } from './types'

export type CloudSaveState = 'saved' | 'saving' | 'pending' | 'error' | 'conflict'
interface WriterOptions {
  storage?: CloudStorage
  save?: typeof saveCloudProfile
  currentSpace?: () => string | null
  debounceMs?: number
  maxWaitMs?: number
}
const sameProgress = (a: LearningProgress, b: LearningProgress) => JSON.stringify(a) === JSON.stringify(b)
type WriterCache = CloudCache & { rejectedMutationId?: string }

/** This durable queue never changes its space/profile identity, even after a user switch. */
export class CloudProfileWriter {
  private record: WriterCache
  private expectedStamp: string | null = null
  private persistQueue: Promise<boolean> = Promise.resolve(true)
  private uploading: Promise<boolean> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private maxTimer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private localFailure = false
  private sessionChanged = false
  private save: typeof saveCloudProfile
  state: CloudSaveState = 'saved'
  message = ''
  onChange: (() => void) | undefined
  private online = () => { void this.flush() }

  constructor(profile: CloudProfileEnvelope, private options: WriterOptions = {}) {
    this.save = options.save ?? saveCloudProfile
    this.record = { version: 1, stamp: crypto.randomUUID(), profile, desiredProgress: profile.progress }
    try {
      const cached = readCloudCache(profile.spaceId, profile.id, options.storage)
      if (cached) { this.record = cached; this.expectedStamp = cached.stamp }
      if (this.record.conflict) { this.state = 'conflict'; this.message = this.record.conflict.message }
      else if (this.record.pending) { this.state = 'pending'; this.message = '本机已保存，等待同步。' }
    } catch { this.localFailure = true; this.state = 'error'; this.message = cloudStorageFailure().message }
  }

  start() {
    this.disposed = false
    if (typeof window !== 'undefined') window.addEventListener('online', this.online)
    if (this.record.pending) this.schedule()
  }

  get revision() { return this.record.profile.revision }
  get progress() { return this.record.desiredProgress }
  get profile() { return { ...this.record.profile, progress: this.record.desiredProgress } }
  get spaceId() { return this.record.profile.spaceId }
  get cacheKey() { return cloudProfileCacheKey(this.spaceId, this.record.profile.id) }
  get canLeave() { return !this.localFailure && this.state !== 'conflict' && !this.sessionChanged }
  get needsReconnect() { return this.sessionChanged }

  private notify() { if (!this.disposed) this.onChange?.() }
  private persist(): Promise<boolean> {
    this.persistQueue = this.persistQueue.then(async () => {
      try {
        return await withCloudCacheLock(this.spaceId, this.record.profile.id, () => {
          const target = this.options.storage ?? globalThis.localStorage
          const current = readCloudCache(this.spaceId, this.record.profile.id, target)
          if ((current?.stamp ?? null) !== this.expectedStamp) {
            this.markConflict({ ok: false, code: 'conflict', message: '另一页面已修改本机档案，请先下载当前备份，再重新载入。', profile: current?.profile })
            return false
          }
          const next = { ...this.record, stamp: crypto.randomUUID() }
          target.setItem(this.cacheKey, JSON.stringify(next))
          this.record = next
          this.expectedStamp = next.stamp
          this.localFailure = false
          return true
        })
      } catch {
        this.localFailure = true
        this.state = 'error'
        this.message = cloudStorageFailure().message
        this.notify()
        return false
      }
    })
    return this.persistQueue
  }

  update(progress: LearningProgress) {
    if (sameProgress(progress, this.record.desiredProgress)) return
    this.record.desiredProgress = progress
    if (!this.record.pending || this.record.rejectedMutationId === this.record.pending.mutationId) {
      this.record.pending = { mutationId: crypto.randomUUID(), baseRevision: this.revision, progress }
      delete this.record.rejectedMutationId
    }
    else if (!this.record.pending.attempted) this.record.pending = { ...this.record.pending, progress }
    if (!this.record.conflict && !this.sessionChanged) { this.state = 'saving'; this.message = '正在保存到云端…' }
    this.notify()
    // Local persistence runs immediately; only network writes are debounced.
    void this.persist().then((ok) => { if (ok && !this.record.conflict) this.schedule() })
  }

  private schedule() {
    if (this.disposed || this.record.conflict || this.sessionChanged || this.localFailure) return
    clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => { void this.flush() }, this.options.debounceMs ?? 2000)
    this.maxTimer ??= setTimeout(() => { void this.flush() }, this.options.maxWaitMs ?? 10_000)
  }

  private clearTimers() {
    clearTimeout(this.debounceTimer); clearTimeout(this.maxTimer); clearTimeout(this.retryTimer)
    this.debounceTimer = undefined; this.maxTimer = undefined; this.retryTimer = undefined
  }

  private markConflict(result: CloudFailure) {
    this.record.conflict = { message: result.message, ...(result.profile ? { remote: result.profile } : {}) }
    this.state = 'conflict'
    this.message = result.message
    this.clearTimers()
    this.notify()
  }

  /** Persist the current draft without contacting the cloud or requiring a valid session. */
  async checkpoint(): Promise<boolean> {
    this.clearTimers()
    await this.persistQueue
    this.clearTimers()
    if (this.record.conflict) return false
    if (this.localFailure && !await this.persist()) return false
    return !this.localFailure && !this.record.conflict
  }

  async flush(): Promise<boolean> {
    this.clearTimers()
    await this.persistQueue
    if (this.record.conflict || this.sessionChanged) return false
    if (this.localFailure && !await this.persist()) return false
    if (this.uploading) return this.uploading
    if (!this.record.pending) {
      this.state = 'saved'; this.message = ''; this.notify()
      return this.canLeave
    }
    this.uploading = this.upload().finally(() => { this.uploading = null })
    return this.uploading
  }

  private async upload(): Promise<boolean> {
    while (this.record.pending && !this.record.conflict) {
      const activeSpace = this.options.currentSpace ? this.options.currentSpace() : getCachedCloudSpace()?.id
      if (activeSpace !== this.spaceId) {
        this.sessionChanged = true
        this.state = 'error'
        this.message = '家庭入口已经切换。当前作品保存在原家庭的本机草稿中，请重新打开原家庭入口后同步。'
        this.notify()
        return false
      }
      // Once attempted, its body and id stay immutable across timeout/restart/retry.
      this.record.pending.attempted = true
      if (!await this.persist()) return false
      const mutation = this.record.pending
      if (!mutation) break
      this.state = 'saving'; this.notify()
      let result: CloudProfileResult
      try { result = await this.save(this.spaceId, this.record.profile.id, mutation.progress, mutation.baseRevision, mutation.mutationId) }
      catch { result = { ok: false, code: 'network', message: '本机已保存，等待网络恢复后同步。' } }
      if (!result.ok) {
        if (result.code === 'conflict') {
          this.markConflict(result)
          await this.persist()
          return false
        }
        if (result.code === 'session-changed' || result.code === 'unauthorized' || result.code === 'no-session') {
          this.sessionChanged = true; this.state = 'error'; this.message = result.message; this.notify(); return false
        }
        if (result.code === 'too-large' || result.code === 'invalid-data') {
          // These validation responses guarantee the mutation never committed. A
          // corrected draft may safely get a new id; uncertain failures cannot.
          this.record.rejectedMutationId = mutation.mutationId
          if (!sameProgress(this.record.desiredProgress, mutation.progress)) {
            this.record.pending = { mutationId: crypto.randomUUID(), baseRevision: this.revision, progress: this.record.desiredProgress }
            delete this.record.rejectedMutationId
            if (!await this.persist()) return false
            continue
          }
          this.state = 'error'; this.message = result.message
          await this.persist()
          this.notify()
          return false
        }
        this.state = isNetworkFailure(result) ? 'pending' : 'error'
        this.message = isNetworkFailure(result) ? '本机已保存，等待网络恢复后同步。' : result.message
        this.notify()
        if (this.state === 'pending' && !this.disposed) this.retryTimer = setTimeout(() => { void this.flush() }, 30_000)
        return this.state === 'pending' && !this.localFailure
      }
      if (result.profile.spaceId !== this.spaceId || result.profile.id !== this.record.profile.id) {
        this.markConflict({ ok: false, code: 'conflict', message: '返回的档案与当前用户不一致，当前内容已保留。' }); await this.persist(); return false
      }
      if (result.profile.revision > mutation.baseRevision + 1 && !sameProgress(result.profile.progress, mutation.progress)) {
        this.markConflict({ ok: false, code: 'conflict', message: '另一台设备已修改这个作品。两份内容都已保留，请选择要继续的版本。', profile: result.profile })
        await this.persist(); return false
      }
      const desired = this.record.desiredProgress
      this.record.profile = result.profile
      delete this.record.rejectedMutationId
      this.record.pending = sameProgress(desired, mutation.progress) ? undefined : { mutationId: crypto.randomUUID(), baseRevision: result.profile.revision, progress: desired }
      if (!this.record.pending) this.record.desiredProgress = result.profile.progress
      if (!await this.persist()) return false
    }
    this.state = 'saved'; this.message = ''; this.notify()
    return true
  }

  externalChange(value: string | number | null) {
    if (typeof value === 'number' && value === this.revision) return
    if (typeof value === 'string') {
      try { if ((JSON.parse(value) as CloudCache).stamp === this.expectedStamp) return } catch { /* Preserve the live draft on damaged data. */ }
    }
    this.markConflict({ ok: false, code: 'conflict', message: '另一页面已修改这个档案。请先下载当前备份，再重新载入。' })
  }

  backup() { return JSON.stringify({ format: 'maker-island-cloud-conflict-v1', exportedAt: Date.now(), ...this.record }, null, 2) }
  dispose() { this.disposed = true; this.clearTimers(); this.onChange = undefined; if (typeof window !== 'undefined') window.removeEventListener('online', this.online) }
}

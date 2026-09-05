import { saveProfile } from './profiles'
import type { ProfileEnvelope } from './profiles'
import type { LearningProgress } from './types'

export type ProfileSaveState = 'saved' | 'saving' | 'error' | 'conflict'
type SaveResult = Awaited<ReturnType<typeof saveProfile>>

/** A queue belongs to one profile for its entire lifetime, including after unmount. */
export class ProfileWriter {
  private profile: ProfileEnvelope
  private desired: LearningProgress
  private queue: Promise<void> = Promise.resolve()
  private pending = 0
  private dirty = false
  private conflict = false
  state: ProfileSaveState = 'saved'
  message = ''
  onChange: (() => void) | undefined

  constructor(profile: ProfileEnvelope, private save = saveProfile) {
    this.profile = profile
    this.desired = profile.progress
  }

  get revision() { return this.profile.revision }
  get progress() { return this.desired }

  update(progress: LearningProgress) {
    this.desired = progress
    this.dirty = true
    this.pending += 1
    if (!this.conflict) this.state = 'saving'
    this.onChange?.()
    this.queue = this.queue.then(async () => {
      if (this.conflict) return
      // Coalesce queued updates: only the newest complete snapshot needs writing.
      if (!this.dirty) return
      const snapshot = this.desired
      let result: SaveResult
      try {
        result = await this.save(this.profile.id, snapshot, this.profile.revision)
      } catch {
        result = { ok: false, code: 'storage-unavailable', message: '暂时无法保存，当前作品仍留在页面中。' }
      }
      if (result.ok) {
        this.profile = result.profile
        this.dirty = snapshot !== this.desired
        if (!this.conflict) this.message = ''
      } else {
        this.conflict = result.code === 'conflict'
        this.state = this.conflict ? 'conflict' : 'error'
        this.message = result.message
      }
    }).finally(() => {
      this.pending -= 1
      if (!this.dirty && !this.conflict) this.state = this.pending ? 'saving' : 'saved'
      this.onChange?.()
    })
  }

  async flush() {
    await this.queue
    if (this.dirty && !this.conflict) {
      this.update(this.desired)
      await this.queue
    }
    return !this.dirty && !this.conflict
  }

  externalChange(revision: number | null) {
    if (revision === this.profile.revision) return
    this.conflict = true
    this.state = 'conflict'
    this.message = '这个用户的进度已在另一页面改变。请先保留当前备份，再重新载入。'
    this.onChange?.()
  }
}

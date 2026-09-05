// @vitest-environment node
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyProgress } from '../src/progress'
import type { LearningProgress } from '../src/types'
import worker, { type D1Binding, type D1Statement } from './index'

class SqliteStatement implements D1Statement {
  values: SQLInputValue[] = []
  constructor(public owner: SqliteD1, public sql: string) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this }
  async first<T>(): Promise<T | null> { return (this.owner.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null }
  async all<T>() { return { results: this.owner.sqlite.prepare(this.sql).all(...this.values) as T[], success: true } }
  async run() { return this.owner.sqlite.prepare(this.sql).run(...this.values) }
}

class SqliteD1 implements D1Binding {
  sqlite = new DatabaseSync(':memory:')
  failProjectWrite = false
  constructor() { this.sqlite.exec(readFileSync(new URL('../migrations/0001_cloud_profiles.sql', import.meta.url), 'utf8')) }
  prepare(sql: string) { return new SqliteStatement(this, sql) }
  async batch(statements: D1Statement[]) {
    this.sqlite.exec('BEGIN')
    try {
      const output = []
      for (const statement of statements as SqliteStatement[]) {
        if (this.failProjectWrite && statement.sql.startsWith('INSERT INTO projects')) throw new Error('Injected project write failure')
        output.push(this.sqlite.prepare(statement.sql).run(...statement.values))
      }
      this.sqlite.exec('COMMIT')
      return output
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }
}

type Client = { cookie?: string; spaceId?: string }
let db: SqliteD1
const origin = 'https://maker.example'

async function request(path: string, method = 'GET', body?: unknown, client: Client = {}, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { origin, ...extraHeaders }
  if (body !== undefined) headers['content-type'] ??= 'application/json'
  if (client.cookie) headers.cookie = client.cookie
  if (client.spaceId) headers['x-space-id'] = client.spaceId
  const response = await worker.fetch(new Request(`${origin}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), { DB: db })
  const data = await response.json() as Record<string, any>
  return { response, data }
}

async function createFamily() {
  const result = await request('/api/spaces', 'POST', {})
  expect(result.response.status).toBe(201)
  const client = { cookie: result.response.headers.get('set-cookie')!.split(';')[0], spaceId: result.data.space.id as string }
  return { ...result, client }
}

async function createProfile(client: Client, name = '小明') {
  const result = await request('/api/profiles', 'POST', { name }, client)
  expect(result.response.ok).toBe(true)
  return result.data.profile
}

function completedProgress(): LearningProgress {
  return {
    ...emptyProgress(), completedQuestIds: [1], starsByQuest: { 1: 3 }, badgesByQuest: { 1: ['completion', 'accuracy', 'independence'] },
    projects: { 1: { courseVersion: 2, shapes: [{ id: 'box-1', name: '方块', type: 'box', color: '#ff8800', position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }], operations: [], updatedAt: 1 } },
  }
}

beforeEach(() => { db = new SqliteD1() })
afterEach(() => { db.sqlite.close() })

describe('D1 cloud profile API against real SQLite transactions', () => {
  it('creates a private space, stores only token hashes, and enters from another device', async () => {
    const family = await createFamily()
    expect(family.data.inviteToken).toMatch(/^[a-f0-9]{64}$/)
    expect(family.response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict')
    expect(family.response.headers.get('set-cookie')).toContain('Secure')
    const stored = db.sqlite.prepare('SELECT invite_hash FROM spaces').get()!
    expect(stored.invite_hash).not.toBe(family.data.inviteToken)
    const sessionRow = db.sqlite.prepare('SELECT token_hash FROM sessions').get()!
    expect(family.client.cookie).not.toContain(sessionRow.token_hash)
    const joined = await request('/api/session', 'POST', { inviteToken: family.data.inviteToken })
    expect(joined.data.space.id).toBe(family.client.spaceId)
    const cookie = joined.response.headers.get('set-cookie')!.split(';')[0]
    expect((await request('/api/session', 'GET', undefined, { cookie })).data.space.id).toBe(family.client.spaceId)
    expect(joined.response.headers.get('cache-control')).toContain('no-store')
  })

  it('reuses normalized names within a family and isolates identical names in different families', async () => {
    const a = await createFamily()
    const b = await createFamily()
    const alice = await createProfile(a.client, ' Alice ')
    const same = await request('/api/profiles', 'POST', { name: 'ＡＬＩＣＥ' }, a.client)
    expect(same.data.created).toBe(false)
    expect(same.data.profile.id).toBe(alice.id)
    const other = await createProfile(b.client, 'Alice')
    expect(other.id).not.toBe(alice.id)
    expect((await request(`/api/profiles/${alice.id}`, 'GET', undefined, b.client)).response.status).toBe(404)
    const denied = await request(`/api/profiles/${alice.id}`, 'PUT', { expectedRevision: 1, mutationId: 'cross-family', progress: emptyProgress() }, b.client)
    expect(denied.response.status).toBe(404)
    const list = await request('/api/profiles', 'GET', undefined, b.client)
    expect(list.data.profiles.map((item: { id: string }) => item.id)).toEqual([other.id])
  })

  it('rejects profile access when another tab changed the family session', async () => {
    const a = await createFamily()
    const b = await createFamily()
    const switched = { cookie: b.client.cookie, spaceId: a.client.spaceId }
    for (const [path, method, body] of [['/api/profiles', 'GET', undefined], ['/api/profiles', 'POST', { name: '小明' }]] as const) {
      const result = await request(path, method, body, switched)
      expect(result.response.status).toBe(409)
      expect(result.data.code).toBe('session-changed')
    }
    const missing = await request('/api/profiles', 'GET', undefined, { cookie: a.client.cookie })
    expect(missing.data.code).toBe('session-changed')
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM profiles').get()!.n).toBe(0)
  })

  it('saves final progress and split projects atomically and rejects stale revisions without overwriting', async () => {
    const { client } = await createFamily()
    const profile = await createProfile(client)
    const saved = await request(`/api/profiles/${profile.id}`, 'PUT', { expectedRevision: 1, mutationId: 'save-first', progress: completedProgress() }, client)
    expect(saved.response.status).toBe(200)
    expect(saved.data.appliedRevision).toBe(2)
    expect(saved.data.profile.progress).toEqual(completedProgress())
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get()!.n).toBe(1)
    expect(JSON.parse(db.sqlite.prepare('SELECT summary_json FROM profiles').get()!.summary_json as string)).not.toHaveProperty('projects')
    const stale = await request(`/api/profiles/${profile.id}`, 'PUT', { expectedRevision: 1, mutationId: 'save-stale', progress: emptyProgress() }, client)
    expect(stale.response.status).toBe(409)
    expect(stale.data.profile.progress).toEqual(completedProgress())
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM profile_mutations').get()!.n).toBe(1)
  })

  it('allows only one of two concurrent writes and preserves the winner', async () => {
    const { client } = await createFamily()
    const profile = await createProfile(client)
    const results = await Promise.all([
      request(`/api/profiles/${profile.id}`, 'PUT', { expectedRevision: 1, mutationId: 'parallel-a', progress: completedProgress() }, client),
      request(`/api/profiles/${profile.id}`, 'PUT', { expectedRevision: 1, mutationId: 'parallel-b', progress: emptyProgress() }, client),
    ])
    expect(results.map((result) => result.response.status).sort()).toEqual([200, 409])
    const winner = results.find((result) => result.response.status === 200)!
    const current = await request(`/api/profiles/${profile.id}`, 'GET', undefined, client)
    expect(current.data.profile).toEqual(winner.data.profile)
    expect(current.data.profile.revision).toBe(2)
  })

  it('retries a mutation once only and rejects reuse with different contents', async () => {
    const { client } = await createFamily()
    const profile = await createProfile(client)
    const body = { expectedRevision: 1, mutationId: 'idempotent-save', progress: completedProgress() }
    await request(`/api/profiles/${profile.id}`, 'PUT', body, client)
    const replay = await request(`/api/profiles/${profile.id}`, 'PUT', body, client)
    expect(replay.data.profile.revision).toBe(2)
    const mismatch = await request(`/api/profiles/${profile.id}`, 'PUT', { ...body, progress: emptyProgress() }, client)
    expect(mismatch.data.code).toBe('invalid-mutation')
    await request(`/api/profiles/${profile.id}`, 'PUT', { expectedRevision: 2, mutationId: 'later-change', progress: emptyProgress() }, client)
    const laterReplay = await request(`/api/profiles/${profile.id}`, 'PUT', body, client)
    expect(laterReplay.data.appliedRevision).toBe(2)
    expect(laterReplay.data.profile.revision).toBe(3)
    expect(laterReplay.data.profile.progress).toEqual(emptyProgress())
  })

  it('rolls back revision, completion and mutation receipt when project storage fails', async () => {
    const { client } = await createFamily()
    const profile = await createProfile(client)
    db.failProjectWrite = true
    const body = { expectedRevision: 1, mutationId: 'failed-project', progress: completedProgress() }
    const failed = await request(`/api/profiles/${profile.id}`, 'PUT', body, client)
    expect(failed.response.status).toBe(503)
    expect((await request(`/api/profiles/${profile.id}`, 'GET', undefined, client)).data.profile.progress).toEqual(emptyProgress())
    expect(db.sqlite.prepare('SELECT revision FROM profiles').get()!.revision).toBe(1)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM profile_mutations').get()!.n).toBe(0)
    db.failProjectWrite = false
    expect((await request(`/api/profiles/${profile.id}`, 'PUT', body, client)).data.profile.revision).toBe(2)
  })

  it('rejects malformed models rather than silently cleaning away data', async () => {
    const { client } = await createFamily()
    const profile = await createProfile(client)
    const malformed = completedProgress()
    malformed.projects[1].shapes[0].scale.x = -3
    for (const progress of [malformed, { ...emptyProgress(), mysteryField: true }, { ...emptyProgress(), completedQuestIds: [2] }]) {
      const result = await request(`/api/profiles/${profile.id}`, 'PUT', { expectedRevision: 1, mutationId: 'invalid-data', progress }, client)
      expect(result.response.status).toBe(400)
    }
    expect(db.sqlite.prepare('SELECT revision FROM profiles').get()!.revision).toBe(1)
  })

  it('enforces same-origin JSON writes, methods, request limits and durable rate limits', async () => {
    expect((await request('/api/spaces', 'POST', {}, {}, { origin: 'https://evil.example' })).response.status).toBe(403)
    expect((await request('/api/spaces', 'POST', {}, {}, { 'content-type': 'text/plain' })).response.status).toBe(415)
    expect((await request('/api/spaces', 'GET')).response.status).toBe(405)
    expect((await request('/api/spaces', 'POST', { oversized: 'x'.repeat(1100) })).response.status).toBe(413)
    await createFamily()
    db.sqlite.exec('UPDATE rate_limits SET count = 10')
    const limited = await request('/api/spaces', 'POST', {})
    expect(limited.response.status).toBe(429)
    expect(limited.data.code).toBe('rate-limited')
  })

  it('requires HTTPS outside loopback development and returns an empty HEAD health response', async () => {
    const insecure = await worker.fetch(new Request('http://maker.example/api/spaces', { method: 'POST', headers: { origin: 'http://maker.example', 'content-type': 'application/json' }, body: '{}' }), { DB: db })
    expect(insecure.status).toBe(403)
    expect((await insecure.json() as { code: string }).code).toBe('https-required')
    const local = await worker.fetch(new Request('http://127.0.0.1:5173/api/spaces', { method: 'POST', headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }, body: '{}' }), { DB: db })
    expect(local.status).toBe(201)
    expect(local.headers.get('set-cookie')).not.toContain('Secure')
    const head = await worker.fetch(new Request(`${origin}/api/health`, { method: 'HEAD' }), { DB: db })
    expect(await head.text()).toBe('')
    const missingOrigin = await worker.fetch(new Request(`${origin}/api/spaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), { DB: db })
    expect(missingOrigin.status).toBe(403)
  })

  it('expires and revokes sessions and never exposes a family invite through read endpoints', async () => {
    const family = await createFamily()
    expect((await request('/api/session')).response.status).toBe(401)
    const current = await request('/api/session', 'GET', undefined, family.client)
    expect(JSON.stringify(current.data)).not.toContain(family.data.inviteToken)
    expect((await request('/api/session', 'DELETE', undefined, family.client)).response.status).toBe(200)
    expect((await request('/api/session', 'GET', undefined, family.client)).response.status).toBe(401)
    const joined = await request('/api/session', 'POST', { inviteToken: family.data.inviteToken })
    const client = { cookie: joined.response.headers.get('set-cookie')!.split(';')[0] }
    db.sqlite.exec('UPDATE sessions SET expires_at = 0')
    expect((await request('/api/session', 'GET', undefined, client)).response.status).toBe(401)
  })
})

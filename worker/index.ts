import type { CloudProfileEnvelope, CloudProfileSummary, CloudSpace } from '../src/cloudTypes'
import { normalizeProfileName } from '../src/profiles'
import { cleanProgress, emptyProgress } from '../src/progress'
import type { LearningProgress, QuestProject } from '../src/types'

export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>
  run(): Promise<unknown>
}

export interface D1Binding {
  prepare(sql: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown[]>
}

export interface Env { DB: D1Binding }

const COOKIE = 'maker_island_session'
const SESSION_SECONDS = 180 * 24 * 60 * 60
const MAX_REQUEST_BYTES = 2_000_000
const MAX_PROJECT_BYTES = 250_000
const encoder = new TextEncoder()
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  },
})

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sessionCookie(request: Request, token: string, maxAge = SESSION_SECONDS) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
}

function checkMethod(request: Request, allowed: string[]) {
  if (!allowed.includes(request.method)) throw new ApiError(405, 'method-not-allowed', '这个操作不支持当前请求方式。', { allow: allowed.join(', ') })
}

function checkOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const sameOrigin = new URL(request.url).origin
  if ((origin !== null && origin !== sameOrigin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'invalid-origin', '请从本站打开家庭入口。')
  }
  if (!['GET', 'HEAD'].includes(request.method) && origin !== sameOrigin) {
    throw new ApiError(403, 'invalid-origin', '请从本站重新尝试保存。')
  }
}

async function readJson(request: Request, maxBytes = MAX_REQUEST_BYTES): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'invalid-content-type', '请求需要使用 JSON 数据。')
  }
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > maxBytes) throw new ApiError(413, 'too-large', '作品数据太大，请减少零件或操作记录后重试。')
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError(400, 'invalid-data', '没有收到要保存的数据。')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new ApiError(413, 'too-large', '作品数据太大，请减少零件或操作记录后重试。')
    }
    chunks.push(part.value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  try {
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
    if (isRecord(data)) return data
  } catch { /* Return one consistent validation response. */ }
  throw new ApiError(400, 'invalid-data', '数据格式无法读取，尚未覆盖云端作品。')
}

async function rateLimit(db: D1Binding, key: string, maximum: number, windowMs: number) {
  const start = Math.floor(Date.now() / windowMs) * windowMs
  const row = await db.prepare(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
      window_start = excluded.window_start RETURNING count`).bind(key, start).first<{ count: number }>()
  if (!row || row.count > maximum) throw new ApiError(429, 'rate-limited', '操作有点频繁，请稍后再重试。')
}

async function requestIpKey(request: Request) {
  return hash(request.headers.get('cf-connecting-ip') ?? 'local-development')
}

async function getSpace(request: Request, db: D1Binding): Promise<CloudSpace> {
  const token = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'no-session', '请先打开家庭私密链接，或创建一个新家庭。')
  const row = await db.prepare(`SELECT spaces.id, spaces.created_at FROM sessions JOIN spaces ON spaces.id = sessions.space_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).bind(await hash(token), Date.now()).first<{ id: string; created_at: number }>()
  if (!row) throw new ApiError(401, 'no-session', '家庭入口已过期，请重新打开家庭私密链接。')
  return { id: row.id, createdAt: row.created_at }
}

async function startSession(request: Request, db: D1Binding, space: CloudSpace) {
  const token = randomToken()
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()),
    db.prepare('INSERT INTO sessions (token_hash, space_id, expires_at) VALUES (?, ?, ?)').bind(await hash(token), space.id, Date.now() + SESSION_SECONDS * 1000),
  ])
  return sessionCookie(request, token)
}

interface ProfileRow {
  id: string
  space_id: string
  name: string
  normalized_name: string
  revision: number
  created_at: number
  updated_at: number
  summary_json: string
  projects_json?: string
}

function summary(row: ProfileRow): CloudProfileSummary {
  return { id: row.id, spaceId: row.space_id, name: row.name, normalizedName: row.normalized_name, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }
}

async function getProfile(db: D1Binding, spaceId: string, profileId: string): Promise<CloudProfileEnvelope> {
  // A single SQL statement reads progress + projects from the same snapshot.
  const row = await db.prepare(`SELECT profiles.*, COALESCE((SELECT json_group_array(json_object(
      'questId', quest_id, 'kind', kind, 'project', json(project_json))) FROM projects WHERE profile_id = profiles.id), '[]') AS projects_json
    FROM profiles WHERE id = ? AND space_id = ?`).bind(profileId, spaceId).first<ProfileRow>()
  if (!row) throw new ApiError(404, 'not-found', '找不到这个家庭里的用户，请重新选择。')
  const progress = JSON.parse(row.summary_json) as LearningProgress
  progress.projects = {}
  progress.legacyProjects = {}
  for (const item of JSON.parse(row.projects_json ?? '[]') as { questId: number; kind: string; project: QuestProject }[]) {
    const target = item.kind === 'legacy' ? progress.legacyProjects : progress.projects
    target[item.questId] = item.project
  }
  return { ...summary(row), version: 1, progress }
}

function validateProgress(data: unknown): LearningProgress {
  if (!isRecord(data) || data.version !== 2 || data.curriculumVersion !== 2) throw new ApiError(400, 'invalid-data', '课程档案版本无法读取，尚未覆盖云端作品。')
  const cleaned = cleanProgress(data)
  if (canonicalJson(cleaned) !== canonicalJson(data)) throw new ApiError(400, 'invalid-data', '档案中存在不完整或不支持的数据，尚未覆盖云端作品。')
  for (const project of [...Object.values(cleaned.projects), ...Object.values(cleaned.legacyProjects)]) {
    if (encoder.encode(JSON.stringify(project)).byteLength > MAX_PROJECT_BYTES) throw new ApiError(413, 'too-large', '单个作品数据太大，请减少零件或操作记录后重试。')
  }
  return cleaned
}

function splitProgress(progress: LearningProgress) {
  const { projects, legacyProjects, ...metadata } = progress
  const rows = [
    ...Object.entries(projects).map(([questId, project]) => ({ questId: Number(questId), courseVersion: 2, kind: 'current', project })),
    ...Object.entries(legacyProjects).map(([questId, project]) => ({ questId: Number(questId), courseVersion: project.courseVersion ?? 1, kind: 'legacy', project })),
  ]
  return { metadata: JSON.stringify(metadata), projects: JSON.stringify(rows) }
}

async function saveProfile(request: Request, db: D1Binding, space: CloudSpace, id: string) {
  const body = await readJson(request)
  const { expectedRevision, mutationId } = body
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1 || (expectedRevision as number) >= Number.MAX_SAFE_INTEGER || typeof mutationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(mutationId)) {
    throw new ApiError(400, 'invalid-data', '保存版本或请求编号无效，请重新打开档案。')
  }
  const progress = validateProgress(body.progress)
  await getProfile(db, space.id, id)
  const requestHash = await hash(canonicalJson({ expectedRevision, progress }))
  const existingMutation = async () => db.prepare('SELECT request_hash, expected_revision FROM profile_mutations WHERE profile_id = ? AND mutation_id = ? AND space_id = ?')
    .bind(id, mutationId, space.id).first<{ request_hash: string; expected_revision: number }>()
  const replay = async (mutation: { request_hash: string; expected_revision: number }) => {
    if (mutation.request_hash !== requestHash) throw new ApiError(400, 'invalid-mutation', '这次保存编号与原数据不一致，请重新尝试。')
    return json({ ok: true, profile: await getProfile(db, space.id, id), appliedRevision: mutation.expected_revision + 1 })
  }
  const previous = await existingMutation()
  if (previous) return replay(previous)
  await rateLimit(db, `write:${space.id}`, 180, 60_000)
  const now = Date.now()
  const parts = splitProgress(progress)
  try {
    await db.batch([
      db.prepare('INSERT INTO profile_mutations (profile_id, mutation_id, space_id, expected_revision, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, mutationId, space.id, expectedRevision, requestHash, now),
      db.prepare('UPDATE profiles SET revision = revision + 1, summary_json = ?, updated_at = ? WHERE id = ? AND space_id = ?')
        .bind(parts.metadata, now, id, space.id),
      db.prepare('DELETE FROM projects WHERE profile_id = ?').bind(id),
      db.prepare(`INSERT INTO projects (profile_id, course_version, quest_id, kind, project_json)
        SELECT ?, json_extract(value, '$.courseVersion'), json_extract(value, '$.questId'), json_extract(value, '$.kind'), json_extract(value, '$.project') FROM json_each(?)`)
        .bind(id, parts.projects),
      db.prepare('DELETE FROM profile_mutations WHERE profile_id = ? AND expected_revision < ?').bind(id, (expectedRevision as number) - 500),
    ])
  } catch (error) {
    // A concurrent retry may commit between the initial lookup and this batch.
    const mutation = await existingMutation()
    if (mutation) return replay(mutation)
    const current = await getProfile(db, space.id, id)
    if (current.revision !== expectedRevision) throw new ApiError(409, 'conflict', '另一个设备已经更新了这个作品，两份内容都已保留，请选择要继续的版本。', { profile: current })
    throw error
  }
  return json({ ok: true, profile: await getProfile(db, space.id, id), appliedRevision: (expectedRevision as number) + 1 })
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/api/health') {
    checkMethod(request, ['GET', 'HEAD'])
    if (request.method === 'HEAD') return new Response(null, { headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } })
    return json({ ok: true, service: 'maker-island', version: '0.2.0' })
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new ApiError(403, 'https-required', '请通过 HTTPS 网站地址打开家庭存档。')
  }
  checkOrigin(request)
  if (!env?.DB) throw new ApiError(503, 'database-unavailable', '云端存档尚未配置完成，请稍后重试。')
  const db = env.DB

  if (url.pathname === '/api/spaces') {
    checkMethod(request, ['POST'])
    await readJson(request, 1024)
    await rateLimit(db, `create:${await requestIpKey(request)}`, 10, 3_600_000)
    const inviteToken = randomToken()
    const space: CloudSpace = { id: crypto.randomUUID(), createdAt: Date.now() }
    await db.prepare('INSERT INTO spaces (id, invite_hash, created_at) VALUES (?, ?, ?)').bind(space.id, await hash(inviteToken), space.createdAt).run()
    return json({ ok: true, space, inviteToken }, 201, { 'set-cookie': await startSession(request, db, space) })
  }

  if (url.pathname === '/api/session') {
    checkMethod(request, ['GET', 'POST', 'DELETE'])
    if (request.method === 'GET') return json({ ok: true, space: await getSpace(request, db) })
    if (request.method === 'DELETE') {
      const token = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
      if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(token)).run()
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) })
    }
    const body = await readJson(request, 1024)
    await rateLimit(db, `join:${await requestIpKey(request)}`, 30, 60_000)
    if (typeof body.inviteToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.inviteToken)) throw new ApiError(400, 'invalid-invite', '家庭私密链接不完整，请检查后重新打开。')
    const row = await db.prepare('SELECT id, created_at FROM spaces WHERE invite_hash = ?').bind(await hash(body.inviteToken)).first<{ id: string; created_at: number }>()
    if (!row) throw new ApiError(404, 'invalid-invite', '这个家庭私密链接无法使用，请检查是否复制完整。')
    const space: CloudSpace = { id: row.id, createdAt: row.created_at }
    return json({ ok: true, space }, 200, { 'set-cookie': await startSession(request, db, space) })
  }

  if (url.pathname === '/api/profiles' || /^\/api\/profiles\/[A-Za-z0-9_-]{1,100}$/.test(url.pathname)) {
    const space = await getSpace(request, db)
    if (request.headers.get('x-space-id') !== space.id) throw new ApiError(409, 'session-changed', '另一个页面切换了家庭。当前内容已保留，请重新进入原家庭后同步。')
    if (url.pathname === '/api/profiles') {
      checkMethod(request, ['GET', 'POST'])
      if (request.method === 'GET') {
        const { results } = await db.prepare('SELECT id, space_id, name, normalized_name, revision, created_at, updated_at FROM profiles WHERE space_id = ? ORDER BY updated_at DESC, name').bind(space.id).all<ProfileRow>()
        return json({ ok: true, profiles: results.map(summary) })
      }
      const body = await readJson(request, 1024)
      const name = typeof body.name === 'string' ? normalizeProfileName(body.name) : null
      if (!name) throw new ApiError(400, 'invalid-name', '用户名请填写 1～16 个中文、字母、数字或下划线。')
      await rateLimit(db, `profile:${space.id}`, 60, 60_000)
      const id = crypto.randomUUID()
      const now = Date.now()
      await db.prepare(`INSERT INTO profiles (id, space_id, name, normalized_name, revision, created_at, updated_at, summary_json)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(space_id, normalized_name) DO NOTHING`)
        .bind(id, space.id, name.name, name.normalizedName, now, now, splitProgress(emptyProgress()).metadata).run()
      const row = await db.prepare('SELECT id FROM profiles WHERE space_id = ? AND normalized_name = ?').bind(space.id, name.normalizedName).first<{ id: string }>()
      if (!row) throw new ApiError(503, 'database-unavailable', '云端暂时无法建立档案，请重试。')
      return json({ ok: true, profile: await getProfile(db, space.id, row.id), created: row.id === id }, row.id === id ? 201 : 200)
    }
    checkMethod(request, ['GET', 'PUT'])
    const id = url.pathname.slice('/api/profiles/'.length)
    if (request.method === 'GET') return json({ ok: true, profile: await getProfile(db, space.id, id) })
    return saveProfile(request, db, space, id)
  }
  throw new ApiError(404, 'not-found', '没有找到这个接口。')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handle(request, env) } catch (error) {
      if (error instanceof ApiError) {
        const { allow, ...extra } = error.extra
        return json({ ok: false, code: error.code, message: error.message, ...extra }, error.status, typeof allow === 'string' ? { allow } : {})
      }
      // Never log request bodies, family tokens, cookies or children's models.
      return json({ ok: false, code: 'server-error', message: '云端暂时无法完成保存，请保留本机内容并稍后重试。' }, 503)
    }
  },
}

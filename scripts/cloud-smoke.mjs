import assert from 'node:assert/strict'

// Only the explicitly read-only mode may target a deployment. The full smoke
// suite creates synthetic families and is always restricted to localhost.
const args = process.argv.slice(2)
const readinessOnly = args.includes('--readiness-only')
const addresses = args.filter((arg) => arg !== '--readiness-only')
if (addresses.length > 1 || addresses.some((arg) => arg.startsWith('--'))) throw new Error('Usage: node scripts/cloud-smoke.mjs [URL] [--readiness-only]')
const base = new URL(addresses[0] ?? 'http://127.0.0.1:5183')
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
if (!local && !readinessOnly) throw new Error('Full smoke tests only support localhost. Use --readiness-only for a deployment.')
if (!local && base.protocol !== 'https:') throw new Error('Deployment readiness checks require HTTPS.')
if (base.username || base.password) throw new Error('Do not include credentials in the readiness URL.')
const checks = []
function client() {
  let cookie = ''
  let spaceId = ''
  return {
    setSpace(id) { spaceId = id },
    async api(path, method = 'GET', data, extraHeaders = {}) {
      const response = await fetch(new URL(path, base), {
        method,
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
        headers: { Origin: base.origin, 'Content-Type': 'application/json', Cookie: cookie, ...(spaceId ? { 'X-Space-ID': spaceId } : {}), ...extraHeaders },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      return { status: response.status, body: await response.json(), headers: response.headers }
    },
  }
}

const first = client()
const ready = await first.api('/api/ready')
assert.equal(ready.status, 200, `Database is not ready: ${ready.body.code ?? 'unknown'}; request ${ready.body.requestId ?? 'unknown'}`)
assert.deepEqual(ready.body, { ok: true, service: 'maker-island', ready: true })
assert.match(ready.headers.get('cache-control'), /no-store/)
const readyHead = await fetch(new URL('/api/ready', base), { method: 'HEAD', signal: AbortSignal.timeout(15_000), redirect: 'error' })
assert.equal(readyHead.status, 200)
assert.equal(await readyHead.text(), '')
checks.push('read-only database readiness for GET and HEAD')
if (readinessOnly) {
  console.log(JSON.stringify({ ok: true, checks }, null, 2))
  process.exit(0)
}
assert.equal((await first.api('/api/session')).status, 401)
const family = await first.api('/api/spaces', 'POST', {})
assert.equal(family.body.ok, true)
assert.match(family.headers.get('set-cookie'), /HttpOnly/i)
assert.match(family.headers.get('set-cookie'), /SameSite=Strict/i)
assert.match(family.headers.get('cache-control'), /no-store/)
first.setSpace(family.body.space.id)
checks.push('private family session and no-store headers')

const entry = await first.api('/api/profiles', 'POST', { name: '云端验收' })
assert.equal(entry.body.ok, true)
const profile = entry.body.profile
const progress = structuredClone(profile.progress)
progress.projects[1] = {
  courseVersion: 2,
  shapes: [{ id: 'smoke-box', name: '测试方块', type: 'box', color: '#ff8844', position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }],
  operations: [{ type: 'add', at: 100 }], updatedAt: 100,
}
const mutation = { progress, expectedRevision: profile.revision, mutationId: crypto.randomUUID() }
const saved = await first.api(`/api/profiles/${profile.id}`, 'PUT', mutation)
assert.equal(saved.body.ok, true)
assert.equal(saved.body.profile.revision, profile.revision + 1)
assert.deepEqual(saved.body.profile.progress.projects[1], progress.projects[1])
const replay = await first.api(`/api/profiles/${profile.id}`, 'PUT', mutation)
assert.equal(replay.body.ok, true)
assert.equal(replay.body.profile.revision, saved.body.profile.revision)
checks.push('model JSON save and idempotent retry')

const second = client()
const joined = await second.api('/api/session', 'POST', { inviteToken: family.body.inviteToken })
assert.equal(joined.body.ok, true)
second.setSpace(joined.body.space.id)
const reopened = await second.api('/api/profiles', 'POST', { name: ' 云端验收 ' })
assert.equal(reopened.body.profile.id, profile.id)
assert.deepEqual(reopened.body.profile.progress, progress)
checks.push('independent device session restores same model')

const foreign = client()
const otherFamily = await foreign.api('/api/spaces', 'POST', {})
assert.equal(otherFamily.body.ok, true)
foreign.setSpace(otherFamily.body.space.id)
const sameName = await foreign.api('/api/profiles', 'POST', { name: '云端验收' })
assert.notEqual(sameName.body.profile.id, profile.id)
assert.deepEqual(sameName.body.profile.progress.projects, {})
assert.equal((await foreign.api(`/api/profiles/${profile.id}`)).status, 404)
const changedSession = await foreign.api('/api/profiles', 'POST', { name: '不能串家' }, { 'X-Space-ID': family.body.space.id })
assert.equal(changedSession.body.code, 'session-changed')
checks.push('same-name family isolation and stale-tab protection')

const newer = structuredClone(progress)
newer.projects[1].shapes[0].position.x = 2
const edited = await second.api(`/api/profiles/${profile.id}`, 'PUT', {
  progress: newer, expectedRevision: saved.body.profile.revision, mutationId: crypto.randomUUID(),
})
assert.equal(edited.body.ok, true)
const stale = await first.api(`/api/profiles/${profile.id}`, 'PUT', { ...mutation, expectedRevision: saved.body.profile.revision, mutationId: crypto.randomUUID() })
assert.equal(stale.status, 409)
assert.equal(stale.body.code, 'conflict')
assert.deepEqual((await first.api(`/api/profiles/${profile.id}`)).body.profile.progress, newer)
checks.push('stale revision rejected without overwriting project')

const denied = await first.api('/api/profiles', 'POST', { name: '跨站' }, { Origin: 'https://untrusted.example' })
assert.equal(denied.status, 403)
checks.push('cross-origin writes rejected')
console.log(JSON.stringify({ ok: true, checks }, null, 2))

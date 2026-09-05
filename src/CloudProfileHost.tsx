import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FamilyGate, FamilyInvite } from './FamilyGate'
import { ProfileGate } from './ProfileGate'
import {
  createCloudSpace, enterCloudProfile, getCloudProfile, getCloudSession,
  joinCloudSpace, listCloudProfiles,
} from './cloudProfiles'
import type { CloudProfileEnvelope, CloudProfileSummary, CloudSpace } from './cloudTypes'

const inviteKey = (spaceId: string) => `maker-island-cloud-invite-v1:${spaceId}`
const profileKey = (spaceId: string) => `maker-island-cloud-last-profile-v1:${spaceId}`

function readRemembered(key: string, session = false): string | null {
  try { return (session ? sessionStorage : localStorage).getItem(key) } catch { return null }
}

function remember(key: string, value: string, session = false) {
  try { (session ? sessionStorage : localStorage).setItem(key, value) } catch { /* Optional shortcuts, never the draft store. */ }
}

export function familyInviteToken(input: string): string | null {
  const value = input.trim()
  if (/^[A-Za-z0-9_-]{43,128}$/.test(value)) return value
  try {
    const url = new URL(value)
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return null
    const token = new URLSearchParams(url.hash.slice(1)).get('family')
    return token && /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : null
  } catch { return null }
}

function inviteLink(spaceId: string) {
  const token = readRemembered(inviteKey(spaceId))
  return token ? `${window.location.origin}${window.location.pathname}#family=${token}` : ''
}

interface WorkspaceControls {
  profile: CloudProfileEnvelope
  inviteLink: string
  onChooseProfile: () => void
  onReloadProfile: () => void
  onReconnectFamily: () => Promise<void>
  registerCheckpoint: (save: () => Promise<boolean>) => () => void
  reloadError: string
}

/** Family credentials are never derived from the child name or a previous local profile. */
export function CloudProfileHost({ workspace }: { workspace: (controls: WorkspaceControls) => ReactNode }) {
  const [space, setSpace] = useState<CloudSpace | null>(null)
  const [active, setActive] = useState<CloudProfileEnvelope | null>(null)
  const [directory, setDirectory] = useState<CloudProfileSummary[]>([])
  const [choosing, setChoosing] = useState(false)
  const [starting, setStarting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newInvite, setNewInvite] = useState('')
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0)
  const [navigating, setNavigating] = useState(false)
  const entering = useRef(false)
  const checkpoint = useRef<(() => Promise<boolean>) | null>(null)
  const bootstrap = useRef<Promise<Awaited<ReturnType<typeof getCloudSession>>> | null>(null)

  const registerCheckpoint = useCallback((save: () => Promise<boolean>) => {
    checkpoint.current = save
    return () => { if (checkpoint.current === save) checkpoint.current = null }
  }, [])

  useEffect(() => {
    const followFamilyLink = async () => {
      const target = window.location.hash
      if (!new URLSearchParams(target.slice(1)).has('family')) return
      setNavigating(true)
      const saved = checkpoint.current ? await checkpoint.current() : true
      if (!saved) {
        setError('当前草稿尚未安全保存。请先处理保存提示，再打开其他家庭入口。')
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`)
        setNavigating(false)
        return
      }
      // A same-document hash navigation must go through the full invitation flow.
      if (window.location.hash === target) window.location.reload()
      else setNavigating(false)
    }
    window.addEventListener('hashchange', followFamilyLink)
    return () => window.removeEventListener('hashchange', followFamilyLink)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!bootstrap.current) {
      const fragment = new URLSearchParams(window.location.hash.slice(1))
      const token = fragment.get('family')
      // Remove the capability from browser history before any API call or route change.
      if (token !== null) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`)
      bootstrap.current = token !== null ? joinCloudSpace(token).then((result) => {
        if (result.ok) remember(inviteKey(result.space.id), token)
        return result
      }) : getCloudSession()
    }
    void bootstrap.current.then(async (result) => {
      if (cancelled) return
      const current = result.ok ? result.space : null
      if (!current) {
        if (!result.ok && result.code !== 'unauthorized' && result.code !== 'no-session') setError(result.message)
        setStarting(false)
        return
      }
      setSpace(current)
      const profiles = await listCloudProfiles(current.id)
      if (cancelled) return
      if (profiles.ok) setDirectory(profiles.profiles)
      else setError(profiles.message)
      const id = readRemembered(profileKey(current.id), true)
      if (id) {
        const profile = await getCloudProfile(current.id, id)
        if (cancelled) return
        if (profile.ok) setActive(profile.profile)
        else setError(profile.message)
      }
      setStarting(false)
    }).catch(() => {
      if (!cancelled) { setStarting(false); setError('暂时无法连接家庭云端，请刷新重试。') }
    })
    return () => { cancelled = true }
  }, [])

  const openFamily = async (input?: string) => {
    if (entering.current) return
    const token = input === undefined ? null : familyInviteToken(input)
    if (input !== undefined && !token) { setError('请粘贴这个网站的完整家庭入口链接。'); return }
    entering.current = true
    setBusy(true)
    setError('')
    try {
      const result = token ? await joinCloudSpace(token) : await createCloudSpace()
      if (!result.ok) { setError(result.message); return }
      const savedToken = token ?? ('inviteToken' in result && typeof result.inviteToken === 'string' ? result.inviteToken : '')
      if (savedToken) remember(inviteKey(result.space.id), savedToken)
      setSpace(result.space)
      setActive(null)
      setDirectory([])
      if (!token && savedToken) setNewInvite(`${window.location.origin}${window.location.pathname}#family=${savedToken}`)
      const profiles = await listCloudProfiles(result.space.id)
      if (profiles.ok) setDirectory(profiles.profiles)
      else setError(profiles.message)
    } catch { setError('暂时无法打开家庭入口，请检查网络后重试。') }
    finally { entering.current = false; setBusy(false) }
  }

  const chooseProfile = useCallback(() => {
    if (!space) return
    setError('')
    setChoosing(true)
    void listCloudProfiles(space.id).then((result) => {
      if (result.ok) setDirectory(result.profiles)
      else setError(result.message)
    })
  }, [space])

  const enter = async (name: string) => {
    if (!space || entering.current) return
    entering.current = true
    setBusy(true)
    setError('')
    try {
      const result = await enterCloudProfile(space.id, name)
      if (!result.ok) { setError(result.message); return }
      remember(profileKey(space.id), result.profile.id)
      remember(profileKey(space.id), result.profile.id, true)
      if (active?.id !== result.profile.id) window.location.hash = '/'
      setActive(result.profile)
      setWorkspaceEpoch((value) => value + 1)
      setChoosing(false)
    } catch { setError('暂时无法打开这个名字的档案，请重试。原有进度仍被保留。') }
    finally { entering.current = false; setBusy(false) }
  }

  const reloadProfile = async () => {
    if (!space || !active || entering.current) return
    entering.current = true
    try {
      const result = await getCloudProfile(space.id, active.id, { discardPending: true })
      if (!result.ok) { setError(result.message); return }
      setActive(result.profile)
      setWorkspaceEpoch((value) => value + 1)
      setError('')
    } finally { entering.current = false }
  }

  const reconnectFamily = async () => {
    if (!space || !active || entering.current) return
    const token = readRemembered(inviteKey(space.id))
    if (!token) { setError('此设备没有保留家庭入口。请在地址栏打开最初保存的完整家庭链接，本机草稿不会被删除。'); return }
    entering.current = true
    try {
      const session = await joinCloudSpace(token)
      if (!session.ok) { setError(session.message); return }
      if (session.space.id !== space.id) { setError('这个入口不属于当前家庭，请使用原家庭链接。'); return }
      const result = await getCloudProfile(space.id, active.id)
      if (!result.ok) { setError(result.message); return }
      setActive(result.profile)
      setWorkspaceEpoch((value) => value + 1)
      setError('')
    } catch { setError('暂时无法重新连接家庭。当前草稿仍被保留，请稍后重试。') }
    finally { entering.current = false }
  }

  if (starting) return <main className="profile-gate"><p role="status">正在打开家庭云端…</p></main>
  if (!space) return <FamilyGate busy={busy} error={error} onCreate={() => void openFamily()} onJoin={(input) => void openFamily(input)} />
  if (newInvite) return <FamilyInvite link={newInvite} onContinue={() => setNewInvite('')} />
  return <>
    {active && <div hidden={choosing} inert={navigating || undefined} key={`${active.spaceId}:${active.id}:${workspaceEpoch}`}>
      {workspace({ profile: active, inviteLink: inviteLink(space.id), onChooseProfile: chooseProfile, onReloadProfile: () => void reloadProfile(), onReconnectFamily: reconnectFamily, registerCheckpoint, reloadError: error })}
    </div>}
    {(!active || choosing) && <ProfileGate
      profiles={directory}
      lastProfileId={choosing ? undefined : readRemembered(profileKey(space.id)) ?? undefined}
      legacyPending={false}
      busy={busy}
      error={error}
      onEnter={(name) => void enter(name)}
      onCancel={active ? () => { setError(''); setChoosing(false) } : undefined}
    />}
  </>
}

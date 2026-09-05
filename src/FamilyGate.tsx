import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './profiles.css'
import './family.css'

export interface FamilyGateProps {
  busy: boolean
  error: string
  onCreate: () => void
  /** The parent validates a private link or an entry code. */
  onJoin: (raw: string) => void
}

function FamilyLandscape() {
  return (
    <div className="profile-gate-landscape" aria-hidden="true">
      <span className="profile-shape profile-shape-cube" />
      <span className="profile-shape profile-shape-sphere" />
      <span className="profile-shape profile-shape-cylinder" />
    </div>
  )
}

export function FamilyGate({ busy, error, onCreate, onJoin }: FamilyGateProps) {
  const headingId = useId()
  const inputId = useId()
  const joinId = useId()
  const errorId = useId()
  const [joining, setJoining] = useState(false)
  const [entry, setEntry] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!busy && entry.trim()) onJoin(entry.trim())
  }

  return (
    <main className="profile-gate family-gate" aria-busy={busy}>
      <FamilyLandscape />
      <section className="profile-gate-card family-gate-card" aria-labelledby={headingId}>
        <div className="profile-gate-brand"><span aria-hidden="true">✦</span> 造物岛</div>
        <div className="profile-gate-emblem" aria-hidden="true">🏡</div>
        <h1 id={headingId}>给作品安一个家</h1>
        <p className="profile-gate-intro">请家长先创建家庭空间。孩子以后只填名字，就能接着冒险。</p>
        <div className="family-gate-actions">
          {!joining && (
            <button className="profile-primary-button" type="button" disabled={busy} onClick={onCreate}>
              {busy ? '正在创建…' : '创建家庭空间'}<span aria-hidden="true"> →</span>
            </button>
          )}
          <button
            className="profile-text-button"
            type="button"
            disabled={busy}
            aria-expanded={joining}
            aria-controls={joinId}
            onClick={() => setJoining((value) => !value)}
          >
            {joining ? '返回创建家庭空间' : '已有家庭入口'}
          </button>
        </div>
        {joining && (
          <form className="family-join-form" id={joinId} onSubmit={submit}>
            <div className="profile-input-group">
              <label htmlFor={inputId}>粘贴家庭链接或入口码</label>
              <input
                id={inputId}
                type="text"
                name="familyEntry"
                value={entry}
                autoFocus
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="go"
                disabled={busy}
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                placeholder="粘贴家长保存的私密入口"
                onChange={(event) => setEntry(event.target.value)}
              />
            </div>
            <button className="profile-primary-button" type="submit" disabled={busy || !entry.trim()}>
              {busy ? '正在打开…' : '进入家庭空间'}<span aria-hidden="true"> →</span>
            </button>
          </form>
        )}
        {error && <p className="profile-gate-error" id={errorId} role="alert">{error}</p>}
        <p className="profile-local-note">作品自动保存到云端。换设备时，打开同一个家庭入口即可。</p>
      </section>
    </main>
  )
}

export interface FamilyInviteProps {
  link: string
  onContinue: () => void
}

export function FamilyInvite({ link, onContinue }: FamilyInviteProps) {
  const headingId = useId()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')

  const copyLink = async () => {
    setCopyState('copying')
    try {
      await navigator.clipboard.writeText(link)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  return (
    <main className="profile-gate family-gate">
      <FamilyLandscape />
      <section className="profile-gate-card family-gate-card family-invite-card" aria-labelledby={headingId}>
        <div className="profile-gate-brand"><span aria-hidden="true">✦</span> 造物岛</div>
        <h1 id={headingId}>保存你的家庭入口</h1>
        <p className="profile-gate-intro">家庭空间准备好了。把入口交给家长保存，换一台设备也能找回作品。</p>
        <div className="profile-input-group">
          <label htmlFor={inputId}>家庭私密链接</label>
          <input
            ref={inputRef}
            id={inputId}
            className="family-invite-link"
            type="text"
            value={link}
            readOnly
            autoComplete="off"
            spellCheck={false}
            onFocus={(event) => event.target.select()}
          />
        </div>
        <div className="family-copy-row">
          <button className="family-copy-button" type="button" disabled={copyState === 'copying'} onClick={() => void copyLink()}>
            {copyState === 'copying' ? '正在复制…' : copyState === 'copied' ? '已复制链接 ✓' : '复制家庭链接'}
          </button>
          <p className="family-copy-message" role="status">
            {copyState === 'copied' ? '请把链接粘贴到家长方便找回的地方。' : copyState === 'failed' ? '自动复制未成功，请选中上方链接手动复制。' : '请复制上方完整链接，交给家长妥善保存。'}
          </p>
        </div>
        <p className="family-invite-note">持有链接的人可以查看和修改这个家庭的档案，请只分享给家人。</p>
        <button className="profile-primary-button family-continue-button" type="button" onClick={onContinue}>
          我已保存，开始冒险<span aria-hidden="true"> →</span>
        </button>
        <p className="profile-local-note">进入后，也可以在家长中心再次查看入口。</p>
      </section>
    </main>
  )
}

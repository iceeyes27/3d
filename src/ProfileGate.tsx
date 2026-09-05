import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import './profiles.css'

export interface ProfileGateProps {
  profiles: { id: string; name: string }[]
  lastProfileId?: string
  legacyPending: boolean
  busy: boolean
  error: string
  onEnter: (name: string) => void
  onCancel?: () => void
}

/** The entry screen only collects a name; the parent owns all profile data. */
export function ProfileGate({
  profiles,
  lastProfileId,
  legacyPending,
  busy,
  error,
  onEnter,
  onCancel,
}: ProfileGateProps) {
  const inputId = useId()
  const helpId = useId()
  const errorId = useId()
  const pickerId = useId()
  const lastProfile = profiles.find((profile) => profile.id === lastProfileId)
  const [choosing, setChoosing] = useState(!lastProfile || legacyPending)
  const [name, setName] = useState('')
  const normalizedName = name.normalize('NFKC').trim().toLowerCase()
  const matchedProfile = profiles.find((profile) => profile.name.normalize('NFKC').toLowerCase() === normalizedName)
  const showWelcome = Boolean(lastProfile && !choosing && !legacyPending)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!busy && name.trim()) onEnter(name)
  }

  return (
    <main className="profile-gate" aria-busy={busy}>
      <div className="profile-gate-landscape" aria-hidden="true">
        <span className="profile-shape profile-shape-cube" />
        <span className="profile-shape profile-shape-sphere" />
        <span className="profile-shape profile-shape-cylinder" />
      </div>
      <section className="profile-gate-card" aria-labelledby={`${inputId}-heading`}>
        <div className="profile-gate-brand"><span aria-hidden="true">✦</span> 造物岛</div>
        <div className="profile-gate-emblem" aria-hidden="true">{legacyPending ? '🎒' : showWelcome ? '👋' : '🌱'}</div>
        <h1 id={`${inputId}-heading`}>
          {legacyPending ? '给原有进度起个名字' : showWelcome ? <>欢迎回来，<span className="profile-welcome-name">{lastProfile?.name}</span></> : '你叫什么名字？'}
        </h1>
        <p className="profile-gate-intro">
          {legacyPending
            ? '以前的作品和成绩会放进这个名字的档案，原有数据也会保留备份。'
            : showWelcome ? '你的作品和冒险进度都在这里。' : '填一个名字，就能保存自己的作品和冒险进度。'}
        </p>

        {showWelcome ? (
          <div className="profile-gate-welcome-actions">
            <button className="profile-primary-button" type="button" disabled={busy} onClick={() => lastProfile && onEnter(lastProfile.name)}>
              {busy ? '正在打开…' : '继续冒险'}<span aria-hidden="true"> →</span>
            </button>
            <button className="profile-text-button" type="button" disabled={busy} onClick={() => setChoosing(true)}>换一个名字</button>
          </div>
        ) : (
          <form className="profile-gate-form" onSubmit={submit}>
            {!legacyPending && profiles.length > 0 && (
              <div className="profile-input-group">
                <label htmlFor={pickerId}>选一个已有名字</label>
                <select
                  id={pickerId}
                  value={matchedProfile?.id ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    const selected = profiles.find((profile) => profile.id === event.target.value)
                    setName(selected?.name ?? '')
                  }}
                >
                  <option value="">请选择，或在下面填新名字</option>
                  {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </div>
            )}
            <div className="profile-input-group">
              <label htmlFor={inputId}>{profiles.length > 0 && !legacyPending ? '你的名字，也可以填新名字' : '你的名字'}</label>
              <input
                id={inputId}
                name="profileName"
                type="text"
                value={name}
                autoFocus
                autoComplete="nickname"
                enterKeyHint="go"
                spellCheck={false}
                required
                disabled={busy}
                aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`}
                aria-invalid={Boolean(error)}
                placeholder="比如：小明"
                onChange={(event) => setName(event.target.value)}
              />
              <p className="profile-input-help" id={helpId}>1～16 个字，可用中文、字母、数字和下划线。</p>
            </div>
            <button className="profile-primary-button" type="submit" disabled={busy || !name.trim()}>
              {busy ? '正在打开…' : legacyPending ? '保存名字，开始冒险' : matchedProfile ? '继续冒险' : '开始冒险'}<span aria-hidden="true"> →</span>
            </button>
            {onCancel ? (
              <button className="profile-text-button" type="button" disabled={busy} onClick={onCancel}>返回我的冒险</button>
            ) : lastProfile && !legacyPending ? (
              <button className="profile-text-button" type="button" disabled={busy} onClick={() => setChoosing(false)}>返回欢迎页</button>
            ) : null}
          </form>
        )}
        {error && <p className="profile-gate-error" id={errorId} role="alert">{error}</p>}
        <p className="profile-local-note">作品自动同步到家庭云端。换设备时打开同一个家庭入口，再选自己的名字。可以用昵称，不需要注册。</p>
      </section>
    </main>
  )
}

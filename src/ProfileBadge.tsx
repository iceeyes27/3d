import './profiles.css'

export interface ProfileBadgeProps {
  name: string
  onSwitch: () => void
}

export function ProfileBadge({ name, onSwitch }: ProfileBadgeProps) {
  return (
    <div className="profile-badge">
      <span className="profile-badge-avatar" aria-hidden="true">{Array.from(name)[0] ?? '✦'}</span>
      <span className="profile-badge-name" title={name}><span className="profile-sr-only">当前用户：</span>{name}</span>
      <button type="button" onClick={onSwitch}>切换用户</button>
    </div>
  )
}

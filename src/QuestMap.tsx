import { useMemo, useState } from 'react'
import { creativeExpansionItems, quests } from './course'
import { isQuestUnlocked } from './progress'
import type { LearningProgress } from './types'
import { ProfileBadge } from './ProfileBadge'

interface QuestMapProps {
  progress: LearningProgress
  totalStars: number
  onOpenQuest: (questId: number) => void
  onOpenParent: () => void
  username: string
  onSwitchProfile: () => void
}

export function QuestMap({ progress, totalStars, onOpenQuest, onOpenParent, username, onSwitchProfile }: QuestMapProps) {
  const worlds = [
    { id: 1, title: '第一世界 · 积木岛', range: '第 1–4 关', icon: '🏝️' },
    { id: 2, title: '第二世界 · 精准工坊', range: '第 5–8 关', icon: '🏗️' },
    { id: 3, title: '第三世界 · 小小赛场', range: '第 9–12 关', icon: '🚀' },
  ]
  const highestUnlockedWorld = progress.completedQuestIds.includes(8)
    ? 3
    : progress.completedQuestIds.includes(4)
      ? 2
      : 1
  const [worldId, setWorldId] = useState(() => Math.min(Math.ceil(progress.lastPlayedQuestId / 4), highestUnlockedWorld))
  const currentWorld = worlds[worldId - 1]
  const currentWorldQuests = quests.slice((worldId - 1) * 4, worldId * 4)
  const [selectedId, setSelectedId] = useState(() => {
    const worldStart = (Math.min(Math.ceil(progress.lastPlayedQuestId / 4), highestUnlockedWorld) - 1) * 4 + 1
    const candidate = Math.min(Math.max(progress.lastPlayedQuestId, worldStart), worldStart + 3)
    return quests[candidate - 1].available ? candidate : 1
  })
  const [message, setMessage] = useState('')
  const selected = quests[selectedId - 1]
  const completedCount = currentWorldQuests.filter((quest) => progress.completedQuestIds.includes(quest.id)).length
  const selectedUnlocked = selected.available && isQuestUnlocked(progress, selected.id)

  const savedWorkCount = useMemo(
    () => Object.keys(progress.projects).length + Object.keys(progress.legacyProjects ?? {}).length,
    [progress.legacyProjects, progress.projects],
  )

  const selectQuest = (questId: number) => {
    setSelectedId(questId)
    const quest = quests[questId - 1]
    if (!quest.available) setMessage('这一关正在准备中。')
    else if (!isQuestUnlocked(progress, questId)) setMessage('先完成上一关，这条路就会亮起来。')
    else setMessage('')
  }

  const openWorld = (nextWorldId: number) => {
    if (nextWorldId > highestUnlockedWorld) return
    const firstId = (nextWorldId - 1) * 4 + 1
    const worldQuests = quests.slice(firstId - 1, firstId + 3)
    const nextQuest = worldQuests.find((quest) => quest.available && isQuestUnlocked(progress, quest.id)) ?? worldQuests[0]
    setWorldId(nextWorldId)
    setSelectedId(nextQuest.id)
    setMessage('')
  }

  return (
    <div className="map-page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">⬡</div>
          <div><div className="brand-title">造物岛</div><div className="brand-subtitle">把想法变成立体作品</div></div>
        </div>
        <div className="topbar-actions">
          <ProfileBadge name={username} onSwitch={onSwitchProfile} />
          <div className="status-chip hide-small">🧩 作品 {savedWorkCount} 件</div>
          <div className="status-chip">⭐ {totalStars}</div>
          <button className="avatar-button" type="button" onClick={onOpenParent} aria-label="打开家长中心">🐼</button>
        </div>
      </header>

      <main className="map-layout">
        <section className="island-map" aria-label={`${currentWorld.title}关卡地图`}>
          <div className="world-progress">
            <div className="world-progress-row"><strong>{currentWorld.title}</strong><span>{completedCount} / 4 关</span></div>
            <div className="progress-track"><div className="progress-value" style={{ width: `${(completedCount / 4) * 100}%` }} /></div>
          </div>

          <div className="quest-path">
            <svg className="path-line" viewBox="0 0 960 610" preserveAspectRatio="none" aria-hidden="true">
              <path d="M100 470 C245 470 240 300 360 300 S520 450 620 390 S760 245 855 195" />
            </svg>
            {currentWorldQuests.map((quest, index) => {
              const complete = progress.completedQuestIds.includes(quest.id)
              const unlocked = quest.available && isQuestUnlocked(progress, quest.id)
              const state = complete ? 'complete' : unlocked ? 'unlocked' : 'locked'
              return (
                <button
                  key={quest.id}
                  type="button"
                  className={`quest-node node-${index + 1} ${state} ${selectedId === quest.id ? 'selected' : ''}`}
                  onClick={() => selectQuest(quest.id)}
                  aria-label={`第 ${quest.id} 关，${quest.title}，${complete ? '已完成' : unlocked ? '可以开始' : '尚未解锁'}`}
                >
                  <span className="quest-orb">
                    <span aria-hidden="true">{unlocked || complete ? quest.icon : '🔒'}</span>
                    {complete && <span className="quest-check">✓</span>}
                    {progress.starsByQuest[quest.id] && <span className="quest-stars">{'★'.repeat(progress.starsByQuest[quest.id])}</span>}
                  </span>
                  <strong>{quest.shortTitle}</strong>
                  <small>{quest.available ? quest.subtitle : '后续开放'}</small>
                </button>
              )
            })}
          </div>

          <details className="future-worlds">
            <summary><span>🗺️</span><strong>切换世界</strong><small>一次专心玩 4 关</small></summary>
            <div className="future-world-list">
              {worlds.map((world) => (
                <button key={world.title} type="button" disabled={world.id > highestUnlockedWorld} className={world.id === worldId ? 'current' : ''} onClick={() => openWorld(world.id)}><span aria-hidden="true">{world.id > highestUnlockedWorld ? '🔒' : world.icon}</span><strong>{world.title}</strong><small>{world.range} · {world.id === worldId ? '正在这里' : world.id <= highestUnlockedWorld ? '已解锁' : `完成第 ${(world.id - 1) * 4} 关后开放`}</small></button>
              ))}
            </div>
          </details>
          {progress.completedQuestIds.includes(12) && (
            <section className="creative-island" aria-labelledby="creative-island-title">
              <div><span aria-hidden="true">🎨</span><h2 id="creative-island-title">创意拓展岛</h2><p>主线通关后自由选择，不影响基础能力成绩。已安全保留 {Object.keys(progress.legacyProjects ?? {}).length} 件旧版作品。</p></div>
              <div className="creative-island-grid">
                {creativeExpansionItems.map((item) => <article key={item.title}><span aria-hidden="true">{item.icon}</span><strong>{item.title}</strong><small>{item.skill}</small></article>)}
              </div>
            </section>
          )}
        </section>

        <aside className="quest-card" aria-label="当前选中关卡">
          <div className="quest-card-top"><span className="eyebrow">主线任务 · 第 {selected.id} 关</span><span className="time-chip">约 {selected.minutes} 分钟</span></div>
          <div className="quest-hero-icon" aria-hidden="true">{selected.icon}</div>
          <h1>{selected.title}</h1>
          <p className="quest-story">{selected.story}</p>
          <div className="objective-card"><strong>今天只学一个新本领</strong><span>{selected.objective}</span></div>
          {selected.tasks.length > 0 && (
            <ol className="preview-task-list">
              {selected.tasks.map((task, index) => <li key={task.id}><span>{index + 1}</span>{task.label}</li>)}
            </ol>
          )}
          <div className="reward-row"><span>过关奖励</span><strong>⭐ 1～3　＋　{selected.reward}</strong></div>
          {message && <p className="map-message" role="status">{message}</p>}
          <button
            className="primary-button full-width"
            type="button"
            disabled={!selectedUnlocked}
            onClick={() => onOpenQuest(selected.id)}
          >
            {progress.completedQuestIds.includes(selected.id) ? '再玩一次' : selectedUnlocked ? '开始闯关' : '尚未解锁'}
          </button>
          <button className="parent-link" type="button" onClick={onOpenParent}>🛡️ 孩子模式 · 作品默认私密</button>
        </aside>
      </main>
    </div>
  )
}

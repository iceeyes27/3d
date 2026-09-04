import { useMemo, useState } from 'react'
import { quests } from './course'
import { isQuestUnlocked } from './progress'
import type { LearningProgress } from './types'

interface QuestMapProps {
  progress: LearningProgress
  totalStars: number
  onOpenQuest: (questId: number) => void
  onOpenParent: () => void
}

export function QuestMap({ progress, totalStars, onOpenQuest, onOpenParent }: QuestMapProps) {
  const [selectedId, setSelectedId] = useState(() => {
    const candidate = Math.min(Math.max(progress.lastPlayedQuestId, 1), 4)
    return quests[candidate - 1].available ? candidate : 1
  })
  const [message, setMessage] = useState('')
  const selected = quests[selectedId - 1]
  const completedCount = progress.completedQuestIds.length
  const selectedUnlocked = selected.available && isQuestUnlocked(progress, selected.id)

  const savedWorkCount = useMemo(() => Object.keys(progress.projects).length, [progress.projects])

  const selectQuest = (questId: number) => {
    setSelectedId(questId)
    const quest = quests[questId - 1]
    if (!quest.available) setMessage('这一片岛屿正在建设中，先完成前四关吧。')
    else if (!isQuestUnlocked(progress, questId)) setMessage('先完成上一关，这条路就会亮起来。')
    else setMessage('')
  }

  return (
    <div className="map-page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">⬡</div>
          <div><div className="brand-title">造物岛</div><div className="brand-subtitle">把想法变成立体作品</div></div>
        </div>
        <div className="topbar-actions">
          <div className="status-chip hide-small">🧩 作品 {savedWorkCount} 件</div>
          <div className="status-chip">⭐ {totalStars}</div>
          <button className="avatar-button" type="button" onClick={onOpenParent} aria-label="打开家长中心">🐼</button>
        </div>
      </header>

      <main className="map-layout">
        <section className="island-map" aria-label="形状港关卡地图">
          <div className="world-progress">
            <div className="world-progress-row"><strong>第一世界 · 形状港</strong><span>{completedCount} / 12 关</span></div>
            <div className="progress-track"><div className="progress-value" style={{ width: `${(completedCount / 12) * 100}%` }} /></div>
          </div>

          <div className="quest-path">
            <svg className="path-line" viewBox="0 0 960 610" preserveAspectRatio="none" aria-hidden="true">
              <path d="M70 500 C140 500 150 330 245 330 S350 515 455 450 S525 225 630 255 S710 455 790 400 S825 180 910 120" />
            </svg>
            {quests.map((quest, index) => {
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

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { quests } from './course'
import { QuestMap } from './QuestMap'
import {
  awardQuestBadge,
  completePractice,
  completeQuest,
  isQuestUnlocked,
  markQuestReviewPending,
  recordQuestReview,
  saveProject,
} from './progress'
import { scoreCoreQuest, scoreFinalQuest } from './scoring'
import type { LearningProgress, ProgressBadge, QuestProject } from './types'
import { CloudProfileHost } from './CloudProfileHost'
import { cloudProfileCacheKey } from './cloudProfiles'
import type { CloudProfileEnvelope } from './cloudTypes'
import { CloudProfileWriter } from './cloudWriter'

const Studio = lazy(() => import('./Studio').then((module) => ({ default: module.Studio })))

type Screen = { type: 'map' } | { type: 'studio'; questId: number }

const hasPassedProject = (progress: LearningProgress, questId: number) =>
  progress.completedQuestIds.includes(questId)
  && progress.projects[questId]?.courseVersion === 2
  && typeof progress.projects[questId]?.elapsedSeconds === 'number'

function screenFromHash(): Screen {
  const match = window.location.hash.match(/^#\/quest\/(\d+)$/)
  if (!match) return { type: 'map' }
  const questId = Number(match[1])
  const quest = quests.find((item) => item.id === questId)
  return quest?.available ? { type: 'studio', questId } : { type: 'map' }
}

export default function App() {
  return <CloudProfileHost workspace={(controls) => <ProfileWorkspace {...controls} />} />
}

function ProfileWorkspace({ profile, inviteLink, onChooseProfile, onReloadProfile, onReconnectFamily, registerCheckpoint, reloadError }: {
  profile: CloudProfileEnvelope
  inviteLink: string
  onChooseProfile: () => void
  onReloadProfile: () => void
  onReconnectFamily: () => Promise<void>
  registerCheckpoint: (save: () => Promise<boolean>) => () => void
  reloadError: string
}) {
  const [writer] = useState(() => new CloudProfileWriter(profile))
  const [progress, setProgress] = useState<LearningProgress>(() => writer.progress)
  const [, setSaveRevision] = useState(0)
  const alive = useRef(true)
  const [screen, setScreen] = useState<Screen>(() => screenFromHash())
  const [parentOpen, setParentOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const inviteInput = useRef<HTMLInputElement>(null)
  const lifetime = useRef(0)
  const storageHealthy = writer.state === 'saved'
  const [reviewScoreDraft, setReviewScoreDraft] = useState('')
  const [reviewCommentDraft, setReviewCommentDraft] = useState('')
  const parentModalRef = useRef<HTMLElement>(null)
  const parentCloseRef = useRef<HTMLButtonElement>(null)
  const parentReturnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onHashChange = () => setScreen(screenFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    alive.current = true
    const lifetimeId = ++lifetime.current
    writer.onChange = () => { if (alive.current) setSaveRevision((value) => value + 1) }
    writer.start()
    const checkOtherTab = (event: StorageEvent) => {
      if (event.key !== null && event.key !== cloudProfileCacheKey(profile.spaceId, profile.id)) return
      writer.externalChange(event.newValue)
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (writer.state === 'saved') return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('storage', checkOtherTab)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      alive.current = false
      writer.onChange = undefined
      window.removeEventListener('storage', checkOtherTab)
      window.removeEventListener('beforeunload', beforeUnload)
      // A StrictMode effect rehearsal must not dispose the live queue.
      queueMicrotask(() => { if (!alive.current && lifetime.current === lifetimeId) writer.dispose() })
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [profile.id, profile.spaceId, writer])

  useEffect(() => registerCheckpoint(() => writer.checkpoint()), [registerCheckpoint, writer])

  const updateProgress = useCallback((change: (current: LearningProgress) => LearningProgress) => {
    if (!alive.current) return
    const current = writer.progress
    const next = change(current)
    if (next === current) return
    setProgress(next)
    writer.update(next)
  }, [writer])

  const switchProfile = async () => {
    if (switching) return
    setSwitching(true)
    const saved = await writer.flush()
    setSwitching(false)
    if (!saved || !alive.current) return
    setParentOpen(false)
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    onChooseProfile()
  }

  const downloadRecovery = () => {
    const url = URL.createObjectURL(new Blob([writer.backup()], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${profile.name}-进度备份.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  useEffect(() => {
    if (screen.type === 'studio' && !isQuestUnlocked(progress, screen.questId)) {
      window.location.hash = '/'
    }
  }, [progress, screen])

  useEffect(() => {
    if (!parentOpen) return
    const returnFocus = parentReturnFocusRef.current
    parentCloseRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setParentOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const modal = parentModalRef.current
      if (!modal) return
      const controls = Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
      if (controls.length === 0) return
      const first = controls[0]
      const last = controls.at(-1) ?? first
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [parentOpen])

  const finalReview = progress.reviewsByQuest[12]
  useEffect(() => {
    if (!parentOpen) return
    setReviewScoreDraft(finalReview?.status === 'reviewed' && typeof finalReview.score === 'number' ? String(finalReview.score) : '')
    setReviewCommentDraft(finalReview?.comment ?? '')
  }, [finalReview?.comment, finalReview?.score, finalReview?.status, parentOpen])

  const totalStars = useMemo(
    () => Object.values(progress.starsByQuest).reduce((sum, value) => sum + value, 0),
    [progress.starsByQuest],
  )
  const totalBadges = useMemo(
    () => Object.values(progress.badgesByQuest).reduce((sum, badges) => sum + badges.length, 0),
    [progress.badgesByQuest],
  )
  const finishedProjectCount = useMemo(
    () => progress.completedQuestIds.filter((questId) => hasPassedProject(progress, questId)).length,
    [progress.completedQuestIds, progress.projects],
  )
  const draftProjectCount = useMemo(
    () => Object.keys(progress.projects).filter((questId) => {
      const id = Number(questId)
      return !hasPassedProject(progress, id)
    }).length,
    [progress.completedQuestIds, progress.projects],
  )
  const questScores = useMemo(() => quests.map((quest) => {
    const completed = hasPassedProject(progress, quest.id)
    const badges = progress.badgesByQuest[quest.id] ?? []
    const hasProcessRecord = completed && (progress.projects[quest.id]?.operations.length ?? 0) > 0
    if (quest.id === 12) {
      return {
        quest,
        completed,
        score: scoreFinalQuest({
          questId: 12,
          technical: completed ? 60 : 0,
          manualReview: completed ? progress.reviewsByQuest[12] : undefined,
        }),
      }
    }
    return {
      quest,
      completed,
      score: scoreCoreQuest({
        questId: quest.id,
        core: completed ? 60 : 0,
        accuracy: badges.includes('accuracy') ? 20 : 0,
        independence: badges.includes('independence') ? 10 : 0,
        process: hasProcessRecord ? 10 : 0,
      }),
    }
  }), [progress.badgesByQuest, progress.completedQuestIds, progress.projects, progress.reviewsByQuest])
  const activeQuest = screen.type === 'studio' ? quests.find((quest) => quest.id === screen.questId) : undefined
  const canOpenStudio = Boolean(activeQuest && isQuestUnlocked(progress, activeQuest.id))

  const openQuest = useCallback((questId: number) => {
    window.location.hash = `/quest/${questId}`
  }, [])

  const backToMap = useCallback(() => {
    window.location.hash = '/'
  }, [])

  const openParent = useCallback(() => {
    parentReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setParentOpen(true)
  }, [])

  const closeParent = useCallback(() => setParentOpen(false), [])

  const handleProjectChange = useCallback((questId: number, project: QuestProject) => {
    updateProgress((current) => {
      if (hasPassedProject(current, questId) || JSON.stringify(current.projects[questId]) === JSON.stringify(project)) return current
      return saveProject(current, questId, project)
    })
  }, [updateProgress])

  const handleComplete = useCallback((
    questId: number,
    stars: number,
    project: QuestProject,
    badges: ProgressBadge[] = [],
    practiceId?: string,
  ) => {
    updateProgress((current) => {
      let next = completeQuest(saveProject(current, questId, project), questId, stars)
      for (const badge of badges) next = awardQuestBadge(next, questId, badge)
      if (practiceId) next = completePractice(next, practiceId)
      if (questId === 12 && !next.reviewsByQuest[12]) next = markQuestReviewPending(next, 12, Date.now())
      return next
    })
  }, [updateProgress])

  const handleReviewSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const score = Number(reviewScoreDraft)
    if (!hasPassedProject(progress, 12) || reviewScoreDraft.trim() === '' || !Number.isFinite(score)) return
    updateProgress((current) => recordQuestReview(
      current,
      12,
      score,
      reviewCommentDraft.trim() || undefined,
      Date.now(),
    ))
  }, [progress, reviewCommentDraft, reviewScoreDraft, updateProgress])

  return (
    <div className="app-shell">
      {(writer.state === 'error' || writer.state === 'conflict') && <section className="profile-save-notice" role="alert">
        <p>{reloadError || writer.message} 当前页面的内容仍保留，尚未切换用户。</p>
        <div>
          <button type="button" onClick={downloadRecovery}>保存当前备份</button>
          {writer.state === 'conflict'
            ? <button type="button" onClick={() => { if (window.confirm('重新载入云端会放弃当前待同步修改。请先保存当前备份。是否继续？')) onReloadProfile() }}>重新载入云端进度</button>
            : writer.needsReconnect
              ? <button type="button" disabled={switching} onClick={async () => {
                setSwitching(true)
                if (await writer.checkpoint()) await onReconnectFamily()
                if (alive.current) setSwitching(false)
              }}>{switching ? '正在连接…' : '重新连接家庭'}</button>
              : <button type="button" onClick={() => void writer.flush()}>重试保存</button>}
        </div>
      </section>}
      {writer.state === 'pending' && <p className="cloud-pending-notice" role="status">已保存在此设备，等待上传到云端。连接恢复后会自动重试。</p>}
      <div className="app-content" inert={parentOpen || switching ? true : undefined} aria-hidden={parentOpen || undefined}>
        {screen.type === 'map' || !activeQuest || !canOpenStudio ? (
          <QuestMap
            progress={progress}
            totalStars={totalStars}
            onOpenQuest={openQuest}
            onOpenParent={openParent}
            username={profile.name}
            onSwitchProfile={switchProfile}
          />
        ) : (
          <Suspense fallback={<div className="studio-loading" role="status"><span>⬡</span><strong>正在打开 3D 工作台…</strong></div>}>
            <Studio
              key={activeQuest.id}
              quest={activeQuest}
              savedProject={progress.projects[activeQuest.id]}
              totalStars={totalStars}
              storageHealthy={storageHealthy}
              saveState={writer.state}
              username={profile.name}
              onSwitchProfile={switchProfile}
              onBack={backToMap}
              onProjectChange={handleProjectChange}
              onComplete={handleComplete}
            />
          </Suspense>
        )}
      </div>

      {parentOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeParent}>
          <section ref={parentModalRef} className="parent-modal" role="dialog" aria-modal="true" aria-labelledby="parent-title" onMouseDown={(event) => event.stopPropagation()}>
            <button ref={parentCloseRef} className="icon-button modal-close" type="button" aria-label="关闭家长中心" onClick={closeParent}>×</button>
            <p className="eyebrow">{profile.name}的家长中心</p>
            <h2 id="parent-title">只看成长，不做排名</h2>
            <div className="parent-summary">
              <div><strong>{progress.completedQuestIds.length}</strong><span>已完成关卡</span></div>
              <div><strong>{totalBadges}</strong><span>能力徽章</span></div>
              <div><strong>{finishedProjectCount} / {draftProjectCount}</strong><span>通关作品 / 草稿</span></div>
            </div>
            {Object.keys(progress.legacyProjects ?? {}).length > 0 && <p className="legacy-project-note">🎨 另有 {Object.keys(progress.legacyProjects ?? {}).length} 件旧课程作品已保留，主线通关后会在“创意拓展岛”显示。</p>}
            <div className="privacy-note">
              <span aria-hidden="true">🛡️</span>
              <div><strong>家庭云端模式 · {profile.name}</strong><p>可以使用昵称，不需要注册。作品和进度保存在 Cloudflare 云端；断网修改暂存在本设备，显示“已同步到云端”后才可在其他设备继续。</p><p>家庭入口相当于钥匙。拿到链接的人可以查看和修改本家庭的所有档案，请勿公开分享。</p></div>
            </div>
            <section className="parent-family-section" aria-labelledby="family-link-title">
              <h3 id="family-link-title">在另一台设备继续</h3>
              {inviteLink ? <>
                <label htmlFor="parent-family-link">家庭私密入口（请由家长保管）</label>
                <input ref={inviteInput} id="parent-family-link" type="text" readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} />
                <button className="secondary-button" type="button" onClick={() => {
                  void navigator.clipboard?.writeText(inviteLink).then(() => setCopyMessage('已复制，请只发给家人。')).catch(() => {
                    inviteInput.current?.focus(); inviteInput.current?.select(); setCopyMessage('请复制已选中的链接。')
                  })
                  if (!navigator.clipboard) { inviteInput.current?.focus(); inviteInput.current?.select(); setCopyMessage('请复制已选中的链接。') }
                }}>复制家庭入口</button>
                <p role="status">{copyMessage || '在另一台设备打开此链接，再填写相同用户名，即可接着玩。'}</p>
              </> : <p>此设备没有保留家庭入口链接。请从创建家庭的设备复制，或使用最初保存的链接。</p>}
            </section>
            <section className="parent-score-section" aria-labelledby="parent-score-title">
              <h3 id="parent-score-title">每关能力记录</h3>
              <p className="parent-score-note">技术分只使用通关结果、精准徽章、独立徽章和过程记录；孩子的星星与自评不计入比赛分。</p>
              <div className="parent-score-list">
                {questScores.map(({ quest, completed, score }) => (
                  <article className={`parent-score-card ${completed ? 'is-complete' : ''}`} key={quest.id}>
                    <div className="parent-score-heading">
                      <strong>第 {quest.id} 关 · {quest.shortTitle}</strong>
                      <span>{completed ? `${score.competitionScore} / 100` : '待本课程验收'}</span>
                    </div>
                    {quest.id === 12 ? (
                      <div className="parent-score-breakdown">
                        <span>系统技术 <strong>{score.automaticScore} / 60</strong></span>
                        <span>人工点评 <strong>{score.manualScore === null ? '待评 / 40' : `${score.manualScore} / 40`}</strong></span>
                      </div>
                    ) : (
                      <div className="parent-score-breakdown">
                        <span>核心结果 <strong>{score.breakdown.core} / 60</strong></span>
                        <span>精度 <strong>{score.breakdown.accuracy} / 20</strong></span>
                        <span>独立 <strong>{score.breakdown.independence} / 10</strong></span>
                        <span>过程 <strong>{score.breakdown.process} / 10</strong></span>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
            <section className="parent-review-section" aria-labelledby="parent-review-title">
              <h3 id="parent-review-title">第 12 关人工点评</h3>
              {hasPassedProject(progress, 12) ? (
                <form className="parent-review-form" onSubmit={handleReviewSubmit}>
                  <p>请按主题、创意、实用性、讲解四项各 10 分，填写合计分。保存后仍可修改。</p>
                  <label>
                    <span>点评分数（0～40）</span>
                    <input
                      type="number"
                      min="0"
                      max="40"
                      step="1"
                      required
                      value={reviewScoreDraft}
                      onChange={(event) => setReviewScoreDraft(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>评语（可选）</span>
                    <textarea
                      maxLength={2000}
                      rows={3}
                      value={reviewCommentDraft}
                      onChange={(event) => setReviewCommentDraft(event.target.value)}
                      placeholder="例如：解决的问题很清楚，下次可以把讲解再说慢一点。"
                    />
                  </label>
                  <button className="primary-button full-width" type="submit">
                    {finalReview?.status === 'reviewed' ? '修改点评' : '保存点评'}
                  </button>
                </form>
              ) : (
                <p className="parent-score-note">完成第 12 关后，可以在这里录入 40 分人工点评和评语。</p>
              )}
            </section>
            <h3>本周可以这样陪伴</h3>
            <ul className="parent-tips">
              <li>孩子卡住时，先问“你想让它变成什么样？”</li>
              <li>除非页面出错，尽量不要替孩子操作鼠标。</li>
              <li>完成作品后，请她说出一次修改和修改理由。</li>
            </ul>
            <button className="primary-button full-width" type="button" onClick={closeParent}>知道了</button>
          </section>
        </div>
      )}
    </div>
  )
}

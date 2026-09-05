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
import { ProfileGate } from './ProfileGate'
import { enterProfile, getProfile, listProfiles, PROFILE_STORAGE_PREFIX } from './profiles'
import type { ProfileEnvelope } from './profiles'
import { ProfileWriter } from './profileWriter'

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

const LAST_PROFILE_KEY = 'maker-island-last-profile-v1'
const SESSION_PROFILE_KEY = 'maker-island-session-profile-v1'

function rememberedProfile(session = false) {
  try { return (session ? sessionStorage : localStorage).getItem(session ? SESSION_PROFILE_KEY : LAST_PROFILE_KEY) ?? undefined } catch { return undefined }
}

function rememberProfile(id: string) {
  try { localStorage.setItem(LAST_PROFILE_KEY, id) } catch { /* Optional welcome shortcut. */ }
  try { sessionStorage.setItem(SESSION_PROFILE_KEY, id) } catch { /* The current tab can still be used. */ }
}

function initialProfile() {
  const id = rememberedProfile(true)
  if (!id) return null
  const result = getProfile(id)
  return result.ok ? result.profile : null
}

export default function App() {
  const [active, setActive] = useState<ProfileEnvelope | null>(initialProfile)
  const [directory, setDirectory] = useState(listProfiles)
  const [choosing, setChoosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0)
  const entering = useRef(false)

  useEffect(() => {
    const refreshDirectory = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(PROFILE_STORAGE_PREFIX)) setDirectory(listProfiles())
    }
    window.addEventListener('storage', refreshDirectory)
    return () => window.removeEventListener('storage', refreshDirectory)
  }, [])

  const chooseProfile = useCallback(() => {
    setDirectory(listProfiles())
    setError('')
    setChoosing(true)
  }, [])

  const enter = async (name: string) => {
    if (entering.current) return
    entering.current = true
    setBusy(true)
    setError('')
    try {
      const result = await enterProfile(name)
      if (!result.ok) { setError(result.message); return }
      rememberProfile(result.profile.id)
      if (active?.id !== result.profile.id) window.location.hash = '/'
      setActive(result.profile)
      setWorkspaceEpoch((value) => value + 1)
      setChoosing(false)
      setDirectory(listProfiles())
    } catch {
      setError('暂时无法打开用户档案，请重试。原有进度仍被保留。')
    } finally {
      entering.current = false
      setBusy(false)
    }
  }

  const reloadProfile = () => {
    if (!active) return
    const result = getProfile(active.id)
    if (!result.ok) { setError(result.message); return }
    setActive(result.profile)
    setWorkspaceEpoch((value) => value + 1)
    setError('')
  }

  return (
    <>
      {active && <div hidden={choosing}>
        <ProfileWorkspace key={`${active.id}:${workspaceEpoch}`} profile={active} onChooseProfile={chooseProfile} onReloadProfile={reloadProfile} reloadError={error} />
      </div>}
      {(!active || choosing) && <ProfileGate
        profiles={directory.ok ? directory.profiles : []}
        lastProfileId={choosing ? undefined : rememberedProfile()}
        legacyPending={directory.ok && directory.legacy === 'available'}
        busy={busy}
        error={error || (!directory.ok ? directory.message : directory.legacy === 'damaged' ? '原有进度暂时无法读取，数据已保留，请先恢复备份。' : '')}
        onEnter={enter}
        onCancel={active ? () => { setError(''); setChoosing(false) } : undefined}
      />}
    </>
  )
}

function ProfileWorkspace({ profile, onChooseProfile, onReloadProfile, reloadError }: {
  profile: ProfileEnvelope
  onChooseProfile: () => void
  onReloadProfile: () => void
  reloadError: string
}) {
  const [progress, setProgress] = useState<LearningProgress>(() => profile.progress)
  const [writer] = useState(() => new ProfileWriter(profile))
  const [, setSaveRevision] = useState(0)
  const alive = useRef(true)
  const [screen, setScreen] = useState<Screen>(() => screenFromHash())
  const [parentOpen, setParentOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
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
    writer.onChange = () => { if (alive.current) setSaveRevision((value) => value + 1) }
    const checkOtherTab = (event: StorageEvent) => {
      if (event.key !== null && event.key !== `${PROFILE_STORAGE_PREFIX}${profile.id}`) return
      const result = getProfile(profile.id)
      writer.externalChange(result.ok ? result.profile.revision : null)
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
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [profile.id, writer])

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
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'maker-island-profile-backup', username: profile.name, progress: writer.progress }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${profile.name}-本机进度备份.json`
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
            ? <button type="button" onClick={() => { if (window.confirm('重新载入会替换当前页面中尚未保存的修改。建议先保存当前备份。是否继续？')) onReloadProfile() }}>重新载入已保存进度</button>
            : <button type="button" onClick={() => void writer.flush()}>重试保存</button>}
        </div>
      </section>}
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
              <div><strong>本机学习模式 · {profile.name}</strong><p>用户名用于区分本机档案，可以使用昵称，不需要注册。进度只保存在当前浏览器；使用此浏览器的人可以打开已有档案。</p></div>
            </div>
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

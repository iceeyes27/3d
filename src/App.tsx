import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { quests } from './course'
import { QuestMap } from './QuestMap'
import { completeQuest, isQuestUnlocked, loadProgress, saveProgress, saveProject } from './progress'
import type { LearningProgress, QuestProject } from './types'

const Studio = lazy(() => import('./Studio').then((module) => ({ default: module.Studio })))

type Screen = { type: 'map' } | { type: 'studio'; questId: number }

function screenFromHash(): Screen {
  const match = window.location.hash.match(/^#\/quest\/(\d+)$/)
  if (!match) return { type: 'map' }
  const questId = Number(match[1])
  const quest = quests.find((item) => item.id === questId)
  return quest?.available ? { type: 'studio', questId } : { type: 'map' }
}

export default function App() {
  const [progress, setProgress] = useState<LearningProgress>(() => loadProgress())
  const [screen, setScreen] = useState<Screen>(() => screenFromHash())
  const [parentOpen, setParentOpen] = useState(false)
  const [storageHealthy, setStorageHealthy] = useState(true)
  const parentModalRef = useRef<HTMLElement>(null)
  const parentCloseRef = useRef<HTMLButtonElement>(null)
  const parentReturnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onHashChange = () => setScreen(screenFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    setStorageHealthy(saveProgress(progress))
  }, [progress])

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
      const controls = Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
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

  const totalStars = useMemo(
    () => Object.values(progress.starsByQuest).reduce((sum, value) => sum + value, 0),
    [progress.starsByQuest],
  )
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
    setProgress((current) => saveProject(current, questId, project))
  }, [])

  const handleComplete = useCallback((questId: number, stars: number, project: QuestProject) => {
    setProgress((current) => completeQuest(saveProject(current, questId, project), questId, stars))
  }, [])

  return (
    <div className="app-shell">
      <div className="app-content" inert={parentOpen ? true : undefined} aria-hidden={parentOpen || undefined}>
        {screen.type === 'map' || !activeQuest || !canOpenStudio ? (
          <QuestMap
            progress={progress}
            totalStars={totalStars}
            onOpenQuest={openQuest}
            onOpenParent={openParent}
          />
        ) : (
          <Suspense fallback={<div className="studio-loading" role="status"><span>⬡</span><strong>正在打开 3D 工作台…</strong></div>}>
            <Studio
              key={activeQuest.id}
              quest={activeQuest}
              savedProject={progress.projects[activeQuest.id]}
              totalStars={totalStars}
              storageHealthy={storageHealthy}
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
            <p className="eyebrow">家长中心</p>
            <h2 id="parent-title">只看成长，不做排名</h2>
            <div className="parent-summary">
              <div><strong>{progress.completedQuestIds.length}</strong><span>已完成关卡</span></div>
              <div><strong>{totalStars}</strong><span>收集到的星星</span></div>
              <div><strong>{Object.keys(progress.projects).length}</strong><span>保存的作品</span></div>
            </div>
            <div className="privacy-note">
              <span aria-hidden="true">🛡️</span>
              <div><strong>本机学习模式</strong><p>当前不需要注册，进度只保存在这台设备的浏览器中，也不会收集真实姓名、学校或照片。</p></div>
            </div>
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

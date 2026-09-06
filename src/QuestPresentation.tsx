import type { TaskEvaluation } from './types'
import './quest-presentation.css'

export interface QuestPresentationProps {
  questId: number
  evaluations: TaskEvaluation[]
  celebrating: boolean
  practice?: boolean
  printChecks?: { thickness: boolean; support: boolean; connection: boolean }
}

const inspectionChecks = [
  { taskId: 'fix-thin', label: '厚度安全' },
  { taskId: 'fix-floating', label: '零件有支撑' },
  { taskId: 'print-ready', label: '完整体检' },
]

/** Read-only story feedback lives in the task panel, never over the model. */
export function QuestPresentation({ questId, evaluations, celebrating, practice = false, printChecks }: QuestPresentationProps) {
  if (![1, 4, 10].includes(questId)) return null

  const completed = new Set(evaluations.filter((item) => item.complete).map((item) => item.taskId))
  if (questId === 10) {
    const checks = printChecks ? [
      { taskId: 'fix-thin', label: '厚度安全', complete: printChecks.thickness },
      { taskId: 'fix-floating', label: '零件有支撑', complete: printChecks.support },
      { taskId: 'connection', label: '零件相连', complete: printChecks.connection },
    ] : inspectionChecks.map((check) => ({ ...check, complete: completed.has(check.taskId) }))
    const allChecksPassed = checks.every((check) => check.complete)
    return (
      <section className={`quest-presentation inspection-card${celebrating ? ' is-celebrating' : ''}`} aria-label="模型修理站">
        <strong><span aria-hidden="true">🛠️</span> 模型修理站</strong>
        <ul className="inspection-lights" aria-label="模型体检结果">
          {checks.map((check) => (
            <li key={check.taskId} className={check.complete ? 'is-complete' : ''}>
              <span className="inspection-light" aria-hidden="true">{check.complete ? '✓' : '·'}</span>
              <span>{check.label}</span>
              <span className="inspection-state">{check.complete ? '通过' : '待修'}</span>
            </li>
          ))}
        </ul>
        <p role="status">{celebrating && allChecksPassed ? '三盏绿灯亮了！转动视角，看看你修好的作品。' : '找到问题，修好一项，就点亮一盏灯。'}</p>
      </section>
    )
  }

  const snowmanReady = completed.has('find-round')
  const message = questId === 1
    ? celebrating
      ? practice ? '新谜面也解开了！看看你找到的小蜡烛。' : '谢谢小侦探！我们都找到了合适的形状。'
      : practice
        ? '这次换一个谜面，观察后自己选一选。'
        : completed.has('find-round') && completed.has('find-tall') && completed.has('find-point')
          ? '三个朋友都补好了！检查作品后，试试新的侦探卡。'
          : snowmanReady
          ? '你好呀！圆滚滚的身体找到了，再帮帮我的朋友。'
          : '我的身体圆滚滚，哪一种积木最像我？'
    : celebrating
      ? '屋顶稳稳转正，家的灯亮起来了！'
      : completed.has('roof-upright')
        ? '屋顶已经转正了！检查作品，让小屋亮起来。'
        : practice
        ? '另一阵风来了！看看这次要往哪边转。'
        : '尖尖的屋顶歪了，帮我把它转回正中间吧。'

  return (
    <section className={`quest-presentation character-card${celebrating ? ' is-celebrating' : ''}`} aria-label={questId === 1 ? '雪人朋友' : '小屋朋友'}>
      <span className="quest-character" aria-hidden="true">{questId === 1 ? '☃️' : celebrating ? '🏡' : '🏠'}</span>
      <p role="status">{message}</p>
    </section>
  )
}

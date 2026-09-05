import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { createModelGroupForExport, disposeModelObject } from './ModelViewport'
import type { OperationType, Quest, QuestProject } from './types'

const operationLabels: Record<OperationType, string> = {
  add: '添加形状',
  move: '移动',
  scale: '改变大小',
  rotate: '旋转',
  duplicate: '复制',
  align: '对齐或落地',
  group: '组合或挖孔',
  hole: '设置空洞',
  plan: '确认三步计划',
}

function safeFilename(value: string) {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-')
  return cleaned || '造物岛作品'
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function createProjectArchive(quest: Quest, project: QuestProject) {
  const operationCounts = project.operations.reduce<Partial<Record<OperationType, number>>>((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1
    return counts
  }, {})

  return {
    format: 'maker-island-project',
    version: 2,
    exportedAt: new Date().toISOString(),
    quest: {
      id: quest.id,
      title: quest.title,
      skillId: quest.skillId,
      objective: quest.objective,
    },
    project,
    process: Object.entries(operationCounts).map(([type, count]) => ({
      action: operationLabels[type as OperationType],
      count,
    })),
  }
}

export function downloadProjectArchive(quest: Quest, project: QuestProject) {
  const archive = createProjectArchive(quest, project)
  triggerDownload(
    new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json;charset=utf-8' }),
    `${safeFilename(quest.title)}-可编辑工程.maker3d.json`,
  )
}

export function downloadProcessReport(quest: Quest, project: QuestProject) {
  const archive = createProjectArchive(quest, project)
  const lines = [
    `作品：${quest.title}`,
    `本领：${quest.objective}`,
    `零件数：${project.shapes.filter((shape) => !shape.isHole).length}`,
    '',
    '创作过程：',
    ...archive.process.map((item, index) => `${index + 1}. ${item.action}：${item.count} 次`),
    '',
    '介绍作品时可以说：',
    '1. 我的任务是……',
    '2. 我的办法是……',
    '3. 我修改了……，因为……',
  ]
  triggerDownload(
    new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }),
    `${safeFilename(quest.title)}-过程记录.txt`,
  )
}

export function downloadStl(quest: Quest, project: QuestProject) {
  const exportableShapes = project.shapes.filter((shape) => !shape.isHole)
  if (exportableShapes.length === 0) throw new Error('当前没有可以导出的实体模型。')

  const group = createModelGroupForExport(exportableShapes)
  try {
    const stl = new STLExporter().parse(group, { binary: false })
    triggerDownload(new Blob([stl], { type: 'model/stl' }), `${safeFilename(quest.title)}.stl`)
  } finally {
    disposeModelObject(group)
  }
}

export async function downloadViewportImage(quest: Quest, host: ParentNode = document) {
  const canvas = host.querySelector<HTMLCanvasElement>('.model-viewport canvas')
  if (!canvas) throw new Error('还没有找到 3D 画布。')
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('这台设备暂时不能保存作品图片。')
  triggerDownload(blob, `${safeFilename(quest.title)}-作品图.png`)
}

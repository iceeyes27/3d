import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import type { ModelShape, TransformMode } from './types'

export interface ModelViewportProps {
  shapes: ModelShape[]
  targetShapes?: ModelShape[]
  selectedId: string | null
  mode: TransformMode
  transformEnabled?: boolean
  resetViewSignal?: number
  onSelect: (id: string | null) => void
  onTransformEnd: (shape: ModelShape, operation: 'move' | 'rotate' | 'scale') => void
}

type ShapeObject = THREE.Object3D & { userData: { shapeId?: string } }

interface ViewportRuntime {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  orbit: OrbitControls
  transform: TransformControls
  transformHelper: THREE.Object3D
  shapeGroup: THREE.Group
  targetGroup: THREE.Group
  shapeObjects: Map<string, ShapeObject>
  shapeSources: Map<string, ModelShape>
  selectionOutline: THREE.BoxHelper | null
  animationFrame: number
  resizeObserver: ResizeObserver | null
  resizeFallback: (() => void) | null
}

const warnedCsgShapes = new Set<string>()

function primitiveGeometry(type: ModelShape['type']): THREE.BufferGeometry {
  switch (type) {
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 32, 20)
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
    case 'cone':
      return new THREE.ConeGeometry(0.55, 1, 32)
    case 'box':
    default:
      return new THREE.BoxGeometry(1, 1, 1)
  }
}

function displayMaterial(shape: ModelShape): THREE.MeshStandardMaterial {
  if (shape.isHole) {
    return new THREE.MeshStandardMaterial({
      color: shape.color || '#4bdbef',
      transparent: true,
      opacity: 0.3,
      roughness: 0.35,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  }

  return new THREE.MeshStandardMaterial({
    color: shape.color,
    roughness: 0.56,
    metalness: 0.03,
  })
}

function matrixFromShape(shape: ModelShape): THREE.Matrix4 {
  const position = new THREE.Vector3(shape.position.x, shape.position.y, shape.position.z)
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(shape.rotation.x, shape.rotation.y, shape.rotation.z, 'XYZ'),
  )
  const scale = new THREE.Vector3(shape.scale.x, shape.scale.y, shape.scale.z)
  return new THREE.Matrix4().compose(position, quaternion, scale)
}

function applyShapeTransform(object: THREE.Object3D, shape: ModelShape) {
  object.position.set(shape.position.x, shape.position.y, shape.position.z)
  object.rotation.set(shape.rotation.x, shape.rotation.y, shape.rotation.z, 'XYZ')
  object.scale.set(shape.scale.x, shape.scale.y, shape.scale.z)
  object.updateMatrix()
  object.updateMatrixWorld(true)
}

function markSelectable(object: ShapeObject, shape: ModelShape) {
  object.name = shape.name
  object.userData.shapeId = shape.id
  object.traverse((child) => {
    child.userData.shapeId = shape.id
  })
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose())
  } else {
    material.dispose()
  }
}

export function disposeModelObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments)) return
    if (child.geometry) geometries.add(child.geometry)
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material]
    childMaterials.forEach((material) => {
      if (material) materials.add(material)
    })
  })

  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}

function buildFallbackObject(shape: ModelShape): ShapeObject {
  const root = new THREE.Group() as ShapeObject
  const solid = new THREE.Mesh(primitiveGeometry(shape.type), displayMaterial(shape))
  root.add(solid)

  if (!shape.isHole && shape.holes?.length) {
    const inverseBase = matrixFromShape(shape).invert()
    shape.holes.forEach((hole) => {
      const preview = new THREE.Mesh(primitiveGeometry(hole.type), displayMaterial({ ...hole, isHole: true }))
      const localMatrix = inverseBase.clone().multiply(matrixFromShape(hole))
      localMatrix.decompose(preview.position, preview.quaternion, preview.scale)
      preview.updateMatrixWorld(true)
      root.add(preview)
    })
  }

  applyShapeTransform(root, shape)
  markSelectable(root, shape)
  return root
}

/**
 * Builds the subtraction in the base shape's local coordinates. Keeping the
 * result local lets TransformControls move the finished object as one piece.
 */
function buildCsgObject(shape: ModelShape): ShapeObject {
  const temporaryBrushes: Brush[] = []
  const temporaryGeometries = new Set<THREE.BufferGeometry>()
  const csgMaterial = new THREE.MeshBasicMaterial({ color: shape.color })

  try {
    const evaluator = new Evaluator()
    evaluator.attributes = ['position', 'normal']
    evaluator.useGroups = false

    const baseGeometry = primitiveGeometry(shape.type)
    temporaryGeometries.add(baseGeometry)
    let result = new Brush(baseGeometry, csgMaterial)
    temporaryBrushes.push(result)
    result.updateMatrixWorld(true)

    const inverseBase = matrixFromShape(shape).invert()
    for (const hole of shape.holes ?? []) {
      const holeGeometry = primitiveGeometry(hole.type)
      temporaryGeometries.add(holeGeometry)
      const holeBrush = new Brush(holeGeometry, csgMaterial)
      temporaryBrushes.push(holeBrush)

      const localHoleMatrix = inverseBase.clone().multiply(matrixFromShape(hole))
      localHoleMatrix.decompose(holeBrush.position, holeBrush.quaternion, holeBrush.scale)
      holeBrush.updateMatrix()
      holeBrush.updateMatrixWorld(true)

      const previous = result
      result = evaluator.evaluate(previous, holeBrush, SUBTRACTION)
      temporaryBrushes.push(result)
      temporaryGeometries.add(result.geometry)
      result.updateMatrixWorld(true)
    }

    const resultGeometry = result.geometry
    temporaryGeometries.delete(resultGeometry)
    temporaryBrushes.forEach((brush) => brush.disposeCacheData())
    temporaryGeometries.forEach((geometry) => geometry.dispose())
    csgMaterial.dispose()

    resultGeometry.computeBoundingBox()
    resultGeometry.computeBoundingSphere()
    const mesh = new THREE.Mesh(resultGeometry, displayMaterial(shape)) as ShapeObject
    applyShapeTransform(mesh, shape)
    markSelectable(mesh, shape)
    return mesh
  } catch (error) {
    temporaryBrushes.forEach((brush) => brush.disposeCacheData())
    temporaryGeometries.forEach((geometry) => geometry.dispose())
    csgMaterial.dispose()
    throw error
  }
}

function buildShapeObject(shape: ModelShape): ShapeObject {
  if (!shape.isHole && shape.holes?.length) {
    try {
      return buildCsgObject(shape)
    } catch (error) {
      if (!warnedCsgShapes.has(shape.id)) {
        warnedCsgShapes.add(shape.id)
        console.warn(`无法为“${shape.name}”计算布尔挖孔，已切换为透明预览。`, error)
      }
    }
  }

  return buildFallbackObject(shape)
}

function transformedShape(source: ModelShape, object: THREE.Object3D): ModelShape {
  object.updateMatrix()
  object.updateMatrixWorld(true)

  const scale = {
    x: Math.max(0.1, Math.abs(object.scale.x)),
    y: Math.max(0.1, Math.abs(object.scale.y)),
    z: Math.max(0.1, Math.abs(object.scale.z)),
  }
  object.scale.set(scale.x, scale.y, scale.z)
  object.updateMatrix()
  object.updateMatrixWorld(true)

  const updated: ModelShape = {
    ...source,
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
    scale,
  }

  if (!source.holes?.length) return updated

  // A grouped hole is stored in world coordinates. Apply the base object's
  // transform delta so a later rebuild keeps every hole fixed inside the base.
  const inverseOldBase = matrixFromShape(source).invert()
  const newBase = matrixFromShape(updated)
  updated.holes = source.holes.map((hole) => {
    const localHole = inverseOldBase.clone().multiply(matrixFromShape(hole))
    const nextWorld = newBase.clone().multiply(localHole)
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const holeScale = new THREE.Vector3()
    nextWorld.decompose(position, quaternion, holeScale)
    const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ')

    return {
      ...hole,
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
      scale: { x: holeScale.x, y: holeScale.y, z: holeScale.z },
    }
  })

  return updated
}

function removeSelectionOutline(runtime: ViewportRuntime) {
  if (!runtime.selectionOutline) return
  runtime.scene.remove(runtime.selectionOutline)
  runtime.selectionOutline.geometry.dispose()
  disposeMaterial(runtime.selectionOutline.material)
  runtime.selectionOutline = null
}

function clearShapeGroup(runtime: ViewportRuntime) {
  runtime.transform.detach()
  removeSelectionOutline(runtime)
  while (runtime.shapeGroup.children.length) {
    const child = runtime.shapeGroup.children[0]
    runtime.shapeGroup.remove(child)
    disposeModelObject(child)
  }
  runtime.shapeObjects.clear()
  runtime.shapeSources.clear()
}

function clearTargetGroup(runtime: ViewportRuntime) {
  while (runtime.targetGroup.children.length) {
    const child = runtime.targetGroup.children[0]
    runtime.targetGroup.remove(child)
    disposeModelObject(child)
  }
}

function buildTargetObject(shape: ModelShape) {
  const geometry = primitiveGeometry(shape.type)
  const material = new THREE.MeshBasicMaterial({
    color: '#20a7c9',
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: '#1687a5', transparent: true, opacity: 0.72 }),
  )
  mesh.add(edges)
  applyShapeTransform(mesh, shape)
  return mesh
}

function resetView(runtime: ViewportRuntime) {
  runtime.camera.position.set(8.6, 7.2, 10.5)
  runtime.orbit.target.set(0, 1.5, 0)
  runtime.orbit.update()
}

export function createModelGroupForExport(shapes: ModelShape[]) {
  const group = new THREE.Group()
  group.name = 'maker-island-export'
  shapes.filter((shape) => !shape.isHole).forEach((shape) => group.add(buildShapeObject(shape)))
  group.updateMatrixWorld(true)
  return group
}

export function ModelViewport({
  shapes,
  targetShapes = [],
  selectedId,
  mode,
  transformEnabled = true,
  resetViewSignal = 0,
  onSelect,
  onTransformEnd,
}: ModelViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<ViewportRuntime | null>(null)
  const onSelectRef = useRef(onSelect)
  const onTransformEndRef = useRef(onTransformEnd)
  const modeRef = useRef(mode)
  const [rendererFailed, setRendererFailed] = useState(false)

  onSelectRef.current = onSelect
  onTransformEndRef.current = onTransformEnd
  modeRef.current = mode

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true })
    } catch (error) {
      console.error('无法启动 3D 画布。', error)
      setRendererFailed(true)
      return
    }

    setRendererFailed(false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.tabIndex = 0
    renderer.domElement.setAttribute('role', 'application')
    renderer.domElement.setAttribute(
      'aria-label',
      '三维造物画布。拖动空白处旋转视角，滚轮缩放；选中形状后使用彩色控制柄操作。',
    )
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#dff4ff')
    scene.fog = new THREE.Fog('#dff4ff', 18, 38)

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    camera.position.set(8.6, 7.2, 10.5)

    const ambient = new THREE.HemisphereLight('#ffffff', '#91a6ba', 2.05)
    scene.add(ambient)
    const keyLight = new THREE.DirectionalLight('#fff8e7', 2.5)
    keyLight.position.set(7, 11, 5)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight('#9bcfff', 0.8)
    fillLight.position.set(-7, 5, -6)
    scene.add(fillLight)

    const grid = new THREE.GridHelper(24, 24, '#83b7cb', '#b9dbe6')
    grid.position.y = -0.001
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]
    gridMaterials.forEach((material) => {
      material.transparent = true
      material.opacity = 0.62
    })
    scene.add(grid)

    const shapeGroup = new THREE.Group()
    shapeGroup.name = 'model-shapes'
    scene.add(shapeGroup)

    const targetGroup = new THREE.Group()
    targetGroup.name = 'quest-targets'
    scene.add(targetGroup)

    const orbit = new OrbitControls(camera, renderer.domElement)
    orbit.enableDamping = true
    orbit.dampingFactor = 0.075
    orbit.minDistance = 3
    orbit.maxDistance = 28
    orbit.maxPolarAngle = Math.PI * 0.495
    orbit.target.set(0, 1.5, 0)
    orbit.update()

    const transform = new TransformControls(camera, renderer.domElement)
    transform.setMode(modeRef.current)
    transform.setSize(0.82)
    transform.translationSnap = 0.25
    transform.rotationSnap = THREE.MathUtils.degToRad(5)
    transform.scaleSnap = 0.1
    const transformHelper = transform.getHelper()
    scene.add(transformHelper)

    const runtime: ViewportRuntime = {
      scene,
      camera,
      renderer,
      orbit,
      transform,
      transformHelper,
      shapeGroup,
      targetGroup,
      shapeObjects: new Map(),
      shapeSources: new Map(),
      selectionOutline: null,
      animationFrame: 0,
      resizeObserver: null,
      resizeFallback: null,
    }
    runtimeRef.current = runtime

    let changedDuringTransform = false
    let suppressCanvasSelection = false
    const handleDraggingChanged = (event: unknown) => {
      const dragging = Boolean((event as { value?: boolean }).value)
      orbit.enabled = !dragging
    }
    const handleTransformMouseDown = () => {
      changedDuringTransform = false
      suppressCanvasSelection = true
    }
    const handleObjectChange = () => {
      changedDuringTransform = true
      runtime.selectionOutline?.update()
    }
    const handleTransformMouseUp = () => {
      const object = transform.object as ShapeObject | undefined
      const shapeId = object?.userData.shapeId
      const source = shapeId ? runtime.shapeSources.get(shapeId) : undefined
      if (changedDuringTransform && object && source) {
        onTransformEndRef.current(transformedShape(source, object), modeRef.current === 'translate' ? 'move' : modeRef.current)
      }
      changedDuringTransform = false
      // A release outside the canvas does not reach handlePointerUp. Clear the
      // guard on the next task so the following real click is never swallowed.
      window.setTimeout(() => {
        suppressCanvasSelection = false
      }, 0)
    }

    transform.addEventListener('dragging-changed', handleDraggingChanged)
    transform.addEventListener('mouseDown', handleTransformMouseDown)
    transform.addEventListener('objectChange', handleObjectChange)
    transform.addEventListener('mouseUp', handleTransformMouseUp)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let pointerStart: { x: number; y: number } | null = null

    const handlePointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY }
      renderer.domElement.focus({ preventScroll: true })
    }
    const handlePointerUp = (event: PointerEvent) => {
      if (suppressCanvasSelection) {
        suppressCanvasSelection = false
        pointerStart = null
        return
      }
      if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) {
        pointerStart = null
        return
      }
      pointerStart = null

      const bounds = renderer.domElement.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const intersection = raycaster.intersectObjects(shapeGroup.children, true)[0]
      const selectedShapeId = intersection?.object.userData.shapeId
      onSelectRef.current(typeof selectedShapeId === 'string' ? selectedShapeId : null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSelectRef.current(null)
    }
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)
    renderer.domElement.addEventListener('keydown', handleKeyDown)

    let resizeFrame: number | null = null
    let renderedWidth = 0
    let renderedHeight = 0
    const resize = () => {
      resizeFrame = null
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      if (width === renderedWidth && height === renderedHeight) return
      renderedWidth = width
      renderedHeight = height
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const scheduleResize = () => {
      if (resizeFrame !== null) return
      resizeFrame = window.requestAnimationFrame(resize)
    }
    resize()
    if (typeof ResizeObserver !== 'undefined') {
      runtime.resizeObserver = new ResizeObserver(scheduleResize)
      runtime.resizeObserver.observe(host)
    } else {
      runtime.resizeFallback = scheduleResize
      window.addEventListener('resize', scheduleResize)
    }

    const animate = () => {
      runtime.animationFrame = window.requestAnimationFrame(animate)
      orbit.update()
      runtime.selectionOutline?.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      runtimeRef.current = null
      window.cancelAnimationFrame(runtime.animationFrame)
      runtime.resizeObserver?.disconnect()
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      if (runtime.resizeFallback) window.removeEventListener('resize', runtime.resizeFallback)
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      renderer.domElement.removeEventListener('keydown', handleKeyDown)
      transform.removeEventListener('dragging-changed', handleDraggingChanged)
      transform.removeEventListener('mouseDown', handleTransformMouseDown)
      transform.removeEventListener('objectChange', handleObjectChange)
      transform.removeEventListener('mouseUp', handleTransformMouseUp)
      transform.detach()
      removeSelectionOutline(runtime)
      clearShapeGroup(runtime)
      clearTargetGroup(runtime)
      transform.dispose()
      orbit.dispose()
      scene.remove(transformHelper, grid, shapeGroup, targetGroup)
      disposeModelObject(grid)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return

    clearShapeGroup(runtime)
    shapes.forEach((shape) => {
      const object = buildShapeObject(shape)
      runtime.shapeGroup.add(object)
      runtime.shapeObjects.set(shape.id, object)
      runtime.shapeSources.set(shape.id, shape)
    })
  }, [shapes])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    clearTargetGroup(runtime)
    targetShapes.forEach((shape) => runtime.targetGroup.add(buildTargetObject(shape)))
  }, [targetShapes])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || resetViewSignal === 0) return
    resetView(runtime)
  }, [resetViewSignal])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return

    runtime.transform.setMode(mode)
    runtime.transform.detach()
    removeSelectionOutline(runtime)

    if (!selectedId || !transformEnabled) return
    const selectedObject = runtime.shapeObjects.get(selectedId)
    if (!selectedObject) return

    runtime.transform.attach(selectedObject)
    const outline = new THREE.BoxHelper(selectedObject, '#ff9f1c')
    const outlineMaterials = Array.isArray(outline.material) ? outline.material : [outline.material]
    outlineMaterials.forEach((material) => {
      material.transparent = true
      material.opacity = 0.82
      material.depthTest = false
    })
    outline.renderOrder = 10
    runtime.scene.add(outline)
    runtime.selectionOutline = outline
  }, [mode, selectedId, shapes, transformEnabled])

  return (
    <div
      ref={hostRef}
      className="model-viewport"
      data-testid="model-viewport"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320, overflow: 'hidden' }}
    >
      {rendererFailed ? (
        <p
          role="alert"
          style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', margin: 0, padding: 24 }}
        >
          这台设备暂时无法打开 3D 画布，请尝试更新浏览器或开启硬件加速。
        </p>
      ) : shapes.length === 0 ? (
        <p
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            zIndex: 1,
            left: '50%',
            top: '50%',
            width: 'min(80%, 360px)',
            margin: 0,
            padding: '14px 18px',
            borderRadius: 18,
            color: '#31536a',
            background: 'rgba(255, 255, 255, 0.88)',
            boxShadow: '0 10px 30px rgba(42, 93, 120, 0.14)',
            textAlign: 'center',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        >
          画布还是空的，从形状工具箱放入第一块积木吧！
        </p>
      ) : null}
    </div>
  )
}

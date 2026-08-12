import type { CanvasKit } from 'canvaskit-wasm'
import { onScopeDispose } from 'vue'
import type { Ref } from 'vue'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import type { Editor } from '@open-pencil/core/editor'

import { createCanvasContextRecovery } from '#vue/canvas/surface/context-recovery'
import { makeGLSurface, sizeCanvas, type CanvasGLContext } from '#vue/canvas/surface/gl-surface'
import { useCanvasKitLoader } from '#vue/canvas/surface/kit-loader'
import { createCanvasRenderLoop } from '#vue/canvas/surface/render-loop'
import { useCanvasResizeObserver } from '#vue/canvas/surface/resize-observer'
import type { UseCanvasOptions } from '#vue/canvas/surface/types'

type SurfaceManagerState = {
  renderer: SkiaRenderer | null
  glContext: CanvasGLContext | null
  resourceGeneration: number
  contextLosses: number
  contextRestorations: number
  contextsCreated: number
  contextsDeleted: number
  renderersCreated: number
  renderersDeleted: number
}

export function createCanvasSurfaceManager({
  editor,
  canvasRef,
  options,
  getCanvasKit,
  isDestroyed,
  shouldShowRulers,
  createRenderer = createDefaultRenderer
}: {
  editor: Editor
  canvasRef: { value: HTMLCanvasElement | null }
  options: UseCanvasOptions | undefined
  getCanvasKit: () => CanvasKit | null
  isDestroyed: () => boolean
  shouldShowRulers: () => boolean
  createRenderer?: typeof createDefaultRenderer
}) {
  const state: SurfaceManagerState = {
    renderer: null,
    glContext: null,
    resourceGeneration: 0,
    contextLosses: 0,
    contextRestorations: 0,
    contextsCreated: 0,
    contextsDeleted: 0,
    renderersCreated: 0,
    renderersDeleted: 0
  }
  let sceneBackingRenderTimer: ReturnType<typeof setTimeout> | null = null
  const contextRecovery = createCanvasContextRecovery({
    getCanvas: () => canvasRef.value,
    isDestroyed,
    onLost: () => {
      state.contextLosses += 1
      clearSceneBackingRenderTimer()
      destroySurface()
      const canvas = canvasRef.value
      if (canvas) {
        delete canvas.dataset.ready
        canvas.dataset.surfaceError = 'webgl-context-lost'
      }
      syncLifecycleData()
    },
    onRestored: () => {
      clearSceneBackingRenderTimer()
      const canvas = canvasRef.value
      if (!canvas) return
      if (!createSurface(canvas, { reloadFonts: true, recreated: true })) return
      state.contextRestorations += 1
      syncLifecycleData()
      renderLoop.markDirty()
    }
  })

  function clearSceneBackingRenderTimer() {
    if (sceneBackingRenderTimer === null) return
    clearTimeout(sceneBackingRenderTimer)
    sceneBackingRenderTimer = null
  }

  function syncLifecycleData() {
    const canvas = canvasRef.value
    if (!canvas) return
    canvas.dataset.contextLosses = String(state.contextLosses)
    canvas.dataset.contextRestorations = String(state.contextRestorations)
    canvas.dataset.contextsCreated = String(state.contextsCreated)
    canvas.dataset.contextsDeleted = String(state.contextsDeleted)
    canvas.dataset.renderersCreated = String(state.renderersCreated)
    canvas.dataset.renderersDeleted = String(state.renderersDeleted)
    canvas.dataset.resourceGeneration = String(state.resourceGeneration)
  }

  function destroySurface() {
    const renderer = state.renderer
    const glContext = state.glContext
    state.renderer = null
    state.glContext = null
    try {
      if (renderer) {
        try {
          editor.removeCanvasRenderer(renderer)
        } finally {
          renderer.destroy()
          state.renderersDeleted += 1
        }
      }
    } finally {
      if (glContext) {
        glContext.delete()
        state.contextsDeleted += 1
      }
      syncLifecycleData()
    }
  }

  function createSurface(
    canvas: HTMLCanvasElement,
    { reloadFonts = false, recreated = false }: { reloadFonts?: boolean; recreated?: boolean } = {}
  ): boolean {
    if (contextRecovery.isLost()) return false
    contextRecovery.bind(canvas)
    delete canvas.dataset.ready
    const ck = getCanvasKit()
    if (!ck) return false

    destroySurface()

    sizeCanvas(canvas, editor)

    const result = makeGLSurface(ck, canvas, editor, options, state.glContext)
    if (result.contextCreated) state.contextsCreated += 1
    if (result.contextDeleted) state.contextsDeleted += 1
    state.glContext = result.glContext
    const surface = result.surface
    if (!surface || !result.webglContext) {
      canvas.dataset.surfaceError = 'webgl'
      syncLifecycleData()
      return false
    }

    try {
      state.renderer = createRenderer(ck, surface, result.webglContext)
    } catch {
      surface.delete()
      destroySurface()
      canvas.dataset.surfaceError = 'webgl'
      syncLifecycleData()
      return false
    }
    state.renderersCreated += 1
    editor.setCanvasKit(ck, state.renderer)
    if (recreated) state.resourceGeneration += 1
    canvas.dataset.rendererBackend = 'webgl2'
    delete canvas.dataset.surfaceError
    canvas.dataset.ready = '1'
    syncLifecycleData()

    // When the surface is recreated after a resize fallback, destroyRenderer
    // has cleared the module-level fontProvider — the new renderer must reload.
    // On initial mount, kit-loader.init() handles loadFonts, so skip here.
    if (reloadFonts && !isDestroyed()) {
      void state.renderer.loadFonts(renderNow).then(() => {
        if (!isDestroyed()) renderNow()
        return undefined
      })
    }
    return true
  }

  function renderNow() {
    if (!state.renderer || isDestroyed() || contextRecovery.isLost()) return
    state.renderer.renderFromEditorState(
      editor.state,
      editor.graph,
      editor.textEditor,
      canvasRef.value?.clientWidth ?? 0,
      canvasRef.value?.clientHeight ?? 0,
      shouldShowRulers(),
      options?.layer ?? 'full'
    )
    renderLoop.markRendered()
    clearSceneBackingRenderTimer()
    if (options?.layer === 'scene' && state.renderer.sceneBackingNeedsCrispRender) {
      const delay = Math.max(0, state.renderer.sceneBackingPreviewUntil - performance.now())
      sceneBackingRenderTimer = setTimeout(() => renderLoop.markDirty(), delay)
    }
  }

  const renderLoop = createCanvasRenderLoop(editor, renderNow, { layer: options?.layer })

  function resizeCanvas(canvas: HTMLCanvasElement) {
    if (contextRecovery.isLost()) return
    const ck = getCanvasKit()
    if (!ck || !state.renderer) {
      createSurface(canvas)
      return
    }

    sizeCanvas(canvas, editor)

    const result = makeGLSurface(ck, canvas, editor, options, state.glContext)
    state.glContext = result.glContext
    const surface = result.surface
    if (!surface) {
      console.warn('Falling back to full surface recreation after resize')
      createSurface(canvas, { reloadFonts: true })
      return
    }
    state.renderer.replaceSurface(surface)
    renderNow()
  }

  function destroy() {
    clearSceneBackingRenderTimer()
    renderLoop.pause()
    contextRecovery.unbind()
    destroySurface()
  }

  return {
    createSurface,
    resizeCanvas,
    renderNow,
    destroy,
    markDirty: renderLoop.markDirty,
    getRenderer: () => state.renderer,
    getBackend: () => (state.renderer ? 'webgl2' : null),
    getResourceGeneration: () => state.resourceGeneration,
    getLifecycleStats: () => ({
      backend: state.renderer ? ('webgl2' as const) : null,
      contextLosses: state.contextLosses,
      contextRestorations: state.contextRestorations,
      contextsCreated: state.contextsCreated,
      contextsDeleted: state.contextsDeleted,
      renderersCreated: state.renderersCreated,
      renderersDeleted: state.renderersDeleted,
      resourceGeneration: state.resourceGeneration
    })
  }
}

function createDefaultRenderer(
  ck: CanvasKit,
  surface: ConstructorParameters<typeof SkiaRenderer>[1],
  gl: WebGL2RenderingContext
): SkiaRenderer {
  return new SkiaRenderer(ck, surface, gl)
}

export function useCanvasSurfaceLifecycle({
  canvasRef,
  surface,
  setCanvasKit,
  getCanvasKitValue,
  lifecycle,
  onReady
}: {
  canvasRef: Ref<HTMLCanvasElement | null>
  surface: ReturnType<typeof createCanvasSurfaceManager>
  setCanvasKit: (ck: CanvasKit | null) => void
  getCanvasKitValue: () => CanvasKit | null
  lifecycle: { destroyed: boolean }
  onReady?: () => void
}) {
  useCanvasKitLoader({
    canvasRef,
    lifecycle,
    setCanvasKit,
    createSurface: surface.createSurface,
    loadFonts: () => surface.getRenderer()?.loadFonts(surface.renderNow),
    renderNow: surface.renderNow,
    onReady
  })

  const { cancelResize } = useCanvasResizeObserver({
    canvasRef,
    getCanvasKitValue,
    resizeCanvas: surface.resizeCanvas
  })

  onScopeDispose(() => {
    lifecycle.destroyed = true
    cancelResize()
    surface.destroy()
  })
}

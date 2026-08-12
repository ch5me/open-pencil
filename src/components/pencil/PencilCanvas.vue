<script setup lang="ts">
import type { CanvasKit, Paint, Surface } from 'canvaskit-wasm'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { getCanvasKit } from '@open-pencil/core/canvaskit'
import type { PencilCanvasPoint, PencilRuntimeSnapshot } from '@/app/pencil/types'

const { snapshot } = defineProps<{
  snapshot: PencilRuntimeSnapshot
}>()

const emit = defineEmits<{
  touches: [count: number]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
let resizeObserver: ResizeObserver | null = null
let canvasKit: CanvasKit | null = null
let surface: Surface | null = null
let inkPaint: Paint | null = null
let predictionPaint: Paint | null = null
let hoverPaint: Paint | null = null

function strokeWidth(pressure: number): number {
  return 1.5 + Math.max(0, Math.min(1, pressure)) * 13
}

function drawPoints(
  skiaCanvas: ReturnType<Surface['getCanvas']>,
  paint: Paint,
  points: readonly PencilCanvasPoint[]
) {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const point = points[index]
    paint.setStrokeWidth(strokeWidth((previous.pressure + point.pressure) / 2))
    skiaCanvas.drawLine(previous.x, previous.y, point.x, point.y, paint)
  }
  if (points.length === 1) {
    const point = points[0]
    skiaCanvas.drawCircle(point.x, point.y, strokeWidth(point.pressure) / 2, paint)
  }
}

function render() {
  const element = canvas.value
  if (!element || !canvasKit) return
  const rect = element.getBoundingClientRect()
  const scale = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(rect.width * scale))
  const height = Math.max(1, Math.round(rect.height * scale))
  if (element.width !== width || element.height !== height) {
    element.width = width
    element.height = height
    surface?.delete()
    surface = canvasKit.MakeWebGLCanvasSurface(element)
  }
  surface ??= canvasKit.MakeWebGLCanvasSurface(element)
  if (!surface || !inkPaint || !predictionPaint || !hoverPaint) return
  const skiaCanvas = surface.getCanvas()
  skiaCanvas.clear(canvasKit.TRANSPARENT)
  skiaCanvas.save()
  skiaCanvas.scale(scale, scale)
  for (const stroke of snapshot.committedStrokes) {
    drawPoints(skiaCanvas, inkPaint, stroke.points)
  }
  for (const prediction of snapshot.predictions) {
    drawPoints(skiaCanvas, predictionPaint, prediction.points)
  }
  const pose = snapshot.hover?.pose
  if (pose) {
    const size = 12 + (1 - (pose.zOffset ?? 1)) * 22
    skiaCanvas.drawCircle(pose.point.viewX, pose.point.viewY, size, hoverPaint)
    skiaCanvas.drawLine(
      pose.point.viewX - size - 6,
      pose.point.viewY,
      pose.point.viewX + size + 6,
      pose.point.viewY,
      hoverPaint
    )
    skiaCanvas.drawLine(
      pose.point.viewX,
      pose.point.viewY - size - 6,
      pose.point.viewX,
      pose.point.viewY + size + 6,
      hoverPaint
    )
  }
  skiaCanvas.restore()
  surface.flush()
}

function reportTouches(event: TouchEvent) {
  emit('touches', event.touches.length)
}

watch(
  () => snapshot,
  () => void nextTick(render),
  { deep: true }
)

onMounted(async () => {
  canvasKit = await getCanvasKit()
  inkPaint = new canvasKit.Paint()
  inkPaint.setStyle(canvasKit.PaintStyle.Stroke)
  inkPaint.setStrokeCap(canvasKit.StrokeCap.Round)
  inkPaint.setStrokeJoin(canvasKit.StrokeJoin.Round)
  inkPaint.setColor(canvasKit.Color(23, 33, 43, 0.95))
  predictionPaint = new canvasKit.Paint()
  predictionPaint.setStyle(canvasKit.PaintStyle.Stroke)
  predictionPaint.setStrokeCap(canvasKit.StrokeCap.Round)
  predictionPaint.setStrokeJoin(canvasKit.StrokeJoin.Round)
  predictionPaint.setColor(canvasKit.Color(233, 116, 54, 0.42))
  hoverPaint = new canvasKit.Paint()
  hoverPaint.setStyle(canvasKit.PaintStyle.Stroke)
  hoverPaint.setStrokeWidth(1.5)
  hoverPaint.setColor(canvasKit.Color(233, 116, 54, 1))
  resizeObserver = new ResizeObserver(render)
  if (canvas.value) resizeObserver.observe(canvas.value)
  render()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  inkPaint?.delete()
  predictionPaint?.delete()
  hoverPaint?.delete()
  surface?.delete()
})
</script>

<template>
  <canvas
    ref="canvas"
    data-test-id="pencil-canvas"
    class="absolute inset-0 size-full touch-none"
    aria-label="Apple Pencil pressure canvas"
    @touchstart="reportTouches"
    @touchmove="reportTouches"
  />
</template>

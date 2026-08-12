<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { createPencilEvidence, type PencilEvidenceIdentity } from '@/app/pencil/evidence'
import { downloadBlob } from '@/app/document/io/browser'
import { PencilCanvasRuntime } from '@/app/pencil/runtime'
import type { PencilRuntimeSnapshot, PencilScenarioId, PencilTestDriver } from '@/app/pencil/types'
import PencilCanvas from '@/components/pencil/PencilCanvas.vue'
import PencilDiagnosticsPanel from '@/components/pencil/PencilDiagnosticsPanel.vue'

const canvasHost = ref<HTMLElement | null>(null)
const snapshot = ref<PencilRuntimeSnapshot>({
  capabilities: null,
  diagnostics: null,
  hover: null,
  action: null,
  committedStrokes: [],
  predictions: [],
  latencySamplesMs: [],
  coalescedSampleCount: 0,
  predictedSampleCount: 0,
  persistedPredictionCount: 0,
  boundaryLossCount: 0,
  touchCoexistenceObserved: false,
  scenarios: [],
  runStartedAt: null,
  runCompletedAt: null,
  startingResidentSetSizeBytes: null
})
let runtime: PencilCanvasRuntime | null = null
let unsubscribe: (() => void | Promise<void>) | null = null

function evidenceIdentity(): PencilEvidenceIdentity {
  const params = new URLSearchParams(location.search)
  return {
    deviceName: params.get('deviceName') ?? '',
    deviceId: params.get('deviceId') ?? '',
    osVersion: params.get('osVersion') ?? '',
    pencilName: params.get('pencilName') ?? '',
    operator: params.get('operator') ?? '',
    runId: params.get('runId') ?? crypto.randomUUID(),
    buildSha: params.get('buildSha') ?? '',
    artifactSha256: params.get('artifactSha256') ?? ''
  }
}

function exportEvidence() {
  const evidence = createPencilEvidence(snapshot.value, evidenceIdentity())
  downloadBlob(
    new TextEncoder().encode(`${JSON.stringify(evidence, null, 2)}\n`),
    `apple-pencil-evidence-${evidence.runId}.json`,
    'application/json'
  )
}

function passScenario(id: PencilScenarioId, observations: string) {
  runtime?.markScenario(id, observations)
}

function recordTouches(count: number) {
  runtime?.recordTouchCoexistence(count)
}

function beginRun() {
  runtime?.beginRun()
}

function completeRun() {
  runtime?.completeRun()
}

function clearCanvas() {
  runtime?.clearCanvas()
}

onMounted(async () => {
  const canvas = canvasHost.value?.querySelector('canvas')
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Pencil canvas unavailable')
  runtime = new PencilCanvasRuntime(canvas)
  unsubscribe = runtime.subscribe((value) => {
    snapshot.value = value
  })
  window.openPencil ??= {}
  window.openPencil.pencilTestDriver = runtime.testDriver() satisfies PencilTestDriver
  await runtime.start()
})

onUnmounted(() => {
  if (window.openPencil) delete window.openPencil.pencilTestDriver
  void unsubscribe?.()
  void runtime?.stop()
})
</script>

<template>
  <main class="flex h-screen w-screen overflow-hidden bg-[#e8e4db]">
    <section ref="canvasHost" class="relative min-w-0 flex-1 overflow-hidden">
      <div
        class="pointer-events-none absolute inset-0 opacity-35"
        style="
          background-image:
            linear-gradient(#a7a198 1px, transparent 1px),
            linear-gradient(90deg, #a7a198 1px, transparent 1px);
          background-size: 28px 28px;
        "
      />
      <div class="pointer-events-none absolute top-7 left-8 z-10">
        <p class="font-mono text-[10px] tracking-[0.28em] text-[#8f4c2b] uppercase">
          design.elf.dance / input proof
        </p>
        <h2 class="mt-2 font-serif text-4xl text-[#17212b]">Pressure field</h2>
        <p class="mt-2 max-w-sm text-sm text-[#59636a]">
          Draw with Pencil. Pressure changes width; tilt, roll, hover, actions, queue, and latency
          stay visible at right.
        </p>
      </div>
      <PencilCanvas :snapshot="snapshot" @touches="recordTouches" />
    </section>
    <PencilDiagnosticsPanel
      :snapshot="snapshot"
      @begin="beginRun"
      @complete="completeRun"
      @clear="clearCanvas"
      @export="exportEvidence"
      @pass-scenario="passScenario"
    />
  </main>
</template>

import {
  PencilInputManager,
  WebPointerInputAdapter,
  createHostedPencilInputAdapter,
  nativePointToClient,
  type PencilActionEvent,
  type PencilCapabilities,
  type PencilDiagnostics,
  type PencilHoverEvent,
  type PencilInputAdapter,
  type PencilSample,
  type PencilSampleBatch,
  type PredictedPencilSample,
  type Unsubscribe
} from '@ch5me/buzz-native-capabilities/pencil'
import { useIntervalFn } from '@vueuse/core'

import { PENCIL_SCENARIO_IDS, type PencilCanvasPoint, type PencilRuntimeSnapshot } from './types'

const DEFAULT_PRESSURE = 0.35

type SnapshotListener = (snapshot: PencilRuntimeSnapshot) => void

function createInitialSnapshot(): PencilRuntimeSnapshot {
  return {
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
    scenarios: PENCIL_SCENARIO_IDS.map((id) => ({ id, pass: false, observations: {} })),
    runStartedAt: null,
    runCompletedAt: null,
    startingResidentSetSizeBytes: null
  }
}

function pointFromSample(sample: PencilSample | PredictedPencilSample): PencilCanvasPoint {
  const point = nativePointToClient(sample.point, window.visualViewport)
  return {
    x: point.clientX,
    y: point.clientY,
    pressure: sample.pressure ?? DEFAULT_PRESSURE,
    nativeTimestamp: sample.nativeTimestamp,
    orientation: sample.orientation
  }
}

function completedStrokeCount(snapshot: PencilRuntimeSnapshot): number {
  return snapshot.committedStrokes.filter((stroke) => stroke.points.length > 1).length
}

function pressureRange(snapshot: PencilRuntimeSnapshot): number {
  const values = snapshot.committedStrokes.flatMap((stroke) =>
    stroke.points.map((point) => point.pressure)
  )
  if (!values.length) return 0
  return Math.max(...values) - Math.min(...values)
}

function observedOrientation(
  snapshot: PencilRuntimeSnapshot,
  key: 'altitudeAngle' | 'azimuthAngle' | 'rollAngle'
): boolean {
  return snapshot.committedStrokes.some((stroke) =>
    stroke.points.some((point) => point.orientation[key] !== null)
  )
}

export class PencilCanvasRuntime {
  private readonly manager: PencilInputAdapter
  private readonly listeners = new Set<SnapshotListener>()
  private readonly unsubscribe: Unsubscribe[]
  private readonly diagnosticsInterval = useIntervalFn(() => void this.refreshDiagnostics(), 1000, {
    immediate: false
  })
  private snapshot = createInitialSnapshot()
  private nativeClockOffsetSeconds = 0

  constructor(target: HTMLCanvasElement, manager?: PencilInputAdapter) {
    const native = (() => {
      try {
        return createHostedPencilInputAdapter()
      } catch {
        return null
      }
    })()
    this.manager = manager ?? new PencilInputManager(native, new WebPointerInputAdapter(target))
    this.unsubscribe = [
      this.manager.onSamples((batch) => this.applyBatch(batch)),
      this.manager.onHover((event) => this.applyHover(event)),
      this.manager.onAction((event) => this.applyAction(event)),
      this.manager.onCapabilities((capabilities) => this.applyCapabilities(capabilities))
    ]
  }

  async start(): Promise<PencilCapabilities> {
    const capabilities = await this.manager.start({
      source: 'auto',
      includePredictions: true,
      includeHover: true,
      pencilOnly: true,
      maximumBatchLatencyMs: 8
    })
    this.applyCapabilities(capabilities)
    const nativeNow = await this.manager.getClockSample?.()
    if (nativeNow !== undefined) {
      this.nativeClockOffsetSeconds = nativeNow - performance.now() / 1000
    }
    await this.refreshDiagnostics()
    this.diagnosticsInterval.resume()
    return capabilities
  }

  async stop(): Promise<void> {
    this.diagnosticsInterval.pause()
    for (const unsubscribe of this.unsubscribe) void unsubscribe()
    await this.manager.stop()
  }

  subscribe(listener: SnapshotListener): Unsubscribe {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): PencilRuntimeSnapshot {
    return structuredClone(this.snapshot)
  }

  beginRun(): void {
    this.snapshot = {
      ...createInitialSnapshot(),
      capabilities: this.snapshot.capabilities,
      diagnostics: this.snapshot.diagnostics,
      runStartedAt: new Date().toISOString(),
      startingResidentSetSizeBytes: this.snapshot.diagnostics?.residentSetSizeBytes ?? null
    }
    this.emit()
  }

  completeRun(): void {
    this.snapshot.runCompletedAt = new Date().toISOString()
    this.refreshAutomaticScenarios()
    this.emit()
  }

  clearCanvas(): void {
    this.snapshot.committedStrokes = []
    this.snapshot.predictions = []
    this.emit()
  }

  markScenario(id: (typeof PENCIL_SCENARIO_IDS)[number], observations: string): void {
    const scenario = this.snapshot.scenarios.find((candidate) => candidate.id === id)
    if (!scenario) return
    scenario.pass = true
    scenario.observations = {
      note: observations.trim() || 'Observed on the connected physical device'
    }
    this.emit()
  }

  recordTouchCoexistence(touchCount: number): void {
    if (touchCount < 2) return
    this.snapshot.touchCoexistenceObserved = true
    this.passScenario('two-finger-coexistence', { maximumTouchCount: touchCount })
    this.emit()
  }

  testDriver(): {
    emitSamples: (batch: PencilSampleBatch) => void
    emitHover: (event: PencilHoverEvent) => void
    emitAction: (event: PencilActionEvent) => void
    emitCapabilities: (capabilities: PencilCapabilities) => void
    setDiagnostics: (diagnostics: PencilDiagnostics) => void
  } {
    return {
      emitSamples: (batch) => this.applyBatch(batch),
      emitHover: (event) => this.applyHover(event),
      emitAction: (event) => this.applyAction(event),
      emitCapabilities: (capabilities) => this.applyCapabilities(capabilities),
      setDiagnostics: (diagnostics) => {
        this.snapshot.diagnostics = diagnostics
        this.emit()
      }
    }
  }

  private applyBatch(batch: PencilSampleBatch): void {
    this.snapshot.coalescedSampleCount += batch.committed.filter(
      (sample) => sample.origin === 'coalesced'
    ).length
    this.snapshot.predictedSampleCount += batch.predicted.length
    this.snapshot.latencySamplesMs.push(
      Math.max(
        0,
        (performance.now() / 1000 + this.nativeClockOffsetSeconds - batch.nativeEmitTimestamp) *
          1000
      )
    )
    if (this.snapshot.latencySamplesMs.length > 4096) {
      this.snapshot.latencySamplesMs.splice(0, this.snapshot.latencySamplesMs.length - 4096)
    }

    for (const sample of batch.committed) {
      let stroke = this.snapshot.committedStrokes.find(
        (candidate) => candidate.id === sample.strokeId
      )
      if (!stroke) {
        if (sample.phase !== 'began') this.snapshot.boundaryLossCount += 1
        stroke = { id: sample.strokeId, points: [] }
        this.snapshot.committedStrokes.push(stroke)
      }
      if (sample.origin === 'estimateUpdate' && sample.estimationUpdateIndex !== null) {
        const index = Math.min(stroke.points.length - 1, sample.estimationUpdateIndex)
        if (index >= 0) stroke.points[index] = pointFromSample(sample)
      } else {
        stroke.points.push(pointFromSample(sample))
      }
    }

    const endedStrokeIds = new Set(
      batch.committed
        .filter((sample) => sample.phase === 'ended' || sample.phase === 'cancelled')
        .map((sample) => sample.strokeId)
    )
    const predictions = batch.predicted.filter((sample) => !endedStrokeIds.has(sample.strokeId))
    this.snapshot.predictions = predictions.length
      ? [
          {
            strokeId: predictions[0].strokeId,
            generation: predictions[0].predictionGeneration,
            points: predictions.map(pointFromSample)
          }
        ]
      : []
    this.refreshAutomaticScenarios()
    this.emit()
  }

  private applyHover(event: PencilHoverEvent): void {
    this.snapshot.hover = event
    const zOffset = event.pose?.zOffset
    if (zOffset !== null && zOffset !== undefined) {
      this.passScenario('hover-z-offset', { latestZOffset: zOffset })
    }
    this.emit()
  }

  private applyAction(event: PencilActionEvent): void {
    this.snapshot.action = event
    if (event.type === 'doubleTap') {
      this.passScenario('double-tap-preference', { preferredAction: event.preferredAction })
    } else if (event.phase === 'ended') {
      this.passScenario('squeeze-phases-preference', { preferredAction: event.preferredAction })
    }
    this.emit()
  }

  private applyCapabilities(capabilities: PencilCapabilities): void {
    this.snapshot.capabilities = capabilities
    this.emit()
  }

  private async refreshDiagnostics(): Promise<void> {
    this.snapshot.diagnostics = await this.manager.getDiagnostics()
    this.refreshAutomaticScenarios()
    this.emit()
  }

  private refreshAutomaticScenarios(): void {
    const diagnostics = this.snapshot.diagnostics
    if (pressureRange(this.snapshot) >= 0.5) {
      this.passScenario('pressure-ramp', { pressureRange: pressureRange(this.snapshot) })
    }
    if (this.snapshot.coalescedSampleCount > 0 && completedStrokeCount(this.snapshot) > 0) {
      this.passScenario('fast-coalesced-line', {
        coalescedSampleCount: this.snapshot.coalescedSampleCount
      })
    }
    if (this.snapshot.predictedSampleCount > 0 && this.snapshot.predictions.length === 0) {
      this.passScenario('prediction-replacement', {
        predictedSampleCount: this.snapshot.predictedSampleCount,
        persistedPredictionCount: this.snapshot.persistedPredictionCount
      })
    }
    if (
      observedOrientation(this.snapshot, 'altitudeAngle') &&
      observedOrientation(this.snapshot, 'azimuthAngle')
    ) {
      this.passScenario('tilt-sweep', { tiltSamplesObserved: true })
    }
    if (observedOrientation(this.snapshot, 'rollAngle')) {
      this.passScenario('roll-sweep', { rollSamplesObserved: true })
    }
    if (this.snapshot.latencySamplesMs.length >= 100) {
      this.passScenario('capture-to-bridge-latency', {
        sampleCount: this.snapshot.latencySamplesMs.length
      })
    }
    if (
      this.snapshot.runStartedAt &&
      this.snapshot.runCompletedAt &&
      Date.parse(this.snapshot.runCompletedAt) - Date.parse(this.snapshot.runStartedAt) >=
        600_000 &&
      diagnostics
    ) {
      this.passScenario('ten-minute-stability', {
        maximumQueueDepth: diagnostics.maximumQueueDepth,
        droppedMoveSamples: diagnostics.droppedMoveSamples,
        residentSetSizeBytes: diagnostics.residentSetSizeBytes ?? 0
      })
    }
  }

  private passScenario(
    id: (typeof PENCIL_SCENARIO_IDS)[number],
    observations: Record<string, string | number | boolean>
  ): void {
    const scenario = this.snapshot.scenarios.find((candidate) => candidate.id === id)
    if (!scenario || scenario.pass) return
    scenario.pass = true
    scenario.observations = observations
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

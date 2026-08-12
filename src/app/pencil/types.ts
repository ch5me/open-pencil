import type {
  PencilActionEvent,
  PencilCapabilities,
  PencilDiagnostics,
  PencilHoverEvent,
  PencilOrientation,
  PencilSampleBatch
} from '@ch5me/buzz-native-capabilities/pencil'

export const PENCIL_SCENARIO_IDS = [
  'pressure-ramp',
  'fast-coalesced-line',
  'prediction-replacement',
  'tilt-sweep',
  'hover-z-offset',
  'roll-sweep',
  'double-tap-preference',
  'squeeze-phases-preference',
  'two-finger-coexistence',
  'capture-to-bridge-latency',
  'ten-minute-stability'
] as const

export type PencilScenarioId = (typeof PENCIL_SCENARIO_IDS)[number]

export type PencilCanvasPoint = {
  x: number
  y: number
  pressure: number
  nativeTimestamp: number
  orientation: PencilOrientation
}

export type PencilStroke = {
  id: string
  points: PencilCanvasPoint[]
}

export type PencilPrediction = {
  strokeId: string
  generation: number
  points: PencilCanvasPoint[]
}

export type PencilScenarioState = {
  id: PencilScenarioId
  pass: boolean
  observations: Record<string, string | number | boolean>
}

export type PencilRuntimeSnapshot = {
  capabilities: PencilCapabilities | null
  diagnostics: PencilDiagnostics | null
  hover: PencilHoverEvent | null
  action: PencilActionEvent | null
  committedStrokes: PencilStroke[]
  predictions: PencilPrediction[]
  latencySamplesMs: number[]
  coalescedSampleCount: number
  predictedSampleCount: number
  persistedPredictionCount: number
  boundaryLossCount: number
  touchCoexistenceObserved: boolean
  scenarios: PencilScenarioState[]
  runStartedAt: string | null
  runCompletedAt: string | null
  startingResidentSetSizeBytes: number | null
}

export interface PencilTestDriver {
  emitSamples(batch: PencilSampleBatch): void
  emitHover(event: PencilHoverEvent): void
  emitAction(event: PencilActionEvent): void
  emitCapabilities(capabilities: PencilCapabilities): void
  setDiagnostics(diagnostics: PencilDiagnostics): void
}

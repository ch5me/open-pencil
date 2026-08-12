import type { PencilRuntimeSnapshot, PencilScenarioId } from './types'

export type PencilEvidenceIdentity = {
  deviceName: string
  deviceId: string
  osVersion: string
  pencilName: string
  operator: string
  runId: string
  buildSha: string
  artifactSha256: string
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)]
}

function secondsBetween(startedAt: string | null, completedAt: string | null): number {
  if (!startedAt || !completedAt) return 0
  return Math.max(0, Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 1000))
}

export function createPencilEvidence(
  snapshot: PencilRuntimeSnapshot,
  identity: PencilEvidenceIdentity
) {
  const diagnostics = snapshot.diagnostics
  const endingRSS = diagnostics?.residentSetSizeBytes ?? null
  const startingRSS = snapshot.startingResidentSetSizeBytes
  const rssGrowthBytes =
    startingRSS === null || endingRSS === null ? 0 : Math.max(0, endingRSS - startingRSS)

  return {
    schemaVersion: 1,
    platform: 'ios',
    runtime: 'native-wkwebview',
    isSimulator: false,
    ...identity,
    startedAt: snapshot.runStartedAt,
    completedAt: snapshot.runCompletedAt,
    capabilities: snapshot.capabilities?.features ?? {},
    scenarios: snapshot.scenarios.map((scenario) => ({
      id: scenario.id,
      result: scenario.pass ? 'pass' : 'fail',
      observations: scenario.observations
    })),
    metrics: {
      captureToBridgeLatencyMs: {
        p95: percentile(snapshot.latencySamplesMs, 0.95),
        sampleCount: snapshot.latencySamplesMs.length
      },
      coalescedSampleCount: snapshot.coalescedSampleCount,
      predictedSampleCount: snapshot.predictedSampleCount,
      persistedPredictionCount: snapshot.persistedPredictionCount,
      boundaryLossCount: snapshot.boundaryLossCount,
      maxQueueDepth: diagnostics?.maximumQueueDepth ?? 0,
      droppedMoveSamples: diagnostics?.droppedMoveSamples ?? 0,
      droppedMoveSamplesReported: diagnostics !== null,
      stabilityDurationSeconds: secondsBetween(snapshot.runStartedAt, snapshot.runCompletedAt),
      rssGrowthBytes
    }
  }
}

export function scenarioLabel(id: PencilScenarioId): string {
  return id
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

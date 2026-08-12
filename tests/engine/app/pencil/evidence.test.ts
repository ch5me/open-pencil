import { describe, expect, test } from 'bun:test'

import { createPencilEvidence } from '@/app/pencil/evidence'
import { PENCIL_SCENARIO_IDS, type PencilRuntimeSnapshot } from '@/app/pencil/types'

describe('Apple Pencil evidence export', () => {
  test('maps measured runtime state to the signed-device checker schema', () => {
    const evidence = createPencilEvidence(snapshot(), {
      deviceName: 'iPad Pro',
      deviceId: 'device-1',
      osVersion: '26.0',
      pencilName: 'Apple Pencil Pro',
      operator: 'Chris',
      runId: 'run-1',
      buildSha: 'a'.repeat(40),
      artifactSha256: 'b'.repeat(64)
    })

    expect(evidence.runtime).toBe('native-wkwebview')
    expect(evidence.scenarios.map((scenario) => scenario.id)).toEqual(PENCIL_SCENARIO_IDS)
    expect(evidence.metrics.captureToBridgeLatencyMs).toEqual({ p95: 11, sampleCount: 5 })
    expect(evidence.metrics.rssGrowthBytes).toBe(32 * 1024 * 1024)
    expect(evidence.metrics.persistedPredictionCount).toBe(0)
  })
})

function snapshot(): PencilRuntimeSnapshot {
  return {
    capabilities: {
      schemaVersion: 1,
      source: 'native-ios',
      platform: 'iOS',
      osVersion: '26.0',
      features: {
        contact: 'available',
        pressure: 'available',
        tilt: 'available',
        roll: 'available',
        coalescedSamples: 'available',
        predictedSamples: 'available',
        estimatedPropertyUpdates: 'available',
        hover: 'available',
        hoverDistance: 'available',
        doubleTap: 'available',
        squeeze: 'available',
        canvasHaptics: 'available'
      },
      observed: []
    },
    diagnostics: {
      sessionId: 'session-1',
      samplesCaptured: 500,
      batchesEmitted: 100,
      droppedMoveSamples: 0,
      maximumQueueDepth: 23,
      activeStrokeCount: 0,
      latestCaptureToBridgeMs: 4,
      residentSetSizeBytes: 160 * 1024 * 1024,
      averageSamplesPerBatch: 5
    },
    hover: null,
    action: null,
    committedStrokes: [],
    predictions: [],
    latencySamplesMs: [2, 4, 7, 9, 11],
    coalescedSampleCount: 200,
    predictedSampleCount: 80,
    persistedPredictionCount: 0,
    boundaryLossCount: 0,
    touchCoexistenceObserved: true,
    scenarios: PENCIL_SCENARIO_IDS.map((id) => ({
      id,
      pass: true,
      observations: { note: 'observed' }
    })),
    runStartedAt: '2026-08-12T18:00:00Z',
    runCompletedAt: '2026-08-12T18:10:00Z',
    startingResidentSetSizeBytes: 128 * 1024 * 1024
  }
}

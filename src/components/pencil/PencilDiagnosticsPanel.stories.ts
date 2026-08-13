import type { Meta, StoryObj } from '@storybook/vue3-vite'

import type { PencilRuntimeSnapshot, PencilScenarioId } from '@/app/pencil/types'

import PencilDiagnosticsPanel from './PencilDiagnosticsPanel.vue'

type PencilDiagnosticsStoryArgs = {
  snapshot: PencilRuntimeSnapshot
}

const snapshot = {
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
    samplesCaptured: 1440,
    batchesEmitted: 240,
    droppedMoveSamples: 0,
    maximumQueueDepth: 31,
    activeStrokeCount: 0,
    latestCaptureToBridgeMs: 4.2,
    residentSetSizeBytes: 148 * 1024 * 1024,
    averageSamplesPerBatch: 6
  },
  hover: null,
  action: null,
  committedStrokes: [],
  predictions: [],
  latencySamplesMs: [2.8, 3.1, 4.2, 5.6, 7.4],
  coalescedSampleCount: 860,
  predictedSampleCount: 340,
  persistedPredictionCount: 0,
  boundaryLossCount: 0,
  touchCoexistenceObserved: true,
  scenarios: [
    {
      id: 'pressure-ramp',
      pass: true,
      observations: { note: 'Width increased continuously from light to firm pressure' }
    },
    {
      id: 'fast-coalesced-line',
      pass: true,
      observations: { note: '412 coalesced points, no visible gaps' }
    },
    ...(
      [
        'prediction-replacement',
        'tilt-sweep',
        'hover-z-offset',
        'roll-sweep',
        'double-tap-preference',
        'squeeze-phases-preference',
        'two-finger-coexistence',
        'capture-to-bridge-latency',
        'ten-minute-stability'
      ] satisfies PencilScenarioId[]
    ).map((id) => ({ id, pass: false, observations: {} }))
  ],
  runStartedAt: '2026-08-12T18:00:00Z',
  runCompletedAt: null,
  startingResidentSetSizeBytes: 128 * 1024 * 1024
} satisfies PencilRuntimeSnapshot

const meta = {
  title: 'Hosted/Pencil Diagnostics',
  args: { snapshot },
  parameters: {
    layout: 'fullscreen'
  },
  render: (args) => ({
    components: { PencilDiagnosticsPanel },
    setup: () => ({ args }),
    template:
      '<div style="height: 800px; display: flex; justify-content: flex-end; background: #e8e4db"><PencilDiagnosticsPanel :snapshot="args.snapshot" /></div>'
  })
} satisfies Meta<PencilDiagnosticsStoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const DeviceRun: Story = {}

import { expect, test } from 'bun:test'

import { createCompositionPlan } from '#core/canvas/composition'
import {
  createImageRenderAdapter,
  observeLongSessionLeakGuard,
  type ImageRevisionResolver
} from '#core/canvas/image-editor'
import type { SceneNode } from '#core/scene-graph'

const CORRUPTED_REVISION_ID = 'sha256:resilience-116-corrupted' as const
const HEALTHY_REVISION_ID = 'sha256:resilience-116-healthy' as const

type FixtureNode = SceneNode & { fills: readonly [{ imageHash: `asset:${string}` }] }

function resiliencePlan(includeCorrupt = true): ReturnType<typeof createCompositionPlan> {
  const nodes = (includeCorrupt ? ['corrupt', 'healthy'] : ['healthy']).map((name, index) => ({
    id: `resilience-116-${name}`,
    type: 'IMAGE',
    parentId: 'resilience-116-root',
    childIds: [],
    visible: true,
    opacity: 1,
    blendMode: 'NORMAL',
    clipsContent: false,
    rotation: 0,
    isMask: false,
    maskType: 'ALPHA',
    fills: [
      {
        type: 'IMAGE',
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: `asset:${name}`
      }
    ],
    x: index * 10,
    y: 0,
    width: 10,
    height: 10
  })) as FixtureNode[]
  const root = {
    id: 'resilience-116-root',
    type: 'GROUP',
    parentId: null,
    childIds: nodes.map((node) => node.id),
    visible: true,
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    clipsContent: false,
    rotation: 0,
    isMask: false,
    maskType: 'ALPHA',
    fills: [],
    x: 0,
    y: 0,
    width: 20,
    height: 10
  } as SceneNode
  const allNodes = [root, ...nodes]
  const graph = {
    rootId: root.id,
    getNode: (id: string) => allNodes.find((node) => node.id === id)
  }
  return createCompositionPlan(graph)
}

function resolver(): ImageRevisionResolver {
  return {
    getAsset: (assetId) => ({
      assetId,
      revisionId: assetId === 'asset:corrupt' ? CORRUPTED_REVISION_ID : HEALTHY_REVISION_ID
    }),
    getRevision: (revisionId) =>
      revisionId === HEALTHY_REVISION_ID
        ? {
            revisionId,
            kind: 'image',
            metadata: { width: 32, height: 32 },
            bytes: new Uint8Array([1, 2, 3])
          }
        : undefined
  }
}

test('RESILIENCE-GAP-116 isolates a corrupted image from healthy siblings', () => {
  const adapter = createImageRenderAdapter()
  const plan = resiliencePlan()
  const frame = adapter.render(plan, {
    getAsset: (assetId) => ({
      assetId,
      revisionId: assetId === 'asset:corrupt' ? CORRUPTED_REVISION_ID : HEALTHY_REVISION_ID
    }),
    getRevision: (revisionId) => {
      if (revisionId === HEALTHY_REVISION_ID) {
        return {
          revisionId,
          kind: 'image',
          metadata: { width: 32, height: 32 },
          bytes: new Uint8Array([1, 2, 3])
        }
      }
      if (revisionId === CORRUPTED_REVISION_ID) {
        return {
          revisionId,
          kind: 'image',
          metadata: { width: 32, height: 32 },
          bytes: new Uint8Array()
        }
      }
      return undefined
    }
  })

  expect(frame.commands).toHaveLength(3)
  expect(frame.textures).toHaveLength(1)
  expect(frame.textures[0]?.assetId).toBe('asset:healthy')
  expect(frame.gaps).toEqual([
    {
      code: 'corrupted-image',
      message: `image revision is corrupted: ${CORRUPTED_REVISION_ID}`,
      assetId: 'asset:corrupt'
    }
  ])
})

test('RESILIENCE-GAP-116 proves bounded adapter resources across a long render loop', () => {
  const adapter = createImageRenderAdapter()
  const plan = resiliencePlan(false)
  const resolve = resolver()
  const report = observeLongSessionLeakGuard(() => adapter.render(plan, resolve), 200)

  expect(report.samples).toBe(200)
  expect(report.leakedResources).toBe(0)
  expect(report.silentFailures).toBe(0)
  expect(report.contract.longSessionLeakGuard).toBe('SUPPORTED')
})

test('RESILIENCE-GAP-116 rejects an empty leak observation', () => {
  expect(() =>
    observeLongSessionLeakGuard(
      () => ({
        backend: 'skia',
        commands: [],
        textures: [],
        gaps: []
      }),
      0
    )
  ).toThrow(RangeError)
})

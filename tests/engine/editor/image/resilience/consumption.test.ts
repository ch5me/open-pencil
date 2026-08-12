import { expect, test } from 'bun:test'

import { createCompositionPlan } from '#core/canvas/composition'
import {
  createImageResilienceSession,
  ImageRenderContextLostError,
  ImageResilienceSessionBusyError,
  ImageResilienceSourceError,
  type ImageRevisionResolver
} from '#core/canvas/image-editor'
import type { SceneNode } from '#core/scene-graph'

const SOURCE_DIMENSION = 4096
const immediateSleep = async (): Promise<void> => {
  await Promise.resolve()
}

function imagePlan(
  assetIds = ['asset:resilience-consumer']
): ReturnType<typeof createCompositionPlan> {
  const images = assetIds.map((assetId, index) => ({
    id: `resilience-consumer-${index}`,
    type: 'IMAGE',
    parentId: assetIds.length === 1 ? null : 'resilience-root',
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
        imageHash: assetId
      }
    ]
  })) as SceneNode[]
  const root = {
    id: 'resilience-root',
    type: 'GROUP',
    parentId: null,
    childIds: images.map((image) => image.id),
    visible: true,
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    clipsContent: false,
    rotation: 0,
    isMask: false,
    maskType: 'ALPHA',
    fills: []
  } as SceneNode
  const nodes = assetIds.length === 1 ? images : [root, ...images]
  return createCompositionPlan({
    rootId: nodes[0]?.id ?? root.id,
    getNode: (id: string) => nodes.find((node) => node.id === id)
  })
}

function multiFillImagePlan(): ReturnType<typeof createCompositionPlan> {
  const image = {
    id: 'resilience-multi-fill',
    type: 'IMAGE',
    parentId: null,
    childIds: [],
    visible: true,
    opacity: 1,
    blendMode: 'NORMAL',
    clipsContent: false,
    rotation: 0,
    isMask: false,
    maskType: 'ALPHA',
    fills: ['asset:first', 'asset:second'].map((imageHash) => ({
      type: 'IMAGE',
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash
    }))
  } as SceneNode
  return createCompositionPlan({
    rootId: image.id,
    getNode: (id: string) => (id === image.id ? image : undefined)
  })
}

function resolver(
  dimensions: Readonly<Record<string, readonly [number, number]>> = {
    'asset:resilience-consumer': [SOURCE_DIMENSION, SOURCE_DIMENSION]
  }
): ImageRevisionResolver {
  return {
    getAsset: (assetId) =>
      dimensions[assetId] ? { assetId, revisionId: `sha256:${assetId}` } : undefined,
    getRevision: (revisionId) => {
      const assetId = revisionId.replace(/^sha256:/u, '')
      const size = dimensions[assetId]
      return size
        ? {
            revisionId,
            kind: 'image',
            metadata: { width: size[0], height: size[1] },
            bytes: new Uint8Array([1])
          }
        : undefined
    }
  }
}

test('resilient session exposes ordered progressive stages through the production adapter', async () => {
  const stages: number[] = []
  const session = createImageResilienceSession({
    profile: 'M1',
    firstPaintMaxDimension: 512,
    retry: { sleep: immediateSleep },
    onProgressiveStage: (report) => stages.push(report.stage.plan.renderWidth)
  })
  const report = await session.open(imagePlan(), resolver(), {})

  expect(stages).toEqual([512, 1024, 2048, 4096])
  expect(report.stages.map((stage) => stage.stage.kind)).toEqual([
    'proxy',
    'refine',
    'refine',
    'full'
  ])
  expect(report.stages.every((stage) => stage.frame.textures[0]?.uploaded)).toBe(true)
  expect(report.complete).toBe(true)
  expect(report.finalScale).toBe(1)
  expect(report.sourceAttempts).toBe(1)
})

test('resilient session uses measured pressure and restores full resolution when pressure clears', async () => {
  const decisions: number[] = []
  const session = createImageResilienceSession({
    profile: 'D1',
    retry: { sleep: immediateSleep },
    onResolutionDecision: (report) => decisions.push(report.decision.plan.scale)
  })

  const pressured = await session.render(imagePlan(), resolver(), {
    observedResidentBytes: 240 * 1024 * 1024
  })
  const restored = await session.render(imagePlan(), resolver(), {
    observedResidentBytes: 0
  })

  expect(pressured.decision.downgraded).toBe(true)
  expect(pressured.frame.textures[0]?.tilePlan?.scale).toBe(pressured.decision.plan.scale)
  expect(restored.decision.downgraded).toBe(false)
  expect(restored.decision.plan.scale).toBe(1)
  expect(restored.frame.textures[0]?.tilePlan?.scale).toBe(1)
  expect(restored.fullResolution).toBe(true)
  expect(decisions).toEqual([pressured.decision.plan.scale, 1])
})

test('resilient session bounds retries and reports transient failures', async () => {
  let attempts = 0
  const failures: number[] = []
  const session = createImageResilienceSession({
    profile: 'D1',
    retry: {
      policy: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      sleep: immediateSleep,
      onRetry: (failure) => failures.push(failure.attempt),
      isRetryable: (error) => error instanceof ImageRenderContextLostError
    }
  })
  const resolve = resolver()
  const report = await session.render(
    imagePlan(),
    {
      ...resolve,
      getAsset: (assetId) => {
        attempts += 1
        if (attempts < 3) throw new ImageRenderContextLostError('transient')
        return resolve.getAsset(assetId)
      }
    },
    {
      observedResidentBytes: 0
    }
  )

  expect(report.sourceAttempts).toBe(3)
  expect(report.sourceFailures).toHaveLength(2)
  expect(report.attempts).toBe(1)
  expect(report.failures).toEqual([])
  expect(failures).toEqual([1, 2])
})

test('resilient session rejects overlap and aborts between staged calls', async () => {
  let releaseSleep: (() => void) | undefined
  let attempts = 0
  const session = createImageResilienceSession({
    profile: 'D1',
    retry: {
      policy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
      isRetryable: () => true,
      sleep: () =>
        new Promise<void>((resolve) => {
          releaseSleep = resolve
        })
    }
  })
  const controller = new AbortController()
  const resolve = resolver()
  const opening = session.open(
    imagePlan(),
    {
      ...resolve,
      getAsset: (assetId) => {
        attempts += 1
        if (attempts === 1) throw new ImageRenderContextLostError('retry')
        return resolve.getAsset(assetId)
      }
    },
    {
      signal: controller.signal
    }
  )

  await Promise.resolve()
  await expect(
    session.render(imagePlan(), resolve, {
      observedResidentBytes: 0
    })
  ).rejects.toBeInstanceOf(ImageResilienceSessionBusyError)
  controller.abort()
  releaseSleep?.()
  await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
  expect(session.busy).toBe(false)
})

test('resilient session binds planning to resolved revision metadata', async () => {
  const session = createImageResilienceSession({
    profile: 'M1',
    firstPaintMaxDimension: 512,
    retry: { sleep: immediateSleep }
  })
  const report = await session.open(
    imagePlan(),
    resolver({ 'asset:resilience-consumer': [2048, 1024] }),
    {}
  )

  expect(report.stages.map((stage) => stage.emittedScale)).toEqual([0.25, 0.5, 1])
  expect(report.stages.at(-1)?.frame.textures[0]?.tilePlan).toMatchObject({
    sourceWidth: 2048,
    sourceHeight: 1024,
    renderWidth: 2048,
    renderHeight: 1024
  })
  expect(report.complete).toBe(true)
  expect(report.finalScale).toBe(1)
})

test('resilient session fails loud for invalid resolved revision dimensions', async () => {
  const session = createImageResilienceSession({
    profile: 'D1',
    retry: { sleep: immediateSleep }
  })

  await expect(
    session.open(imagePlan(), resolver({ 'asset:resilience-consumer': [0, SOURCE_DIMENSION] }), {})
  ).rejects.toBeInstanceOf(ImageResilienceSourceError)
})

test('resilient session rejects multiple visible image assets even when dimensions match', async () => {
  const session = createImageResilienceSession({
    profile: 'D1',
    retry: { sleep: immediateSleep }
  })
  const plan = imagePlan(['asset:first', 'asset:second'])

  await expect(
    session.render(
      plan,
      resolver({
        'asset:first': [1024, 1024],
        'asset:second': [1024, 1024]
      }),
      { observedResidentBytes: 0 }
    )
  ).rejects.toThrow('image resilience session requires exactly one visible bound image asset')
})

test('resilient session rejects two image fills on one visible node', async () => {
  const session = createImageResilienceSession({
    profile: 'D1',
    retry: { sleep: immediateSleep }
  })

  await expect(
    session.open(
      multiFillImagePlan(),
      resolver({
        'asset:first': [1024, 1024],
        'asset:second': [1024, 1024]
      }),
      {}
    )
  ).rejects.toThrow('image resilience session requires exactly one visible bound image asset')
})

import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
import {
  createImageRenderAdapter,
  createImageTilePlan,
  ImageRenderContextLostError,
  ImageTextureMemoryBudgetError,
  ImageTilePlanLimitError,
  type ImageRevisionResolver,
} from "#core/canvas/image-editor";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

const LOSS_RESTART_CYCLES = 20;
const SOURCE_DIMENSION = 4096;

function resiliencePlan(assetId = "asset:resilience"): ReturnType<typeof createCompositionPlan> {
  const node = {
    id: "resilience-image",
    type: "IMAGE",
    parentId: null,
    childIds: [],
    visible: true,
    opacity: 1,
    blendMode: "NORMAL",
    clipsContent: false,
    rotation: 0,
    isMask: false,
    maskType: "ALPHA",
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: assetId,
      },
    ],
    // Fixture models only the composition resolver surface.
    // oxlint-disable-next-line open-pencil(no-broad-double-cast)
  } as unknown as SceneNode;
  const graph = {
    rootId: node.id,
    getNode: (id: string) => (id === node.id ? node : undefined),
    // oxlint-disable-next-line open-pencil(no-broad-double-cast)
  } as unknown as SceneGraph;
  return createCompositionPlan(graph);
}

function resilienceResolver(): ImageRevisionResolver {
  return {
    getAsset: (assetId) => ({ assetId, revisionId: REVISION_ID }),
    getRevision: () => ({
      revisionId: REVISION_ID,
      kind: "image",
      metadata: { width: 512, height: 512 },
      bytes: new Uint8Array([4, 5, 6]),
    }),
  };
}

test("RESILIENCE-GAP-112 retries 20 loss/restart cycles with zero silent failures", () => {
  const adapter = createImageRenderAdapter();
  const plan = resiliencePlan();
  const resolve = resilienceResolver();
  const baseline = adapter.render(plan, resolve);
  expect(baseline.gaps).toEqual([]);
  expect(baseline.textures[0]).toMatchObject({ dirty: true, uploaded: true });

  for (let cycle = 1; cycle <= LOSS_RESTART_CYCLES; cycle += 1) {
    adapter.loseContext();
    // Loss must fail loud on every retry, never return a silently empty frame.
    expect(() => adapter.render(plan, resolve)).toThrow(ImageRenderContextLostError);
    adapter.restore();
    expect(adapter.resourceGeneration).toBe(cycle);

    const recreated = adapter.render(plan, resolve);
    expect(recreated.backend).toBe("skia");
    expect(recreated.gaps).toEqual([]);
    expect(recreated.commands).toHaveLength(baseline.commands.length);
    expect(recreated.textures).toHaveLength(baseline.textures.length);
    // Resource recreation: the first frame after restore re-uploads every texture.
    expect(recreated.textures[0]).toMatchObject({ dirty: true, uploaded: true });
    // Warm state stays bounded: the second frame reuses the recreated texture.
    expect(adapter.render(plan, resolve).textures[0]).toMatchObject({
      dirty: false,
      uploaded: false,
    });
  }
});

test("RESILIENCE-GAP-112 opens progressively under a low-memory texture budget", () => {
  const full = createImageTilePlan({
    sourceWidth: SOURCE_DIMENSION,
    sourceHeight: SOURCE_DIMENSION,
  });
  expect(full).toMatchObject({ proxy: false, adaptiveResolution: false, scale: 1 });
  expect(full.textureMemoryBudgetBytes).toBe("UNKNOWN");

  const proxied = createImageTilePlan({
    sourceWidth: SOURCE_DIMENSION,
    sourceHeight: SOURCE_DIMENSION,
    proxyMaxDimension: 1024,
  });
  expect(proxied.proxy).toBe(true);
  expect(proxied.renderWidth).toBeLessThanOrEqual(1024);
  expect(proxied.mipmapLevel).toBeGreaterThan(0);

  const budgeted = createImageTilePlan({
    sourceWidth: SOURCE_DIMENSION,
    sourceHeight: SOURCE_DIMENSION,
    proxyMaxDimension: 1024,
    maxTextureBytes: 256 * 256 * 4,
  });
  expect(budgeted.adaptiveResolution).toBe(true);
  expect(budgeted.estimatedBytes).toBeLessThanOrEqual(256 * 256 * 4);
  expect(budgeted.textureMemoryBudgetBytes).toBe(256 * 256 * 4);
  expect(budgeted.renderWidth).toBeLessThan(proxied.renderWidth);
});

test("RESILIENCE-GAP-112 fails loud when low-memory limits cannot be honoured", () => {
  expect(() =>
    createImageTilePlan({
      sourceWidth: SOURCE_DIMENSION,
      sourceHeight: SOURCE_DIMENSION,
      maxTextureBytes: 3,
    }),
  ).toThrow(ImageTextureMemoryBudgetError);

  expect(() =>
    createImageTilePlan({
      sourceWidth: SOURCE_DIMENSION,
      sourceHeight: SOURCE_DIMENSION,
      tileSize: 64,
      maxTiles: 8,
    }),
  ).toThrow(ImageTilePlanLimitError);
});

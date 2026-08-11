import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
import {
  createImageRenderAdapter,
  ImageRenderContextLostError,
  type ImageRenderAdapter,
  type ImageRevisionResolver,
} from "#core/canvas/image-editor";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

const REVISION_ID = "sha256:proof-gap-138";

function plan(): ReturnType<typeof createCompositionPlan> {
  const node = {
    id: "proof-gap-138",
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
        imageHash: "asset:proof-gap-138",
      },
    ],
  } as unknown as SceneNode;
  return createCompositionPlan({
    rootId: node.id,
    getNode: (id: string) => (id === node.id ? node : undefined),
  } as unknown as SceneGraph);
}

function resolver(): ImageRevisionResolver {
  return {
    getAsset: (assetId) => ({ assetId, revisionId: REVISION_ID }),
    getRevision: () => ({
      revisionId: REVISION_ID,
      kind: "image",
      metadata: { width: 8, height: 8 },
      bytes: new Uint8Array([1, 3, 8]),
    }),
  };
}

function observe(adapter: ImageRenderAdapter) {
  const composition = plan();
  const resolve = resolver();
  const first = adapter.render(composition, resolve).textures[0];
  const warm = adapter.render(composition, resolve).textures[0];
  adapter.markDirty("asset:proof-gap-138");
  const dirty = adapter.render(composition, resolve).textures[0];
  const generation = adapter.resourceGeneration;
  adapter.loseContext();
  let lossRejected = false;
  try {
    adapter.render(composition, resolve);
  } catch (error) {
    lossRejected = error instanceof ImageRenderContextLostError;
  }
  adapter.restore();
  const restored = adapter.render(composition, resolve).textures[0];
  return {
    status:
      first?.uploaded === true &&
      warm?.uploaded === false &&
      dirty?.uploaded === true &&
      lossRejected &&
      adapter.resourceGeneration === generation + 1 &&
      restored?.uploaded === true
        ? "PASS"
        : "FAIL",
    scenarioCount: 5,
    outputCount: [first, warm, dirty, restored].filter(Boolean).length,
  };
}

function ignoreDirtyAdapter(): ImageRenderAdapter {
  const real = createImageRenderAdapter();
  return { ...real, markDirty() {} };
}

function restoreWithoutRecreationAdapter(): ImageRenderAdapter {
  const real = createImageRenderAdapter();
  return {
    ...real,
    get resourceGeneration() {
      return 0;
    },
    restore() {
      real.restore();
    },
  };
}

test("PROOF-GAP-138 proves texture reupload and resource recreation", () => {
  expect(observe(createImageRenderAdapter())).toEqual({
    status: "PASS",
    scenarioCount: 5,
    outputCount: 4,
  });
});

test("PROOF-GAP-138 seeded defects fail for skipped dirtiness and recreation", () => {
  expect(observe(ignoreDirtyAdapter()).status).toBe("FAIL");
  expect(observe(restoreWithoutRecreationAdapter()).status).toBe("FAIL");
});

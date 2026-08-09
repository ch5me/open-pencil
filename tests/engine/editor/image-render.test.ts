import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
import {
  createImageRenderAdapter,
  createRendererResilienceContract,
  RendererResilienceContractError,
  UnsupportedImageBackendError,
  validateRendererResilienceContract,
} from "#core/canvas/image-editor";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

function imagePlan(): ReturnType<typeof createCompositionPlan> {
  const node = {
    id: "image",
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
        imageHash: "asset:hero",
      },
    ],
  } as unknown as SceneNode;
  const graph = {
    rootId: node.id,
    getNode: (id: string) => (id === node.id ? node : undefined),
  } as unknown as SceneGraph;
  return createCompositionPlan(graph);
}

test("image render adapter rejects unsupported backends and restores texture state", () => {
  expect(() => createImageRenderAdapter({ backend: "webgpu" })).toThrow(
    UnsupportedImageBackendError,
  );
  const adapter = createImageRenderAdapter();
  adapter.markDirty("asset:image");
  adapter.restore();
  expect(adapter.backend).toBe("skia");
});

test("image render adapter resolves the first bound image asset", () => {
  const adapter = createImageRenderAdapter();
  const frame = adapter.render(imagePlan(), {
    getAsset: (assetId) =>
      assetId === "asset:hero" ? { assetId, revisionId: "content:revision-1" } : undefined,
    getRevision: (revisionId) =>
      revisionId === "content:revision-1"
        ? {
            revisionId,
            kind: "image",
            metadata: {},
            bytes: new Uint8Array([1, 2, 3]),
          }
        : undefined,
  });
  expect(frame.commands[0]?.assetId).toBe("asset:hero");
  expect(frame.textures[0]?.revisionId).toBe("content:revision-1");
  expect(frame.textures[0]?.uploaded).toBe(true);
});

test("renderer-resilience-v1 records unsupported runtime paths as UNKNOWN", () => {
  const contract = createRendererResilienceContract({
    contextRestoration: "SUPPORTED",
    resourceRecreation: "SUPPORTED",
    cancellation: "UNSUPPORTED",
  });
  expect(() => validateRendererResilienceContract(contract)).not.toThrow();
  expect(contract.lowMemoryProgressiveOpen).toBe("UNKNOWN");
  expect(contract.readbackTimeout).toBe("UNKNOWN");
  expect(() =>
    validateRendererResilienceContract({
      ...contract,
      version: "wrong",
    }),
  ).toThrow(RendererResilienceContractError);
});

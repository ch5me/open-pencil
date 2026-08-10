import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
import {
  createImageRenderAdapter,
  createRendererResilienceContract,
  RendererResilienceContractError,
  UnsupportedImageBackendError,
  validateRendererResilienceContract,
  type ImageRevisionResolver,
} from "#core/canvas/image-editor";
import type { AssetRevision } from "#core/editor/assets";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

function imageNode(id: string, assetId = "asset:hero", visible = true): SceneNode {
  return {
    id,
    type: "IMAGE",
    parentId: null,
    childIds: [],
    visible,
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
    // Test fixture intentionally models only composition fields.
  // oxlint-disable-next-line open-pencil(no-broad-double-cast)
  } as unknown as SceneNode;
}

function imagePlan(nodes = [imageNode("image")]): ReturnType<typeof createCompositionPlan> {
  const graph = {
    rootId: nodes[0]?.id ?? "image",
    getNode: (id: string) => nodes.find((node) => node.id === id),
    // Test graph intentionally implements only the composition resolver surface.
  // oxlint-disable-next-line open-pencil(no-broad-double-cast)
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
      assetId === "asset:hero" ? { assetId, revisionId: "sha256:revision-1" } : undefined,
    getRevision: (revisionId) =>
      revisionId === "sha256:revision-1"
        ? ({
            revisionId,
            kind: "image",
            metadata: {},
            bytes: new Uint8Array([1, 2, 3]),
          } satisfies AssetRevision)
        : undefined,
  });
  expect(frame.commands[0]?.assetId).toBe("asset:hero");
  expect(frame.commands[0]).toMatchObject({
    rotation: 0,
    maskType: null,
    maskIsOutline: false,
    adjustmentHooks: [],
  });
  expect(frame.textures[0]?.revisionId).toBe("sha256:revision-1");
  expect(frame.textures[0]?.uploaded).toBe(true);
});

test("image render adapter emits clipped raster bases from composition groups", () => {
  const group = {
    ...imageNode("group"),
    type: "GROUP",
    childIds: ["raster"],
    clipsContent: true,
    blendMode: "PASS_THROUGH",
    fills: [],
  };
  const raster = {
    ...imageNode("raster", "asset:raster-base"),
    parentId: "group",
  };
  const graph = {
    rootId: group.id,
    getNode: (id: string) => (id === group.id ? group : id === raster.id ? raster : undefined),
  } as unknown as SceneGraph;
  const plan = createCompositionPlan(graph, "group", {
    adjustmentHooks: ["exposure"],
  });
  const frame = createImageRenderAdapter().render(plan, {
    getAsset: (assetId) =>
      assetId === "asset:raster-base"
        ? { assetId, revisionId: "sha256:raster-revision" }
        : undefined,
    getRevision: (revisionId) =>
      revisionId === "sha256:raster-revision"
        ? {
            revisionId,
            kind: "image",
            metadata: {},
            bytes: new Uint8Array([1, 2, 3, 4]),
          }
        : undefined,
  });

  expect(frame.commands).toEqual([
    {
      nodeId: "group",
      assetId: null,
      opacity: 1,
      blendMode: "PASS_THROUGH",
      clipped: true,
      rotation: 0,
      maskType: null,
      maskIsOutline: false,
      adjustmentHooks: ["exposure"],
    },
    {
      nodeId: "raster",
      assetId: "asset:raster-base",
      opacity: 1,
      blendMode: "NORMAL",
      clipped: false,
      rotation: 0,
      maskType: null,
      maskIsOutline: false,
      adjustmentHooks: ["exposure"],
    },
  ]);
  expect(frame.textures).toEqual([
    {
      assetId: "asset:raster-base",
      revisionId: "sha256:raster-revision",
      byteLength: 4,
      dirty: false,
      uploaded: true,
    },
  ]);
});

test("image render adapter caches textures, deduplicates shared assets, and reuploads revisions", () => {
  const adapter = createImageRenderAdapter();
  let revisionId: AssetRevision["revisionId"] = "sha256:revision-1";
  const resolve: ImageRevisionResolver = {
    getAsset: (assetId: string) => (assetId === "asset:hero" ? { assetId, revisionId } : undefined),
    getRevision: (id: string) =>
      id === revisionId
        ? { revisionId: id, kind: "image", metadata: {}, bytes: new Uint8Array([1, 2, 3]) }
        : undefined,
  };

  const plan = imagePlan([imageNode("image-a"), imageNode("image-b")]);
  expect(adapter.render(plan, resolve).textures).toHaveLength(1);
  expect(adapter.render(plan, resolve).textures[0]?.uploaded).toBe(true);
  expect(adapter.render(plan, resolve).textures[0]?.uploaded).toBe(false);

  revisionId = "sha256:revision-2";
  const next = adapter.render(plan, resolve);
  expect(next.textures).toHaveLength(1);
  expect(next.textures[0]).toMatchObject({ revisionId, uploaded: true });

  adapter.markDirty("asset:hero");
  expect(adapter.render(plan, resolve).textures[0]?.uploaded).toBe(true);
  expect(adapter.render(plan, resolve).textures[0]?.uploaded).toBe(false);
  adapter.restore();
  expect(adapter.render(plan, resolve).textures[0]?.uploaded).toBe(true);
});

test("image render adapter uploads only assets invalidated by their revision or dirty mark", () => {
  const adapter = createImageRenderAdapter();
  const revisions = new Map<string, AssetRevision>([
    [
      "sha256:hero-1",
      { revisionId: "sha256:hero-1", kind: "image", metadata: {}, bytes: new Uint8Array([1]) },
    ],
    [
      "sha256:mask-1",
      { revisionId: "sha256:mask-1", kind: "image", metadata: {}, bytes: new Uint8Array([2]) },
    ],
  ]);
  const bindings = new Map([
    ["asset:hero", "sha256:hero-1"],
    ["asset:mask", "sha256:mask-1"],
  ]);
  const resolve: ImageRevisionResolver = {
    getAsset: (assetId) => {
      const revisionId = bindings.get(assetId);
      return revisionId ? { assetId, revisionId } : undefined;
    },
    getRevision: (revisionId) => revisions.get(revisionId),
  };
  const plan = imagePlan([imageNode("hero", "asset:hero"), imageNode("mask", "asset:mask")]);

  expect(adapter.render(plan, resolve).textures.map((texture) => texture.uploaded)).toEqual([
    true,
    true,
  ]);
  expect(adapter.render(plan, resolve).textures.map((texture) => texture.uploaded)).toEqual([
    false,
    false,
  ]);

  adapter.markDirty("asset:mask");
  expect(adapter.render(plan, resolve).textures.map((texture) => texture.uploaded)).toEqual([
    false,
    true,
  ]);
});

test("image render adapter emits commands for visible nodes but skips hidden or unresolved textures", () => {
  const adapter = createImageRenderAdapter();
  const plan = imagePlan([imageNode("visible"), imageNode("hidden", "asset:hidden", false)]);
  const frame = adapter.render(plan, {
    getAsset: (assetId) =>
      assetId === "asset:hero" ? { assetId, revisionId: "sha256:revision-1" } : undefined,
    getRevision: () => undefined,
  });

  expect(frame.commands.map((command) => command.nodeId)).toEqual(["visible"]);
  expect(frame.textures).toEqual([]);
  expect(frame.gaps).toEqual([
    {
      code: "missing-asset-revision",
      message: "asset revision is unavailable: sha256:revision-1",
      assetId: "asset:hero",
    },
  ]);
});

test("image render adapter exposes typed gaps for missing and mismatched bindings", () => {
  const missing = createImageRenderAdapter().render(imagePlan([imageNode("missing", "asset:missing")]), {
    getAsset: (assetId) =>
      assetId === "asset:mismatch"
        ? { assetId: "asset:other", revisionId: "sha256:revision-1" }
        : undefined,
    getRevision: () => undefined,
  });
  const mismatch = createImageRenderAdapter().render(imagePlan([imageNode("mismatch", "asset:mismatch")]), {
    getAsset: () => ({ assetId: "asset:other", revisionId: "sha256:revision-1" }),
    getRevision: () => undefined,
  });

  expect(missing.gaps).toEqual([
    {
      code: "missing-asset-binding",
      message: "asset binding is unavailable: asset:missing",
      assetId: "asset:missing",
    },
  ]);
  expect(mismatch.gaps).toEqual([
    {
      code: "asset-binding-mismatch",
      message: "asset binding does not match requested asset: asset:mismatch",
      assetId: "asset:mismatch",
    },
  ]);
  expect(missing.textures).toEqual([]);
  expect(mismatch.textures).toEqual([]);
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
    validateRendererResilienceContract(Object.assign({}, contract, { version: "wrong" })),
  ).toThrow(RendererResilienceContractError);
});

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

function multiImagePlan(nodes: SceneNode[]): ReturnType<typeof createCompositionPlan> {
  const root = {
    ...imageNode("root"),
    type: "GROUP",
    childIds: nodes.map((node) => node.id),
    fills: [],
  };
  const children = nodes.map((node) => ({ ...node, parentId: root.id }));
  const graph = {
    rootId: root.id,
    getNode: (id: string) => (id === root.id ? root : children.find((node) => node.id === id)),
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
  expect(frame.textures[0]).toMatchObject({ dirty: true, uploaded: true });
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
      dirty: true,
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
  const first = adapter.render(plan, resolve);
  expect(first.textures).toHaveLength(1);
  expect(first.textures[0]).toMatchObject({
    dirty: true,
    uploaded: true,
  });
  expect(adapter.render(plan, resolve).textures[0]).toMatchObject({
    dirty: false,
    uploaded: false,
  });

  revisionId = "sha256:revision-2";
  const next = adapter.render(plan, resolve);
  expect(next.textures).toHaveLength(1);
  expect(next.textures[0]).toMatchObject({ revisionId, dirty: true, uploaded: true });

  adapter.markDirty("asset:hero");
  expect(adapter.render(plan, resolve).textures[0]).toMatchObject({
    dirty: true,
    uploaded: true,
  });
  expect(adapter.render(plan, resolve).textures[0]).toMatchObject({
    dirty: false,
    uploaded: false,
  });
  adapter.restore();
  expect(adapter.render(plan, resolve).textures[0]).toMatchObject({
    dirty: true,
    uploaded: true,
  });
});

test("image render adapter rejects a revision returned under the wrong id", () => {
  const frame = createImageRenderAdapter().render(imagePlan(), {
    getAsset: (assetId) =>
      assetId === "asset:hero" ? { assetId, revisionId: "sha256:requested" } : undefined,
    getRevision: () => ({
      revisionId: "sha256:wrong",
      kind: "image",
      metadata: {},
      bytes: new Uint8Array([1, 2, 3]),
    }),
  });

  expect(frame.textures).toEqual([]);
  expect(frame.gaps).toEqual([
    {
      code: "asset-revision-mismatch",
      message: "asset revision does not match requested revision: sha256:requested",
      assetId: "asset:hero",
    },
  ]);
});

test("image render adapter uploads only textures affected by source or mask dirtiness", () => {
  const adapter = createImageRenderAdapter();
  const group = {
    ...imageNode("group"),
    type: "GROUP",
    childIds: ["source", "mask"],
    fills: [],
  };
  const source = { ...imageNode("source", "asset:source"), parentId: "group" };
  const mask = { ...imageNode("mask", "asset:mask"), parentId: "group", isMask: true };
  const plan = createCompositionPlan(
    {
      rootId: "group",
      getNode: (id: string) =>
        id === "group" ? group : id === "source" ? source : id === "mask" ? mask : undefined,
    } as unknown as SceneGraph,
    "group",
  );
  const resolve: ImageRevisionResolver = {
    getAsset: (assetId) => ({ assetId, revisionId: `sha256:${assetId}` }),
    getRevision: (revisionId) => ({
      revisionId,
      kind: "image",
      metadata: {},
      bytes: new Uint8Array([1, 2, 3]),
    }),
  };

  adapter.render(plan, resolve);
  const unchanged = adapter.render(plan, resolve);
  expect(unchanged.textures).toEqual([
    {
      assetId: "asset:source",
      revisionId: "sha256:asset:source",
      byteLength: 3,
      dirty: false,
      uploaded: false,
    },
    {
      assetId: "asset:mask",
      revisionId: "sha256:asset:mask",
      byteLength: 3,
      dirty: false,
      uploaded: false,
    },
  ]);

  adapter.markDirty("asset:mask");
  const maskChanged = adapter.render(plan, resolve);
  expect(maskChanged.textures).toEqual([
    {
      assetId: "asset:source",
      revisionId: "sha256:asset:source",
      byteLength: 3,
      dirty: false,
      uploaded: false,
    },
    {
      assetId: "asset:mask",
      revisionId: "sha256:asset:mask",
      byteLength: 3,
      dirty: true,
      uploaded: true,
    },
  ]);

  adapter.markDirty("asset:source");
  const sourceChanged = adapter.render(plan, resolve);
  expect(sourceChanged.textures[0]).toMatchObject({
    assetId: "asset:source",
    dirty: true,
    uploaded: true,
  });
  expect(sourceChanged.textures[1]).toMatchObject({
    assetId: "asset:mask",
    dirty: false,
    uploaded: false,
  });
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
  const plan = multiImagePlan([imageNode("hero", "asset:hero"), imageNode("mask", "asset:mask")]);

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

test("image render adapter emits typed partial updates and unions repeated dirty rectangles", () => {
  const adapter = createImageRenderAdapter();
  const plan = imagePlan();
  const resolve: ImageRevisionResolver = {
    getAsset: (assetId) => ({ assetId, revisionId: "sha256:hero" }),
    getRevision: (revisionId) => ({
      revisionId,
      kind: "image",
      metadata: {},
      bytes: new Uint8Array([1, 2, 3]),
    }),
  };

  adapter.render(plan, resolve);
  adapter.markDirty("asset:hero", { x: 2, y: 3, width: 4, height: 5 });
  adapter.markDirty("asset:hero", { x: 0, y: 5, width: 3, height: 2 });

  expect(adapter.render(plan, resolve).textures[0]).toMatchObject({
    dirty: true,
    uploaded: true,
    update: {
      kind: "partial",
      dirtyRect: { x: 0, y: 3, width: 6, height: 5 },
    },
  });
  expect(adapter.render(plan, resolve).textures[0]).not.toHaveProperty("update");
});

test("image render adapter rejects invalid partial update rectangles", () => {
  const adapter = createImageRenderAdapter();
  expect(() => adapter.markDirty("asset:hero", { x: 0, y: 0, width: -1, height: 2 })).toThrow(
    "invalid image texture dirty rectangle",
  );
});

test("image render adapter tracks revisions independently and reports zero unchanged uploads", () => {
  const adapter = createImageRenderAdapter();
  const revisions = new Map<string, AssetRevision>([
    ["sha256:hero-1", { revisionId: "sha256:hero-1", kind: "image", metadata: {}, bytes: new Uint8Array([1]) }],
    ["sha256:hero-2", { revisionId: "sha256:hero-2", kind: "image", metadata: {}, bytes: new Uint8Array([2]) }],
    ["sha256:mask-1", { revisionId: "sha256:mask-1", kind: "image", metadata: {}, bytes: new Uint8Array([3]) }],
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
  const plan = multiImagePlan([imageNode("hero", "asset:hero"), imageNode("mask", "asset:mask")]);

  expect(adapter.render(plan, resolve).textures.map((texture) => texture.uploaded)).toEqual([
    true,
    true,
  ]);
  expect(adapter.render(plan, resolve).textures.map((texture) => texture.uploaded)).toEqual([
    false,
    false,
  ]);

  bindings.set("asset:hero", "sha256:hero-2");
  expect(adapter.render(plan, resolve).textures.map((texture) => texture.uploaded)).toEqual([
    true,
    false,
  ]);

  bindings.set("asset:hero", "sha256:hero-1");
  expect(adapter.render(plan, resolve).textures.map((texture) => texture.uploaded)).toEqual([
    true,
    false,
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

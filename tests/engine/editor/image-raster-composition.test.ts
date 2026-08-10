import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
import { assertPixelParity } from "#core/color/composition";
import {
  composeRaster,
  composeRasterRGBA8,
  createRasterCanvasPool,
  createRasterGroupCache,
  RasterBackendUnavailableError,
  RASTER_RGBA8_PARITY,
  type RasterCompositionAssetResolver,
} from "#core/canvas/image-editor";
import type { AssetRevision } from "#core/editor/assets";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

test("canvas pool stays cold until a measured allocation miss", () => {
  const pool = createRasterCanvasPool(10);
  expect(pool.acquire(1, 1)).toBeUndefined();
  const canvas = { pixels: new Uint8Array(4), present: new Uint8Array(1) };
  pool.recordMiss(1, 1, 9, canvas);
  expect(pool.acquire(1, 1)).toBeUndefined();
  pool.recordMiss(1, 1, 10, canvas);
  expect(pool.acquire(1, 1)).toBe(canvas);
  pool.release(1, 1, canvas);
  expect(pool.acquire(1, 1)).toBe(canvas);
  pool.clear();
  expect(pool.acquire(1, 1)).toBeUndefined();
});

test("canvas pool keeps composed output fresh across combined mask passes", () => {
  const image = node({
    id: "image",
    type: "IMAGE",
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:pooled",
      },
    ],
  });
  const plan = planFor([image], image.id);
  const red = {
    revisionId: "sha256:pooled-red",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([255, 0, 0, 255]),
  } satisfies AssetRevision;
  const blue = {
    revisionId: "sha256:pooled-blue",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([0, 0, 255, 255]),
  } satisfies AssetRevision;
  let revision: AssetRevision = red;
  const pool = createRasterCanvasPool(0);
  const first = composeRasterRGBA8(plan, {
    getAsset: (assetId) => ({ assetId, revisionId: revision.revisionId }),
    getRevision: () => revision,
  }, { width: 1, height: 1, canvasPool: pool });
  revision = blue;
  const second = composeRasterRGBA8(plan, {
    getAsset: (assetId) => ({ assetId, revisionId: revision.revisionId }),
    getRevision: () => revision,
  }, { width: 1, height: 1, canvasPool: pool });
  expect([...first.pixels]).toEqual([255, 0, 0, 255]);
  expect([...second.pixels]).toEqual([0, 0, 255, 255]);
});

test("group CPU cache stays cold until a measured threshold miss", () => {
  const cache = createRasterGroupCache(10);
  const value = { pixels: new Uint8Array([1, 2, 3, 4]), present: new Uint8Array([1]) };
  cache.recordMiss("fast", 9, value);
  expect(cache.get("fast")).toBeUndefined();
  cache.recordMiss("slow", 10, value);
  expect([...cache.get("slow")?.pixels ?? []]).toEqual([1, 2, 3, 4]);
  cache.clear();
  expect(cache.get("slow")).toBeUndefined();
});

test("group CPU cache ignores unrelated siblings in the raster signature", () => {
  const group = node({ id: "group", type: "GROUP", childIds: ["image", "noise"] });
  const image = node({
    id: "image",
    type: "IMAGE",
    parentId: "group",
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:cached",
      },
    ],
  });
  const noise = node({ id: "noise", type: "RECTANGLE", parentId: "group" });
  const extraNoise = node({ id: "noise-2", type: "RECTANGLE", parentId: "group" });
  const revision = {
    revisionId: "sha256:cached",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([255, 0, 0, 255]),
  } satisfies AssetRevision;
  const makePlan = (includeExtraNoise: boolean) => {
    const nodes = includeExtraNoise
      ? [group, image, noise, extraNoise]
      : [group, image, noise];
    const byId = new Map(nodes.map((entry) => [entry.id, entry]));
    const root = {
      ...group,
      childIds: includeExtraNoise ? ["image", "noise", "noise-2"] : group.childIds,
    };
    byId.set(root.id, root);
    return createCompositionPlan(
      { rootId: root.id, getNode: (id: string) => byId.get(id) } as unknown as SceneGraph,
      root.id,
      { adjustmentHooks: ["exposure"] },
    );
  };
  let adjustmentCalls = 0;
  const adjustments = {
    exposure: (pixel: readonly [number, number, number, number]) => {
      adjustmentCalls += 1;
      return pixel;
    },
  };
  const cache = createRasterGroupCache(0);
  const options = {
    width: 1,
    height: 1,
    adjustments,
    adjustmentSignature: "stable",
    groupCache: cache,
    now: () => 100,
  };
  composeRasterRGBA8(makePlan(false), resolver(revision), options);
  composeRasterRGBA8(makePlan(true), resolver(revision), options);
  expect(adjustmentCalls).toBe(1);
});

test("group CPU cache matches uncached pixels and honors adjustment revisions", () => {
  const image = node({
    id: "image",
    type: "IMAGE",
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:revisioned",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:revisioned",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([255, 0, 0, 255]),
  } satisfies AssetRevision;
  const plan = createCompositionPlan(
    { rootId: image.id, getNode: () => image } as unknown as SceneGraph,
    image.id,
    { adjustmentHooks: ["exposure"] },
  );
  const uncached = composeRasterRGBA8(plan, resolver(revision), {
    width: 1,
    height: 1,
    adjustments: { exposure: (pixel) => [pixel[0], 64, pixel[2], pixel[3]] },
  });
  let adjustmentCalls = 0;
  let green = 64;
  const exposure = (pixel: readonly [number, number, number, number]) => {
    adjustmentCalls += 1;
    return [pixel[0], green, pixel[2], pixel[3]] as const;
  };
  const cache = createRasterGroupCache(0);
  const first = composeRasterRGBA8(plan, resolver(revision), {
    width: 1,
    height: 1,
    groupCache: cache,
    now: () => 100,
    adjustmentSignature: "revision-a",
    adjustments: { exposure },
  });
  const cached = composeRasterRGBA8(plan, resolver(revision), {
    width: 1,
    height: 1,
    groupCache: cache,
    now: () => 100,
    adjustmentSignature: "revision-a",
    adjustments: { exposure },
  });
  green = 192;
  const revised = composeRasterRGBA8(plan, resolver(revision), {
    width: 1,
    height: 1,
    groupCache: cache,
    now: () => 100,
    adjustmentSignature: "revision-b",
    adjustments: { exposure },
  });
  expect([...first.pixels]).toEqual([...uncached.pixels]);
  expect([...cached.pixels]).toEqual([...first.pixels]);
  expect([...revised.pixels]).toEqual([255, 192, 0, 255]);
  expect(adjustmentCalls).toBe(2);
});

test("group CPU cache bypasses opaque adjustments without a revision", () => {
  const image = node({
    id: "image",
    type: "IMAGE",
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:opaque-adjustment",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:opaque-adjustment",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([255, 0, 0, 255]),
  } satisfies AssetRevision;
  const plan = createCompositionPlan(
    { rootId: image.id, getNode: () => image } as unknown as SceneGraph,
    image.id,
    { adjustmentHooks: ["exposure"] },
  );
  let calls = 0;
  const exposure = (pixel: readonly [number, number, number, number]) => {
    calls += 1;
    return pixel;
  };
  const options = {
    width: 1,
    height: 1,
    groupCache: createRasterGroupCache(0),
    now: () => 100,
    adjustments: { exposure },
  };
  composeRasterRGBA8(plan, resolver(revision), options);
  composeRasterRGBA8(plan, resolver(revision), options);
  expect(calls).toBe(2);
});

test("group CPU cache invalidates replacement adjustment callbacks", () => {
  const image = node({
    id: "image",
    type: "IMAGE",
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:replacement-adjustment",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:replacement-adjustment",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([255, 0, 0, 255]),
  } satisfies AssetRevision;
  const plan = createCompositionPlan(
    { rootId: image.id, getNode: () => image } as unknown as SceneGraph,
    image.id,
    { adjustmentHooks: ["exposure"] },
  );
  const cache = createRasterGroupCache(0);
  composeRasterRGBA8(plan, resolver(revision), {
    width: 1,
    height: 1,
    groupCache: cache,
    now: () => 100,
    adjustmentSignature: "stable-state",
    adjustments: { exposure: (pixel) => [pixel[0], 64, pixel[2], pixel[3]] },
  });
  const replaced = composeRasterRGBA8(plan, resolver(revision), {
    width: 1,
    height: 1,
    groupCache: cache,
    now: () => 100,
    adjustmentSignature: "stable-state",
    adjustments: { exposure: (pixel) => [pixel[0], 192, pixel[2], pixel[3]] },
  });
  expect([...replaced.pixels]).toEqual([255, 192, 0, 255]);
});

test("group CPU cache invalidates when an ancestor mask changes geometry", () => {
  const group = node({ id: "group", type: "GROUP", childIds: ["mask", "image"] });
  const mask = node({
    id: "mask",
    type: "RECTANGLE",
    parentId: group.id,
    isMask: true,
    width: 1,
    height: 1,
  });
  const image = node({
    id: "image",
    type: "IMAGE",
    parentId: group.id,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:masked-cache",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:masked-cache",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([255, 0, 0, 255]),
  } satisfies AssetRevision;
  const makePlan = (maskWidth: number) => {
    const nextMask = { ...mask, width: maskWidth };
    const byId = new Map([
      [group.id, group],
      [nextMask.id, nextMask],
      [image.id, image],
    ]);
    return createCompositionPlan(
      { rootId: group.id, getNode: (id: string) => byId.get(id) } as unknown as SceneGraph,
      group.id,
      { adjustmentHooks: ["exposure"] },
    );
  };
  let adjustmentCalls = 0;
  const cache = createRasterGroupCache(0);
  const options = {
    width: 1,
    height: 1,
    groupCache: cache,
    now: () => 100,
    adjustmentSignature: "stable",
    adjustments: {
      exposure: (pixel: readonly [number, number, number, number]) => {
        adjustmentCalls += 1;
        return pixel;
      },
    },
  };
  composeRasterRGBA8(makePlan(1), resolver(revision), options);
  composeRasterRGBA8(makePlan(2), resolver(revision), options);
  expect(adjustmentCalls).toBe(2);
});

test("group CPU cache ignores unrelated sibling effect stacks", () => {
  const group = node({ id: "group", type: "GROUP", childIds: ["image", "other"] });
  const image = node({
    id: "image",
    type: "IMAGE",
    parentId: group.id,
    width: 4,
    fills: [{
      type: "IMAGE",
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: "asset:unrelated-stack",
    }],
  });
  const other = node({ id: "other", type: "RECTANGLE", parentId: group.id });
  const plan = planFor([group, image, other], group.id, { adjustmentHooks: ["exposure"] });
  const revision = {
    revisionId: "sha256:unrelated-stack",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 4, height: 1 },
    bytes: new Uint8Array([
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
    ]),
  } satisfies AssetRevision;
  let calls = 0;
  const exposure = (pixel: readonly [number, number, number, number]) => {
    calls += 1;
    return pixel;
  };
  const cache = createRasterGroupCache(0);
  const compose = (amount: number) =>
    composeRasterRGBA8(plan, resolver(revision), {
      width: 4,
      height: 1,
      groupCache: cache,
      now: () => 100,
      adjustmentSignature: "stable",
      adjustments: { exposure },
      effectStacks: [{
        layerId: other.id,
        adjustmentScope: "layer",
        smart: true,
        effectMaskIds: [],
        filters: [{
          id: "effect:unrelated",
          kind: "exposure",
          enabled: true,
          affectedArea: [0, 0, 1, 1],
          transactionId: "tx:unrelated",
          adjustments: { exposure: amount },
        }],
      }],
    });
  compose(1);
  compose(2);
  expect(calls).toBe(4);
});

test("group CPU cache invalidates when an effect mask changes geometry", () => {
  const group = node({ id: "group", type: "GROUP", childIds: ["image", "mask"] });
  const image = node({
    id: "image",
    type: "IMAGE",
    parentId: group.id,
    width: 4,
    fills: [{
      type: "IMAGE",
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: "asset:effect-mask-cache",
    }],
  });
  const mask = node({
    id: "mask",
    type: "RECTANGLE",
    parentId: group.id,
    isMask: true,
  });
  const revision = {
    revisionId: "sha256:effect-mask-cache",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 4, height: 1 },
    bytes: new Uint8Array([
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
    ]),
  } satisfies AssetRevision;
  const makePlan = (maskWidth: number) =>
    planFor([group, image, { ...mask, width: maskWidth }], group.id, {
      adjustmentHooks: ["exposure"],
    });
  let calls = 0;
  const exposure = (pixel: readonly [number, number, number, number]) => {
    calls += 1;
    return pixel;
  };
  const cache = createRasterGroupCache(0);
  const options = {
    width: 4,
    height: 1,
    groupCache: cache,
    now: () => 100,
    adjustmentSignature: "stable",
    adjustments: { exposure },
    effectStacks: [{
      layerId: image.id,
      adjustmentScope: "layer" as const,
      smart: true,
      effectMaskIds: [mask.id],
      filters: [{
        id: "effect:masked",
        kind: "exposure" as const,
        enabled: true,
        affectedArea: [0, 0, 1, 1] as const,
        transactionId: "tx:masked",
        adjustments: { exposure: 1 },
      }],
    }],
  };
  composeRasterRGBA8(makePlan(1), resolver(revision), options);
  composeRasterRGBA8(makePlan(2), resolver(revision), options);
  expect(calls).toBe(8);
});

function node(overrides: Partial<SceneNode> & Pick<SceneNode, "id" | "type">): SceneNode {
  return {
    id: overrides.id,
    type: overrides.type,
    name: overrides.name ?? overrides.id,
    parentId: overrides.parentId ?? null,
    childIds: overrides.childIds ?? [],
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    width: overrides.width ?? 1,
    height: overrides.height ?? 1,
    rotation: overrides.rotation ?? 0,
    visible: overrides.visible ?? true,
    opacity: overrides.opacity ?? 1,
    clipsContent: overrides.clipsContent ?? false,
    blendMode: overrides.blendMode ?? "NORMAL",
    isMask: overrides.isMask ?? false,
    maskType: overrides.maskType ?? "ALPHA",
    maskIsOutline: overrides.maskIsOutline ?? false,
    fills: overrides.fills ?? [],
  } as SceneNode;
}

test("RGBA8 compositor rejects non-Canvas2D backend claims", () => {
  expect(() =>
    composeRasterRGBA8(
      planFor([node({ id: "image", type: "IMAGE" })], "image"),
      { getAsset: () => undefined, getRevision: () => undefined },
      { width: 1, height: 1, backend: "webgpu" },
    ),
  ).toThrow(RasterBackendUnavailableError);
});

function resolver(revision: AssetRevision): RasterCompositionAssetResolver {
  return {
    getAsset: (assetId) => ({ assetId, revisionId: revision.revisionId }),
    getRevision: () => revision,
  };
}

function planFor(
  nodes: SceneNode[],
  rootId: string,
  options?: Parameters<typeof createCompositionPlan>[2],
) {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  return createCompositionPlan(
    {
      rootId,
      getNode: (id: string) => byId.get(id),
    } as unknown as SceneGraph,
    rootId,
    options,
  );
}

test("RGBA8 composition consumes pixels with ancestor clipping and adjustment hooks", () => {
  const group = node({
    id: "group",
    type: "GROUP",
    width: 1,
    height: 2,
    childIds: ["image"],
    clipsContent: true,
  });
  const image = node({
    id: "image",
    type: "IMAGE",
    parentId: "group",
    width: 2,
    height: 2,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:hero",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:hero",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 2, height: 2 },
    bytes: new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ]),
  } satisfies AssetRevision;
  const result = composeRasterRGBA8(
    createCompositionPlan(
      {
        rootId: group.id,
        getNode: (id: string) => new Map([group, image].map((entry) => [entry.id, entry])).get(id),
      } as unknown as SceneGraph,
      group.id,
      { adjustmentHooks: ["exposure"] },
    ),
    resolver(revision),
    {
    width: 2,
    height: 2,
    adjustments: {
      exposure: (pixel) => [pixel[0], pixel[1], pixel[2], 128],
      },
    },
  );
  expect(result.status).toBe("SUPPORTED");
  expect([...result.pixels]).toEqual([
    255, 0, 0, 128, 0, 0, 0, 0,
    0, 0, 255, 128, 0, 0, 0, 0,
  ]);
});

test("composition-full-v1 inherits visibility and opacity through nested clipping groups", () => {
  const hiddenClip = node({
    id: "hidden-clip",
    type: "GROUP",
    visible: false,
    clipsContent: true,
    childIds: ["hidden-image"],
  });
  const hiddenImage = node({
    id: "hidden-image",
    type: "IMAGE",
    parentId: hiddenClip.id,
    width: 1,
    height: 1,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:hidden",
      },
    ],
  });
  const visibleClip = node({
    id: "visible-clip",
    type: "GROUP",
    opacity: 0.5,
    clipsContent: true,
    childIds: ["nested-group"],
  });
  const nestedGroup = node({
    id: "nested-group",
    type: "GROUP",
    parentId: visibleClip.id,
    opacity: 0.5,
    childIds: ["nested-image"],
  });
  const nestedImage = node({
    id: "nested-image",
    type: "IMAGE",
    parentId: nestedGroup.id,
    opacity: 0.5,
    width: 2,
    height: 1,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:nested",
      },
    ],
  });
  const nodes = [visibleClip, nestedGroup, nestedImage];
  const graph = {
    rootId: visibleClip.id,
    getNode: (id: string) => [...nodes, hiddenClip, hiddenImage].find((entry) => entry.id === id),
  } as unknown as SceneGraph;
  const revision = (assetId: string): AssetRevision => ({
    revisionId: `sha256:${assetId}`,
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 2, height: 1 },
    bytes: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
  });
  const visiblePlan = createCompositionPlan(graph, visibleClip.id);
  expect(visiblePlan.nodes.get(nestedImage.id)).toMatchObject({
    visible: true,
    inheritedOpacity: 0.125,
    clipDepth: 1,
  });
  const visibleResult = composeRasterRGBA8(visiblePlan, {
    getAsset: (assetId) => ({ assetId, revisionId: `sha256:${assetId}` }),
    getRevision: (revisionId) => revision(revisionId.slice("sha256:".length)),
  }, { width: 2, height: 1 });
  expect([...visibleResult.pixels]).toEqual([255, 0, 0, 32, 0, 0, 0, 0]);

  const hiddenPlan = createCompositionPlan(graph, hiddenClip.id);
  expect(hiddenPlan.nodes.get(hiddenImage.id)).toMatchObject({ visible: false });
  const hiddenResult = composeRasterRGBA8(hiddenPlan, {
    getAsset: (assetId) => ({ assetId, revisionId: `sha256:${assetId}` }),
    getRevision: (revisionId) => revision(revisionId.slice("sha256:".length)),
  }, { width: 1, height: 1 });
  expect([...hiddenResult.pixels]).toEqual([0, 0, 0, 0]);
});

test("RGBA8 composition applies nested mask bounds and clipping with pixel parity", () => {
  const clip = node({
    id: "clip",
    type: "GROUP",
    width: 1,
    height: 2,
    clipsContent: true,
    childIds: ["mask"],
  });
  const mask = node({
    id: "mask",
    type: "GROUP",
    parentId: clip.id,
    width: 1,
    height: 1,
    isMask: true,
    childIds: ["image"],
  });
  const image = node({
    id: "image",
    type: "IMAGE",
    parentId: mask.id,
    width: 2,
    height: 2,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:masked",
      },
    ],
  });
  const graph = {
    rootId: clip.id,
    getNode: (id: string) => new Map([clip, mask, image].map((entry) => [entry.id, entry])).get(id),
  } as unknown as SceneGraph;
  const plan = createCompositionPlan(graph, clip.id);
  const revision = {
    revisionId: "sha256:masked",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 2, height: 2 },
    bytes: new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ]),
  } satisfies AssetRevision;
  const result = composeRasterRGBA8(plan, resolver(revision), { width: 2, height: 2 });
  expect([...result.pixels]).toEqual([
    255, 0, 0, 255, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
});

test("composition-full-v1 applies adjustment hooks only inside clipped adjustment masks", () => {
  const clip = node({
    id: "clip",
    type: "GROUP",
    width: 1,
    height: 1,
    clipsContent: true,
    childIds: ["mask", "adjustment-layer"],
  });
  const mask = node({
    id: "mask",
    type: "RECTANGLE",
    parentId: clip.id,
    width: 1,
    height: 1,
    isMask: true,
    maskType: "ALPHA",
  });
  const adjustmentLayer = node({
    id: "adjustment-layer",
    type: "IMAGE",
    parentId: clip.id,
    width: 2,
    height: 1,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:adjustment",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:adjustment",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 2, height: 1 },
    bytes: new Uint8Array([100, 20, 10, 255, 200, 40, 20, 255]),
  } satisfies AssetRevision;
  const graph = {
    rootId: clip.id,
    getNode: (id: string) =>
      new Map([clip, mask, adjustmentLayer].map((entry) => [entry.id, entry])).get(id),
  } as unknown as SceneGraph;
  const plan = createCompositionPlan(graph, clip.id, {
    adjustmentHooks: ["exposure"],
  });
  const adjustedNodes: string[] = [];
  const result = composeRasterRGBA8(plan, resolver(revision), {
    width: 2,
    height: 1,
    adjustments: {
      exposure: (pixel, plannedNode) => {
        adjustedNodes.push(plannedNode.nodeId);
        return [pixel[0] + 10, pixel[1] + 10, pixel[2] + 10, pixel[3]];
      },
    },
  });

  expect(result).toMatchObject({
    status: "SUPPORTED",
    format: "rgba8-srgb",
    gaps: [],
  });
  expect(adjustedNodes).toEqual([adjustmentLayer.id]);
  assertPixelParity(
    [...result.pixels],
    [110, 30, 20, 255, 0, 0, 0, 0],
    { maxChannelDelta: 0, maxMeanBias: 0 },
  );
});

test("effects-gap-068 consumes typed brightness, contrast, and saturation adjustment layers", () => {
  const image = node({
    id: "image",
    type: "IMAGE",
    width: 3,
    height: 1,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:adjustment-kinds",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:adjustment-kinds",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 3, height: 1 },
    bytes: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]),
  } satisfies AssetRevision;
  const plan = createCompositionPlan(
    {
      rootId: image.id,
      getNode: (id: string) => (id === image.id ? image : undefined),
    } as unknown as SceneGraph,
    image.id,
    { adjustmentHooks: ["brightness", "contrast", "saturation"] },
  );
  const result = composeRasterRGBA8(plan, resolver(revision), {
    width: 3,
    height: 1,
    adjustmentLayerAdjustments: {
      brightness: (pixel) => [pixel[0] + 1, pixel[1], pixel[2], pixel[3]],
      contrast: (pixel) => [pixel[0], pixel[1] + 2, pixel[2], pixel[3]],
      saturation: (pixel) => [pixel[0], pixel[1], pixel[2] + 3, pixel[3]],
    },
  });

  expect([...result.pixels]).toEqual([11, 22, 33, 255, 41, 52, 63, 255, 71, 82, 93, 255]);
});

test("effects-gap-069 consumes typed effect filters with bounded areas", () => {
  const image = node({
    id: "image",
    type: "IMAGE",
    width: 4,
    height: 1,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:typed-effect",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:typed-effect",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 4, height: 1 },
    bytes: new Uint8Array([
      255, 255, 255, 255,
      20, 20, 20, 255,
      20, 20, 20, 255,
      20, 20, 20, 255,
    ]),
  } satisfies AssetRevision;
  const plan = createCompositionPlan(
    {
      rootId: image.id,
      getNode: (id: string) => (id === image.id ? image : undefined),
    } as unknown as SceneGraph,
    image.id,
  );
  const result = composeRasterRGBA8(plan, resolver(revision), {
    width: 4,
    height: 1,
    effectFilters: [
      {
        id: "effect:threshold",
        kind: "threshold",
        enabled: true,
        affectedArea: [0, 0, 1, 1],
        transactionId: "tx:threshold",
        adjustments: { threshold: 100 },
      },
    ],
  });

  expect([...result.pixels]).toEqual([
    255, 255, 255, 255,
    20, 20, 20, 255,
    20, 20, 20, 255,
    20, 20, 20, 255,
  ]);
});

test("effects-gap-072 rerasterizes blur only inside the bounded affected area", () => {
  const image = node({
    id: "image",
    type: "IMAGE",
    width: 4,
    height: 1,
    fills: [{
      type: "IMAGE",
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: "asset:blur",
    }],
  });
  const revision = {
    revisionId: "sha256:blur",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 4, height: 1 },
    bytes: new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]),
  } satisfies AssetRevision;
  const plan = planFor([image], image.id);
  const result = composeRasterRGBA8(plan, resolver(revision), {
    width: 4,
    height: 1,
    effectFilters: [{
      id: "effect:blur",
      kind: "blur",
      enabled: true,
      affectedArea: [0, 0, 1, 1],
      transactionId: "tx:blur",
      adjustments: { radius: 1 },
    }],
  });

  expect([...result.pixels]).toEqual([
    128, 128, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ]);
});

test("effects-gap-071 consumes ordered layer stacks and effect masks", () => {
  const group = node({
    id: "group",
    type: "GROUP",
    width: 4,
    height: 1,
    childIds: ["image", "mask"],
  });
  const image = node({
    id: "image",
    type: "IMAGE",
    parentId: group.id,
    width: 4,
    height: 1,
    fills: [{
      type: "IMAGE",
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: "asset:stack",
    }],
  });
  const mask = node({
    id: "mask",
    type: "GROUP",
    parentId: group.id,
    x: 0,
    width: 1,
    height: 1,
    isMask: true,
  });
  const revision = {
    revisionId: "sha256:stack",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 4, height: 1 },
    bytes: new Uint8Array([
      128, 128, 128, 255,
      128, 128, 128, 255,
      128, 128, 128, 255,
      128, 128, 128, 255,
    ]),
  } satisfies AssetRevision;
  const plan = planFor([group, image, mask], group.id);
  const result = composeRasterRGBA8(plan, resolver(revision), {
    width: 4,
    height: 1,
    effectStacks: [{
      layerId: group.id,
      adjustmentScope: "group",
      smart: true,
      effectMaskIds: [mask.id],
      filters: [
        {
          id: "effect:exposure",
          kind: "exposure",
          enabled: true,
          affectedArea: [0, 0, 1, 1],
          transactionId: "tx:stack-exposure",
          adjustments: { exposure: 1 },
        },
        {
          id: "effect:threshold",
          kind: "threshold",
          enabled: true,
          affectedArea: [0, 0, 1, 1],
          transactionId: "tx:stack-threshold",
          adjustments: { threshold: 200 },
        },
      ],
    }],
  });

  expect([...result.pixels]).toEqual([
    255, 255, 255, 255,
    128, 128, 128, 255,
    128, 128, 128, 255,
    128, 128, 128, 255,
  ]);
});

test("RGBA8 group masks use accumulated bounds inside clipped groups", () => {
  const clip = node({
    id: "clip",
    type: "GROUP",
    width: 2,
    height: 1,
    clipsContent: true,
    childIds: ["mask"],
  });
  const mask = node({
    id: "mask",
    type: "GROUP",
    parentId: clip.id,
    x: 1,
    width: 1,
    height: 1,
    isMask: true,
    childIds: ["image"],
  });
  const image = node({
    id: "image",
    type: "IMAGE",
    parentId: mask.id,
    width: 3,
    height: 1,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:offset-mask",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:offset-mask",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 3, height: 1 },
    bytes: new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
    ]),
  } satisfies AssetRevision;
  const plan = planFor([clip, mask, image], clip.id);

  expect(plan.nodes.get(mask.id)?.bounds).toEqual({
    x: 1,
    y: 0,
    width: 1,
    height: 1,
  });
  expect([...composeRasterRGBA8(plan, resolver(revision), { width: 3, height: 1 }).pixels]).toEqual([
    0, 0, 0, 0,
    0, 255, 0, 255,
    0, 0, 0, 0,
  ]);
});

test("RGBA16F and Skia oracle paths emit typed unsupported gaps", () => {
  const image = node({
    id: "image",
    type: "IMAGE",
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:hdr",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:hdr",
    kind: "image",
    metadata: { format: "rgba16f-linear-premultiplied", width: 1, height: 1 },
    bytes: new Uint8Array(8),
  } satisfies AssetRevision;
  const plan = planFor([image], image.id);
  expect(composeRaster(plan, resolver(revision), { width: 1, height: 1 })).toMatchObject({
    status: "SUPPORTED",
    backend: "canvas2d",
    capability: {
      state: "UNKNOWN",
      equivalence: "NON_EQUIVALENT",
    },
    gaps: [{ code: "rgba16f-unavailable" }],
  });
  expect(composeRaster(plan, resolver(revision), { width: 1, height: 1, backend: "skia" })).toMatchObject({
    status: "UNSUPPORTED",
    backend: "skia",
    capability: {
      state: "UNSUPPORTED",
      equivalence: "UNKNOWN",
    },
    gaps: [{ code: "skia-oracle-unavailable" }],
  });
});

test("Canvas 2D fallback exposes non-equivalence and explicit RGBA8 parity thresholds", () => {
  const image = node({
    id: "image",
    type: "IMAGE",
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:rgba8",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:rgba8",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([255, 0, 0, 255]),
  } satisfies AssetRevision;
  const result = composeRaster(planFor([image], image.id), resolver(revision), {
    width: 1,
    height: 1,
  });
  expect(result).toMatchObject({
    status: "SUPPORTED",
    backend: "canvas2d",
    capability: {
      state: "SUPPORTED",
      equivalence: "NON_EQUIVALENT",
      parity: RASTER_RGBA8_PARITY,
    },
  });
  expect(result.capability.equivalence).not.toBe("PARITY_PROVEN");
});

test("public raster composition preserves RGBA8 CPU pixels", () => {
  const image = node({
    id: "image",
    type: "IMAGE",
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:rgba8-public",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:rgba8-public",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([12, 34, 56, 255]),
  } satisfies AssetRevision;

  const result = composeRaster(planFor([image], image.id), resolver(revision), {
    width: 1,
    height: 1,
  });

  expect(result.status).toBe("SUPPORTED");
  if (result.status !== "SUPPORTED") return;
  expect(result.backend).toBe("canvas2d");
  expect([...result.pixels]).toEqual([12, 34, 56, 255]);
});

test("Unavailable GPU backends expose typed gaps instead of fallback parity claims", () => {
  const plan = planFor([node({ id: "image", type: "IMAGE" })], "image");
  const resolve: RasterCompositionAssetResolver = {
    getAsset: () => undefined,
    getRevision: () => undefined,
  };
  for (const backend of ["webgl2", "webgpu"] as const) {
    const result = composeRaster(plan, resolve, { width: 1, height: 1, backend });
    expect(result).toMatchObject({
      status: "UNSUPPORTED",
      backend,
      capability: { state: "UNSUPPORTED", equivalence: "UNKNOWN" },
      gaps: [{ code: "backend-unavailable" }],
    });
  }
});

test("RGBA8 composition clips nested children and applies inherited opacity", () => {
  const outer = node({
    id: "outer",
    type: "GROUP",
    width: 3,
    height: 3,
    x: 0,
    y: 0,
    clipsContent: true,
    childIds: ["inner"],
  });
  const inner = node({
    id: "inner",
    type: "FRAME",
    parentId: outer.id,
    width: 2,
    height: 2,
    x: 1,
    y: 0,
    clipsContent: true,
    opacity: 0.5,
    childIds: ["image"],
  });
  const image = node({
    id: "image",
    type: "IMAGE",
    parentId: inner.id,
    width: 2,
    height: 2,
    x: 1,
    y: 0,
    opacity: 0.5,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:nested",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:nested",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([255, 0, 0, 255]),
  } satisfies AssetRevision;
  const plan = createCompositionPlan(
    {
      rootId: outer.id,
      getNode: (id: string) => new Map([outer, inner, image].map((entry) => [entry.id, entry])).get(id),
    } as unknown as SceneGraph,
    outer.id,
  );

  const result = composeRasterRGBA8(plan, resolver(revision), { width: 4, height: 2 });

  expect([...result.pixels]).toEqual([
    0, 0, 0, 0, 255, 0, 0, 64, 255, 0, 0, 64, 0, 0, 0, 0,
    0, 0, 0, 0, 255, 0, 0, 64, 255, 0, 0, 64, 0, 0, 0, 0,
  ]);
});

test("nested group composition blends RGBA8 colors in document-linear space", () => {
  const outer = node({
    id: "outer",
    type: "GROUP",
    childIds: ["background", "inner"],
  });
  const background = node({
    id: "background",
    type: "IMAGE",
    parentId: outer.id,
    childIds: [],
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:background",
      },
    ],
  });
  const inner = node({
    id: "inner",
    type: "GROUP",
    parentId: outer.id,
    opacity: 0.5,
    childIds: ["foreground"],
  });
  const foreground = node({
    id: "foreground",
    type: "IMAGE",
    parentId: inner.id,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:foreground",
      },
    ],
  });
  const revisions: Record<string, AssetRevision> = {
    "asset:background": {
      revisionId: "sha256:background",
      kind: "image",
      metadata: { format: "rgba8-srgb", width: 1, height: 1 },
      bytes: new Uint8Array([0, 0, 0, 255]),
    },
    "asset:foreground": {
      revisionId: "sha256:foreground",
      kind: "image",
      metadata: { format: "rgba8-srgb", width: 1, height: 1 },
      bytes: new Uint8Array([188, 188, 188, 255]),
    },
  };
  const graph = {
    rootId: outer.id,
    getNode: (id: string) =>
      new Map([outer, background, inner, foreground].map((entry) => [entry.id, entry])).get(id),
  } as unknown as SceneGraph;
  const plan = createCompositionPlan(graph, outer.id);
  const result = composeRasterRGBA8(plan, {
    getAsset: (assetId) => {
      const revision = revisions[assetId];
      return revision ? { assetId, revisionId: revision.revisionId } : undefined;
    },
    getRevision: (revisionId) => Object.values(revisions).find((revision) => revision.revisionId === revisionId),
  }, { width: 1, height: 1 });

  // A direct sRGB blend would produce 94; linear-light composition must not.
  expect([...result.pixels]).not.toEqual([94, 94, 94, 255]);
  expect([...result.pixels]).toEqual([137, 137, 137, 255]);
});

test("RGBA8 composition skips assets below hidden clipping bases", () => {
  const frame = node({
    id: "frame",
    type: "FRAME",
    visible: false,
    clipsContent: true,
    childIds: ["image"],
  });
  const image = node({
    id: "image",
    type: "IMAGE",
    parentId: frame.id,
    fills: [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: "asset:hidden",
      },
    ],
  });
  const revision = {
    revisionId: "sha256:hidden",
    kind: "image",
    metadata: { format: "rgba8-srgb", width: 1, height: 1 },
    bytes: new Uint8Array([255, 0, 0, 255]),
  } satisfies AssetRevision;
  const plan = planFor([frame, image], frame.id);

  expect([...composeRasterRGBA8(plan, resolver(revision), { width: 1, height: 1 }).pixels]).toEqual([
    0, 0, 0, 0,
  ]);
});

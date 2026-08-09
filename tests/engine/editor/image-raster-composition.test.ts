import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
import { assertPixelParity } from "#core/color/composition";
import {
  composeRaster,
  composeRasterRGBA8,
  type RasterCompositionAssetResolver,
} from "#core/canvas/image-editor";
import type { AssetRevision } from "#core/editor/assets";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

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

function resolver(revision: AssetRevision): RasterCompositionAssetResolver {
  return {
    getAsset: (assetId) => ({ assetId, revisionId: revision.revisionId }),
    getRevision: () => revision,
  };
}

function planFor(nodes: SceneNode[], rootId: string) {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  return createCompositionPlan(
    {
      rootId,
      getNode: (id: string) => byId.get(id),
    } as unknown as SceneGraph,
    rootId,
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
    gaps: [{ code: "rgba16f-unavailable" }],
  });
  expect(composeRaster(plan, resolver(revision), { width: 1, height: 1, backend: "skia" })).toMatchObject({
    status: "UNSUPPORTED",
    gaps: [{ code: "skia-oracle-unavailable" }],
  });
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

import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
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
  const result = composeRasterRGBA8(planFor([group, image], group.id), resolver(revision), {
    width: 2,
    height: 2,
    adjustments: {
      exposure: (pixel) => [pixel[0], pixel[1], pixel[2], 128],
    },
  });
  expect(result.status).toBe("SUPPORTED");
  expect([...result.pixels]).toEqual([
    255, 0, 0, 128, 0, 0, 0, 0,
    0, 0, 255, 128, 0, 0, 0, 0,
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

import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
import { composeRaster, composeRasterRGBA8 } from "#core/canvas/image-editor";
import type { AssetRevision } from "#core/editor/assets";
import { EvidenceCollector } from "#core/editor/image-observability";
import {
  createImageQaRegressionContract,
  validateImageQaRegressionContract,
} from "#core/editor/image-qa";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

const TEST_IDENTITY = "PROOF-GAP-133 catches clipping-base visibility, opacity, and pass-through regressions";
const REVISION = {
  revisionId: "sha256:proof-gap-133",
  kind: "image",
  metadata: { format: "rgba8-srgb", width: 2, height: 1 },
  bytes: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
} satisfies AssetRevision;

test(TEST_IDENTITY, () => {
  const passThrough = sceneNode({
    id: "pass-through",
    type: "GROUP",
    blendMode: "PASS_THROUGH",
    childIds: ["clip"],
  });
  const clip = sceneNode({
    id: "clip",
    type: "FRAME",
    parentId: passThrough.id,
    width: 1,
    height: 1,
    opacity: 0.5,
    clipsContent: true,
    childIds: ["image"],
  });
  const image = sceneNode({
    id: "image",
    type: "IMAGE",
    parentId: clip.id,
    width: 2,
    height: 1,
    fills: [{
      type: "IMAGE",
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: "asset:proof-gap-133",
    }],
  });

  const visiblePlan = planFor([passThrough, clip, image], passThrough.id);
  expect(visiblePlan.nodes.get(passThrough.id)?.isolation).toBe("pass-through");
  expect(visiblePlan.nodes.get(image.id)).toMatchObject({
    visible: true,
    inheritedOpacity: 0.5,
    clipDepth: 1,
  });

  const visible = composeRasterRGBA8(visiblePlan, resolver(), { width: 2, height: 1 });
  expect([...visible.pixels]).toEqual([
    255, 0, 0, 128,
    0, 0, 0, 0,
  ]);

  const hiddenClip = { ...clip, visible: false };
  const hiddenPlan = planFor([passThrough, hiddenClip, image], passThrough.id);
  expect(hiddenPlan.nodes.get(image.id)?.visible).toBe(false);
  const hidden = composeRasterRGBA8(hiddenPlan, resolver(), { width: 2, height: 1 });
  expect([...hidden.pixels]).toEqual(new Array(8).fill(0));

  const evidence = new EvidenceCollector("G134-PROOF-GAP-133", {
    repo: "open-pencil",
    commit: "seeded-defect-run-required",
    runtime: "bun",
  });
  evidence.record("published", visible.pixels.byteLength, 2);
  evidence.assertNonzeroOutput();
  expect(evidence.receipt()).toMatchObject({
    lane: "G134-PROOF-GAP-133",
    outputBytes: 8,
    stale: false,
    substituted: false,
  });
});

test("PROOF-GAP-133 keeps unavailable consuming backends typed UNKNOWN", () => {
  const image = sceneNode({
    id: "image",
    type: "IMAGE",
    fills: [{
      type: "IMAGE",
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: "asset:proof-gap-133",
    }],
  });
  const result = composeRaster(planFor([image], image.id), resolver(), {
    width: 1,
    height: 1,
    backend: "skia",
  });
  expect(result).toMatchObject({
    status: "UNSUPPORTED",
    backend: "skia",
    capability: {
      state: "UNSUPPORTED",
      equivalence: "UNKNOWN",
    },
    gaps: [{ code: "skia-oracle-unavailable" }],
  });

  const qa = createImageQaRegressionContract({ clippingGroupPixels: "SUPPORTED" });
  validateImageQaRegressionContract(qa);
  expect(qa.clippingGroupPixels).toBe("SUPPORTED");
  expect({
    realTouch: qa.realTouch,
    deviceMatrix: qa.deviceMatrix,
    firefoxGpu: qa.firefoxGpu,
  }).toEqual({
    realTouch: "UNKNOWN",
    deviceMatrix: "UNKNOWN",
    firefoxGpu: "UNKNOWN",
  });
});

function resolver() {
  return {
    getAsset: (assetId: string) => ({ assetId, revisionId: REVISION.revisionId }),
    getRevision: () => REVISION,
  };
}

function planFor(nodes: SceneNode[], rootId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return createCompositionPlan(
    {
      rootId,
      getNode: (id: string) => byId.get(id),
    } as unknown as SceneGraph,
    rootId,
  );
}

function sceneNode(
  overrides: Partial<SceneNode> & Pick<SceneNode, "id" | "type">,
): SceneNode {
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
    visible: overrides.visible ?? true,
    opacity: overrides.opacity ?? 1,
    blendMode: overrides.blendMode ?? "NORMAL",
    clipsContent: overrides.clipsContent ?? false,
    rotation: overrides.rotation ?? 0,
    isMask: overrides.isMask ?? false,
    maskType: overrides.maskType ?? "ALPHA",
    maskIsOutline: overrides.maskIsOutline ?? false,
    fills: overrides.fills ?? [],
  } as SceneNode;
}

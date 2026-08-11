import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
import { composeRaster, composeRasterRGBA8 } from "#core/canvas/image-editor";
import { assertPixelOracle } from "#core/color/composition";
import type { AssetRevision } from "#core/editor/assets";
import { EvidenceCollector } from "#core/editor/image-observability";
import {
  createImageQaRegressionContract,
  validateImageQaRegressionContract,
} from "#core/editor/image-qa";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

const TEST_IDENTITY = "PROOF-GAP-134 catches nested-group pixel composition regressions";
const REVISION = {
  revisionId: "sha256:proof-gap-134",
  kind: "image",
  metadata: { format: "rgba8-srgb", width: 1, height: 1 },
  bytes: new Uint8Array([255, 0, 0, 255]),
} satisfies AssetRevision;

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

function nestedPlan() {
  const outer = sceneNode({
    id: "outer",
    type: "GROUP",
    childIds: ["inner"],
    clipsContent: true,
  });
  const inner = sceneNode({
    id: "inner",
    type: "GROUP",
    parentId: outer.id,
    childIds: ["image"],
    opacity: 0.5,
  });
  const image = sceneNode({
    id: "image",
    type: "IMAGE",
    parentId: inner.id,
    opacity: 0.5,
    fills: [{
      type: "IMAGE",
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: "asset:proof-gap-134",
    }],
  });
  const nodes = [outer, inner, image];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const graph = {
    rootId: outer.id,
    getNode: (id: string) => byId.get(id),
  } as unknown as SceneGraph;
  return { image, plan: createCompositionPlan(graph, outer.id) };
}

function resolver() {
  return {
    getAsset: (assetId: string) => ({ assetId, revisionId: REVISION.revisionId }),
    getRevision: () => REVISION,
  };
}

test(TEST_IDENTITY, () => {
  const { image, plan } = nestedPlan();
  const result = composeRasterRGBA8(plan, resolver(), { width: 1, height: 1 });

  assertPixelOracle([...result.pixels], [255, 0, 0, 64], { format: "rgba8-srgb" });
  expect(plan.nodes.get(image.id)).toMatchObject({
    visible: true,
    inheritedOpacity: 0.25,
  });

  const evidence = new EvidenceCollector("G135-PROOF-GAP-134", {
    repo: "open-pencil",
    commit: "seeded-defect-run-required",
    runtime: "bun",
  });
  evidence.record("published", result.pixels.byteLength, 1);
  evidence.assertNonzeroOutput();
  expect(evidence.receipt()).toMatchObject({
    lane: "G135-PROOF-GAP-134",
    outputBytes: 4,
    stale: false,
    substituted: false,
  });
});

test("PROOF-GAP-134 keeps unavailable nested-group backends typed UNKNOWN", () => {
  const { plan } = nestedPlan();
  const result = composeRaster(plan, resolver(), {
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
  });

  const qa = createImageQaRegressionContract({ clippingGroupPixels: "SUPPORTED" });
  validateImageQaRegressionContract(qa);
  expect(qa.clippingGroupPixels).toBe("SUPPORTED");
  expect({ realTouch: qa.realTouch, deviceMatrix: qa.deviceMatrix, firefoxGpu: qa.firefoxGpu }).toEqual({
    realTouch: "UNKNOWN",
    deviceMatrix: "UNKNOWN",
    firefoxGpu: "UNKNOWN",
  });
});

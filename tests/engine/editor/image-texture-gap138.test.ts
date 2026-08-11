import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
import {
  createImageRenderAdapter,
  ImageRenderContextLostError,
  type ImageRenderFrame,
  type ImageRevisionResolver,
} from "#core/canvas/image-editor";
import type { AssetRevision } from "#core/editor/assets";
import { EvidenceCollector } from "#core/editor/image-observability";
import {
  createImageQaRegressionContract,
  validateImageQaRegressionContract,
} from "#core/editor/image-qa";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

const TEST_IDENTITY =
  "PROOF-GAP-138 catches unchanged, selective, and restored texture upload regressions";
const SOURCE_ASSET = "asset:source";
const MASK_ASSET = "asset:mask";
const SOURCE_REVISION_1 = "sha256:source-1";
const SOURCE_REVISION_2 = "sha256:source-2";
const MASK_REVISION = "sha256:mask-1";

function imageNode(id: string, assetId: string, isMask = false): SceneNode {
  return {
    id,
    type: "IMAGE",
    parentId: "group",
    childIds: [],
    visible: true,
    opacity: 1,
    blendMode: "NORMAL",
    clipsContent: false,
    rotation: 0,
    isMask,
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
}

function texturePlan(): ReturnType<typeof createCompositionPlan> {
  const source = imageNode("source", SOURCE_ASSET);
  const mask = imageNode("mask", MASK_ASSET, true);
  const group = {
    ...imageNode("group", "asset:unused"),
    type: "GROUP",
    parentId: null,
    childIds: [source.id, mask.id],
    fills: [],
  };
  const nodes = new Map([
    [group.id, group],
    [source.id, source],
    [mask.id, mask],
  ]);
  return createCompositionPlan(
    {
      rootId: group.id,
      getNode: (id: string) => nodes.get(id),
      // oxlint-disable-next-line open-pencil(no-broad-double-cast)
    } as unknown as SceneGraph,
    group.id,
  );
}

function textureResolver() {
  let sourceRevision = SOURCE_REVISION_1;
  const revisions = new Map<string, AssetRevision>([
    [
      SOURCE_REVISION_1,
      {
        revisionId: SOURCE_REVISION_1,
        kind: "image",
        metadata: {},
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    ],
    [
      SOURCE_REVISION_2,
      {
        revisionId: SOURCE_REVISION_2,
        kind: "image",
        metadata: {},
        bytes: new Uint8Array([5, 6, 7, 8]),
      },
    ],
    [
      MASK_REVISION,
      {
        revisionId: MASK_REVISION,
        kind: "image",
        metadata: {},
        bytes: new Uint8Array([255]),
      },
    ],
  ]);
  const resolver: ImageRevisionResolver = {
    getAsset: (assetId) =>
      assetId === SOURCE_ASSET
        ? { assetId, revisionId: sourceRevision }
        : assetId === MASK_ASSET
          ? { assetId, revisionId: MASK_REVISION }
          : undefined,
    getRevision: (revisionId) => revisions.get(revisionId),
  };
  return {
    resolver,
    replaceSourceRevision: () => {
      sourceRevision = SOURCE_REVISION_2;
    },
  };
}

function assertUploads(
  frame: ImageRenderFrame,
  expected: readonly `${string}@${string}`[],
): number {
  expect(frame.gaps).toEqual([]);
  expect(
    frame.textures.filter((texture) => texture.uploaded).map(
      (texture) => `${texture.assetId}@${texture.revisionId}`,
    ),
  ).toEqual(expected);
  const outputBytes = frame.textures
    .filter((texture) => texture.uploaded)
    .reduce((total, texture) => total + texture.byteLength, 0);
  if (expected.length > 0 && outputBytes === 0) {
    throw new Error(`${TEST_IDENTITY}: uploaded textures produced zero bytes`);
  }
  return outputBytes;
}

test(TEST_IDENTITY, () => {
  const adapter = createImageRenderAdapter();
  const plan = texturePlan();
  const { resolver, replaceSourceRevision } = textureResolver();
  const evidence = new EvidenceCollector("G139-PROOF-GAP-138", {
    repo: "open-pencil",
    commit: "seeded-defect-run-required",
    runtime: "bun",
  });

  evidence.record(
    "published",
    assertUploads(adapter.render(plan, resolver), [
      `${SOURCE_ASSET}@${SOURCE_REVISION_1}`,
      `${MASK_ASSET}@${MASK_REVISION}`,
    ]),
    1,
  );
  expect(assertUploads(adapter.render(plan, resolver), [])).toBe(0);

  adapter.markDirty(MASK_ASSET);
  evidence.record(
    "published",
    assertUploads(adapter.render(plan, resolver), [`${MASK_ASSET}@${MASK_REVISION}`]),
    2,
  );

  replaceSourceRevision();
  evidence.record(
    "published",
    assertUploads(adapter.render(plan, resolver), [`${SOURCE_ASSET}@${SOURCE_REVISION_2}`]),
    3,
  );
  expect(assertUploads(adapter.render(plan, resolver), [])).toBe(0);

  evidence.assertNonzeroOutput();
  expect(evidence.receipt()).toMatchObject({
    lane: "G139-PROOF-GAP-138",
    outputBytes: 9,
    stale: false,
    substituted: false,
  });
});

test("PROOF-GAP-138 seeded defects fail the exact upload identity contract", () => {
  const adapter = createImageRenderAdapter();
  const plan = texturePlan();
  const { resolver } = textureResolver();
  adapter.render(plan, resolver);
  const warm = adapter.render(plan, resolver);

  const unchangedUploadDefect: ImageRenderFrame = {
    ...warm,
    textures: warm.textures.map((texture, index) =>
      index === 0 ? { ...texture, dirty: true, uploaded: true } : texture,
    ),
  };
  expect(() => assertUploads(unchangedUploadDefect, [])).toThrow();

  adapter.markDirty(MASK_ASSET);
  const selective = adapter.render(plan, resolver);
  const wrongIdentityDefect: ImageRenderFrame = {
    ...selective,
    textures: selective.textures.map((texture) =>
      texture.assetId === MASK_ASSET
        ? { ...texture, assetId: SOURCE_ASSET, revisionId: SOURCE_REVISION_1 }
        : texture,
    ),
  };
  expect(() =>
    assertUploads(wrongIdentityDefect, [`${MASK_ASSET}@${MASK_REVISION}`]),
  ).toThrow();
});

test("PROOF-GAP-138 restores logical resources while consuming surfaces remain UNKNOWN", () => {
  const adapter = createImageRenderAdapter();
  const plan = texturePlan();
  const { resolver } = textureResolver();
  adapter.render(plan, resolver);

  adapter.loseContext();
  try {
    adapter.render(plan, resolver);
    throw new Error(`${TEST_IDENTITY}: lost context rendered silently`);
  } catch (error) {
    expect(error).toBeInstanceOf(ImageRenderContextLostError);
    expect((error as ImageRenderContextLostError).code).toBe("image-render-context-lost");
  }

  adapter.restore();
  expect(adapter.resourceGeneration).toBe(1);
  expect(
    assertUploads(adapter.render(plan, resolver), [
      `${SOURCE_ASSET}@${SOURCE_REVISION_1}`,
      `${MASK_ASSET}@${MASK_REVISION}`,
    ]),
  ).toBe(5);
  expect(assertUploads(adapter.render(plan, resolver), [])).toBe(0);

  const qa = createImageQaRegressionContract({ textureRestoration: "SUPPORTED" });
  validateImageQaRegressionContract(qa);
  expect({
    logicalTextureRestoration: qa.textureRestoration,
    skiaRuntime: "UNKNOWN",
    gpu: qa.firefoxGpu,
    browser: "UNKNOWN",
    device: qa.deviceMatrix,
    externalRenderer: "UNKNOWN",
  }).toEqual({
    logicalTextureRestoration: "SUPPORTED",
    skiaRuntime: "UNKNOWN",
    gpu: "UNKNOWN",
    browser: "UNKNOWN",
    device: "UNKNOWN",
    externalRenderer: "UNKNOWN",
  });
});

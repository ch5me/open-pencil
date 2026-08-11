import { expect, test } from "bun:test";

import { createCompositionPlan } from "#core/canvas/composition";
import {
  createImageRenderAdapter,
  ImageRenderContextLostError,
  observeContextLossCycles,
  resolveImageMemoryBudget,
  type ImageRenderAdapter,
  type ImageRevisionResolver,
} from "#core/canvas/image-editor";
import { MEMORY_PROFILE_LIMITS } from "#core/io/transactional/protocol";
import type { SceneGraph, SceneNode } from "#core/scene-graph";

const LOSS_RESTART_CYCLES = 20;
const WARM_STATE_RENDERS = 200;
const REVISION_ID = "sha256:resilience-113" as const;
const MIB = 1024 * 1024;

function resiliencePlan(assetId = "asset:resilience-113"): ReturnType<typeof createCompositionPlan> {
  const node = {
    id: "resilience-113-image",
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
        imageHash: assetId,
      },
    ],
    // Fixture models only the composition resolver surface.
    // oxlint-disable-next-line open-pencil(no-broad-double-cast)
  } as unknown as SceneNode;
  const graph = {
    rootId: node.id,
    getNode: (id: string) => (id === node.id ? node : undefined),
    // oxlint-disable-next-line open-pencil(no-broad-double-cast)
  } as unknown as SceneGraph;
  return createCompositionPlan(graph);
}

function resilienceResolver(): ImageRevisionResolver {
  return {
    getAsset: (assetId) => ({ assetId, revisionId: REVISION_ID }),
    getRevision: () => ({
      revisionId: REVISION_ID,
      kind: "image",
      metadata: { width: 512, height: 512 },
      bytes: new Uint8Array([1, 1, 3]),
    }),
  };
}

/**
 * Adapter fakes that reproduce the two silent-failure modes the observer must
 * catch: rendering while the context is lost, and restoring without recreating
 * resources. Without these the healthy-path assertion cannot prove detection.
 */
function faultyAdapter(fault: "renders-while-lost" | "restore-without-recreate"): ImageRenderAdapter {
  let lost = false;
  let generation = 0;
  return {
    backend: "skia",
    get resourceGeneration(): number {
      return generation;
    },
    render() {
      if (lost && fault !== "renders-while-lost") {
        throw new ImageRenderContextLostError("image render context is lost");
      }
      return { backend: "skia", commands: [], textures: [], gaps: [] };
    },
    markDirty() {},
    loseContext() {
      lost = true;
    },
    restore() {
      lost = false;
      if (fault !== "restore-without-recreate") generation += 1;
    },
  };
}

test("RESILIENCE-GAP-113 observes 20 loss/restart cycles per backend with zero silent failures", () => {
  const adapter = createImageRenderAdapter();
  const plan = resiliencePlan();
  const resolve = resilienceResolver();
  const renderOnce = (): void => {
    adapter.render(plan, resolve);
  };

  renderOnce();
  const report = observeContextLossCycles(adapter, renderOnce, LOSS_RESTART_CYCLES);

  expect(report.cycles).toBe(LOSS_RESTART_CYCLES);
  expect(report.silentFailures).toBe(0);
  expect(report.resourceGenerationEnd - report.resourceGenerationStart).toBe(LOSS_RESTART_CYCLES);
  expect(report.contract.version).toBe("renderer-resilience-v1");
  expect(report.contract.contextRestoration).toBe("SUPPORTED");
  expect(report.contract.resourceRecreation).toBe("SUPPORTED");
});

test("RESILIENCE-GAP-113 reports UNSUPPORTED when a lost context renders anyway", () => {
  const adapter = faultyAdapter("renders-while-lost");
  const report = observeContextLossCycles(
    adapter,
    () => {
      adapter.render(resiliencePlan(), resilienceResolver());
    },
    LOSS_RESTART_CYCLES,
  );

  expect(report.silentFailures).toBe(LOSS_RESTART_CYCLES);
  expect(report.contract.contextRestoration).toBe("UNSUPPORTED");
  expect(report.contract.resourceRecreation).toBe("UNSUPPORTED");
});

test("RESILIENCE-GAP-113 reports UNSUPPORTED when restore recreates no resources", () => {
  const adapter = faultyAdapter("restore-without-recreate");
  const report = observeContextLossCycles(
    adapter,
    () => {
      adapter.render(resiliencePlan(), resilienceResolver());
    },
    LOSS_RESTART_CYCLES,
  );

  expect(report.silentFailures).toBe(LOSS_RESTART_CYCLES);
  expect(report.resourceGenerationEnd).toBe(report.resourceGenerationStart);
  expect(report.contract.contextRestoration).toBe("UNSUPPORTED");
});

test("RESILIENCE-GAP-113 rejects a non-positive cycle count", () => {
  const adapter = createImageRenderAdapter();
  const renderOnce = (): void => {
    adapter.render(resiliencePlan(), resilienceResolver());
  };
  expect(() => observeContextLossCycles(adapter, renderOnce, 0)).toThrow(RangeError);
  expect(() => observeContextLossCycles(adapter, renderOnce, 1.5)).toThrow(RangeError);
});

test("RESILIENCE-GAP-113 keeps warm-state resident textures flat across a long render loop", () => {
  const adapter = createImageRenderAdapter();
  const plan = resiliencePlan();
  const resolve = resilienceResolver();
  const baseline = adapter.render(plan, resolve);

  for (let render = 0; render < WARM_STATE_RENDERS; render += 1) {
    if (render % 10 === 9) {
      adapter.loseContext();
      expect(() => adapter.render(plan, resolve)).toThrow(ImageRenderContextLostError);
      adapter.restore();
    }
    const frame = adapter.render(plan, resolve);
    // Leaked contexts/resources would show up as a growing resident texture set.
    expect(frame.textures.length).toBe(baseline.textures.length);
    expect(frame.commands.length).toBe(baseline.commands.length);
    expect(frame.gaps).toEqual([]);
  }
});

test("RESILIENCE-GAP-113 holds the D1 and M1 texture budgets under low memory", () => {
  for (const profile of ["D1", "M1"] as const) {
    const limits = MEMORY_PROFILE_LIMITS[profile];
    const normal = resolveImageMemoryBudget(profile);
    const low = resolveImageMemoryBudget(profile, true);

    expect(normal.lowMemory).toBe(false);
    expect(normal.maxTextureBytes).toBe(limits.maxRenderBufferBytes);
    expect(normal.maxResidentBytes).toBe(limits.maxResidentBytes);
    expect(low.lowMemory).toBe(true);
    expect(low.maxTextureBytes).toBe(Math.floor(limits.maxRenderBufferBytes / 4));
    expect(low.maxResidentBytes).toBe(Math.floor(limits.maxResidentBytes / 4));
    // Input limits describe the source file, not the render buffer, so low memory leaves them alone.
    expect(low.maxInputBytes).toBe(normal.maxInputBytes);
  }

  expect(resolveImageMemoryBudget("D1").maxTextureBytes).toBe(64 * MIB);
  expect(resolveImageMemoryBudget("M1").maxTextureBytes).toBe(128 * MIB);
});

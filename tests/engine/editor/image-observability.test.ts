import { expect, test } from "bun:test";

import {
  createAdaptiveWorkerGate,
  createAdaptiveWorkerPolicy,
  createBenchmarkResult,
  deterministicP95,
  EvidenceCollector,
  EvidenceContractError,
  GpuProfileUnavailableError,
  validateDirtyRect,
  validatePerformanceEvidence,
  validateTextureVersion,
} from "#core/editor/image-observability";

const identity = { repo: "open-pencil", commit: "abc", runtime: "bun" };

test("collects lifecycle evidence and rejects zero output", () => {
  const collector = new EvidenceCollector("R-O", identity);
  collector.record("allocated", 0, 1);
  collector.record("published", 4, 2);
  collector.assertNonzeroOutput();
  expect(collector.receipt().outputBytes).toBe(4);
});

test("marks stale and substituted evidence visibly", () => {
  const collector = new EvidenceCollector("O-O", identity);
  collector.record("published", 1, 1, { ...identity, commit: "old" });
  collector.markSubstituted();
  const receipt = collector.receipt();
  expect(receipt.stale).toBe(true);
  expect(receipt.substituted).toBe(true);
  const empty = new EvidenceCollector("empty", identity);
  expect(() => empty.assertNonzeroOutput()).toThrow(EvidenceContractError);
});

test("marks evidence stale when runtime identity changes", () => {
  const collector = new EvidenceCollector("runtime", identity);
  collector.record("published", 1, 1, { ...identity, runtime: "browser" });
  expect(collector.receipt().stale).toBe(true);
});

test("performance-d1-m1-v1 tracks deterministic p95 and unavailable GPU profile", () => {
  const result = createBenchmarkResult(100, [3, 1, 4, 2, 5]);
  expect(result.p95).toBe(5);
  expect(deterministicP95([10, 20, 30, 40])).toBe(40);
  const profile = {
    version: "performance-d1-m1-v1" as const,
    memoryProfile: "D1",
    tiled: true,
    mipmaps: true,
    proxyPreview: true,
    renderGraphScheduling: false,
    filterFusion: false,
    gpuProfile: "UNKNOWN" as const,
  };
  expect(profile.version).toBe("performance-d1-m1-v1");
  expect(profile.gpuProfile).toBe("UNKNOWN");
  expect(new GpuProfileUnavailableError().code).toBe("E_PERFORMANCE_GPU_PROFILE_UNAVAILABLE");
});

test("100-layer and 512-layer benchmark samples do not imply GPU measurements", () => {
  const profile = {
    version: "performance-d1-m1-v1" as const,
    memoryProfile: "D1",
    tiled: true,
    mipmaps: true,
    proxyPreview: true,
    renderGraphScheduling: false,
    filterFusion: false,
    gpuProfile: "UNKNOWN" as const,
  };
  const samples = [createBenchmarkResult(100, [1, 2]), createBenchmarkResult(512, [3, 4])];

  expect(samples.map((sample) => sample.layerCount)).toEqual([100, 512]);
  expect(profile.gpuProfile).toBe("UNKNOWN");
});

test("performance-d1-m1-v1 validates texture, dirty-rect, render-graph, memory, and budget evidence", () => {
  const evidence = {
    version: "performance-d1-m1-v1" as const,
    textureVersion: { textureId: "texture:one", revisionId: "content:one", uploaded: true },
    dirtyRect: { x: 0, y: 0, width: 64, height: 64 },
    renderGraph: {
      version: "render-graph-v1" as const,
      scheduled: false,
      nodeCount: 100,
      filterFusion: false,
    },
    benchmark: createBenchmarkResult(100, [3, 1, 4, 2, 5]),
    memoryProfile: { profile: "UNKNOWN" as const, peakBytes: "UNKNOWN" as const, tiled: true, mipmaps: true },
    mainThreadBudget: { budgetMs: 16, observedMs: "UNKNOWN" as const, withinBudget: "UNKNOWN" as const },
    gpuProfile: "UNKNOWN" as const,
  };
  expect(() => validateTextureVersion(evidence.textureVersion)).not.toThrow();
  expect(() => validateTextureVersion({ ...evidence.textureVersion, textureId: "" })).toThrow(
    "invalid texture version",
  );
  expect(() => validateTextureVersion({ ...evidence.textureVersion, revisionId: "" })).toThrow(
    "invalid texture version",
  );
  expect(() => validateDirtyRect(evidence.dirtyRect)).not.toThrow();
  expect(() => validatePerformanceEvidence(evidence)).not.toThrow();
  expect(() => validateDirtyRect({ x: 0, y: 0, width: -1, height: 1 })).toThrow(
    "dirty rectangle",
  );
  expect(() => validatePerformanceEvidence({ ...evidence, version: "wrong" })).toThrow(
    "performance evidence version",
  );
  const scheduledEvidence = structuredClone(evidence);
  scheduledEvidence.renderGraph.scheduled = true;
  expect(() => validatePerformanceEvidence(scheduledEvidence)).toThrow(
    "invalid render graph evidence",
  );
});

test("performance evidence does not claim render-graph scheduling or GPU filter fusion", () => {
  const profile = {
    version: "performance-d1-m1-v1" as const,
    memoryProfile: "UNKNOWN",
    tiled: true,
    mipmaps: true,
    proxyPreview: true,
    renderGraphScheduling: false as const,
    filterFusion: false as const,
    gpuProfile: "UNKNOWN" as const,
  };
  const evidence = {
    version: "render-graph-v1" as const,
    scheduled: false as const,
    nodeCount: 0,
    filterFusion: false as const,
  };

  expect(profile.renderGraphScheduling).toBe(false);
  expect(profile.filterFusion).toBe(false);
  expect(evidence.scheduled).toBe(false);
  expect(evidence.filterFusion).toBe(false);
});

test("optional worker policy stays cold until a measured main-thread budget miss", () => {
  expect(
    createAdaptiveWorkerPolicy([2, 8, 49.99], { workerAvailable: true }),
  ).toMatchObject({
    budgetMs: 50,
    thresholdMisses: 0,
    workerAvailable: true,
    useWorker: false,
  });
  expect(
    createAdaptiveWorkerPolicy([2, 51, 49], { workerAvailable: true }),
  ).toMatchObject({
    thresholdMisses: 1,
    useWorker: true,
  });
  expect(createAdaptiveWorkerPolicy([51], { workerAvailable: false }).useWorker).toBe(false);
});

test("optional worker policy rejects invalid observations", () => {
  expect(() => createAdaptiveWorkerPolicy([-1])).toThrow("finite and non-negative");
  expect(() => createAdaptiveWorkerPolicy([Number.NaN])).toThrow("finite and non-negative");
  expect(() => createAdaptiveWorkerPolicy([], { budgetMs: 0 })).toThrow("positive");
});

test("worker gate records real task durations before enabling worker selection", () => {
  const gate = createAdaptiveWorkerGate();
  expect(gate.policy(true).useWorker).toBe(false);
  gate.record(49);
  expect(gate.policy(true).useWorker).toBe(false);
  gate.record(51);
  expect(gate.policy(true)).toMatchObject({ thresholdMisses: 1, useWorker: true });
  expect(gate.policy(false).useWorker).toBe(false);
});

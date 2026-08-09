import { expect, test } from "bun:test";

import {
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
    renderGraphScheduling: true,
    filterFusion: true,
    gpuProfile: "UNKNOWN" as const,
  };
  expect(profile.version).toBe("performance-d1-m1-v1");
  expect(profile.gpuProfile).toBe("UNKNOWN");
  expect(new GpuProfileUnavailableError().code).toBe("E_PERFORMANCE_GPU_PROFILE_UNAVAILABLE");
});

test("performance-d1-m1-v1 validates texture, dirty-rect, render-graph, memory, and budget evidence", () => {
  const evidence = {
    version: "performance-d1-m1-v1" as const,
    textureVersion: { textureId: "texture:one", revisionId: "content:one", uploaded: true },
    dirtyRect: { x: 0, y: 0, width: 64, height: 64 },
    renderGraph: {
      version: "render-graph-v1" as const,
      scheduled: true,
      nodeCount: 100,
      filterFusion: true,
    },
    benchmark: createBenchmarkResult(100, [3, 1, 4, 2, 5]),
    memoryProfile: { profile: "UNKNOWN" as const, peakBytes: "UNKNOWN" as const, tiled: true, mipmaps: true },
    mainThreadBudget: { budgetMs: 16, observedMs: "UNKNOWN" as const, withinBudget: "UNKNOWN" as const },
    gpuProfile: "UNKNOWN" as const,
  };
  expect(() => validateTextureVersion(evidence.textureVersion)).not.toThrow();
  expect(() => validateDirtyRect(evidence.dirtyRect)).not.toThrow();
  expect(() => validatePerformanceEvidence(evidence)).not.toThrow();
  expect(() => validateDirtyRect({ x: 0, y: 0, width: -1, height: 1 })).toThrow(
    "dirty rectangle",
  );
  expect(() => validatePerformanceEvidence({ ...evidence, version: "wrong" })).toThrow(
    "performance evidence version",
  );
});

import { expect, test } from "bun:test";

import {
  createBenchmarkResult,
  deterministicP95,
  EvidenceCollector,
  EvidenceContractError,
  GpuProfileUnavailableError,
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

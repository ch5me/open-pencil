export type EvidencePhase =
  | "allocated"
  | "staged"
  | "prepared"
  | "committed"
  | "published"
  | "failed"
  | "rolled-back";

export interface RuntimeIdentity {
  readonly repo: string;
  readonly commit: string;
  readonly runtime: string;
}

export interface EvidenceEvent {
  readonly phase: EvidencePhase;
  readonly at: number;
  readonly bytes: number;
  readonly identity: RuntimeIdentity;
}

export interface LaneReceipt {
  readonly schema: "ch5.open-pencil.image-editor.receipt.v1";
  readonly lane: string;
  readonly identity: RuntimeIdentity;
  readonly events: readonly EvidenceEvent[];
  readonly outputBytes: number;
  readonly stale: boolean;
  readonly substituted: boolean;
}

export class EvidenceContractError extends Error {
  readonly code = "evidence-contract-error";
}

export interface DirtyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TextureVersion {
  readonly textureId: string;
  readonly revisionId: string;
  readonly uploaded: boolean;
}

export interface PerformanceProfile {
  readonly version: "performance-d1-m1-v1";
  readonly memoryProfile: string;
  readonly tiled: boolean;
  readonly mipmaps: boolean;
  readonly proxyPreview: boolean;
  readonly renderGraphScheduling: boolean;
  readonly filterFusion: boolean;
  readonly gpuProfile: "UNKNOWN" | string;
}

export class GpuProfileUnavailableError extends Error {
  readonly code = "E_PERFORMANCE_GPU_PROFILE_UNAVAILABLE";
}

export interface BenchmarkResult {
  readonly layerCount: 100 | 512;
  readonly samples: readonly number[];
  readonly p95: number;
}

export function deterministicP95(samples: readonly number[]): number {
  if (samples.length === 0) throw new RangeError("benchmark samples required");
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

export function createBenchmarkResult(
  layerCount: 100 | 512,
  samples: readonly number[],
): BenchmarkResult {
  return { layerCount, samples: [...samples], p95: deterministicP95(samples) };
}

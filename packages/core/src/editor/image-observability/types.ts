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

export interface RenderGraphEvidence {
  readonly version: "render-graph-v1";
  readonly scheduled: boolean;
  readonly nodeCount: number;
  readonly filterFusion: boolean;
}

export interface MemoryProfileEvidence {
  readonly profile: "D1" | "M1" | "UNKNOWN";
  readonly peakBytes: number | "UNKNOWN";
  readonly tiled: boolean | "UNKNOWN";
  readonly mipmaps: boolean | "UNKNOWN";
}

export interface MainThreadBudgetEvidence {
  readonly budgetMs: number;
  readonly observedMs: number | "UNKNOWN";
  readonly withinBudget: boolean | "UNKNOWN";
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

export interface PerformanceEvidence {
  readonly version: "performance-d1-m1-v1";
  readonly textureVersion: TextureVersion;
  readonly dirtyRect: DirtyRect;
  readonly renderGraph: RenderGraphEvidence;
  readonly benchmark: BenchmarkResult;
  readonly memoryProfile: MemoryProfileEvidence;
  readonly mainThreadBudget: MainThreadBudgetEvidence;
  readonly gpuProfile: "UNKNOWN" | string;
}

export function validateDirtyRect(rect: DirtyRect): void {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new EvidenceContractError("invalid dirty rectangle");
  }
}

export function validateTextureVersion(texture: TextureVersion): void {
  if (!texture.textureId || !texture.revisionId) {
    throw new EvidenceContractError("invalid texture version");
  }
}

export function validatePerformanceEvidence(evidence: PerformanceEvidence): void {
  if (evidence.version !== "performance-d1-m1-v1") {
    throw new EvidenceContractError("invalid performance evidence version");
  }
  validateTextureVersion(evidence.textureVersion);
  validateDirtyRect(evidence.dirtyRect);
  if (
    evidence.renderGraph.version !== "render-graph-v1" ||
    evidence.renderGraph.nodeCount < 0 ||
    !Number.isInteger(evidence.renderGraph.nodeCount)
  ) {
    throw new EvidenceContractError("invalid render graph evidence");
  }
  if (evidence.benchmark.layerCount !== 100 && evidence.benchmark.layerCount !== 512) {
    throw new EvidenceContractError("invalid benchmark layer count");
  }
  if (!Number.isFinite(evidence.mainThreadBudget.budgetMs) || evidence.mainThreadBudget.budgetMs <= 0) {
    throw new EvidenceContractError("invalid main-thread budget");
  }
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

export const WORKER_PROTOCOL = "ch5.image-editor.worker";

export type WorkerDirection = "host-to-worker" | "worker-to-host";
export type WorkerOperation =
  | "open-archive"
  | "save-archive"
  | "import-psd"
  | "export-psd"
  | "decode-raster";

export type HostState =
  | "idle"
  | "allocated"
  | "validating-request"
  | "staging-input"
  | "dispatched"
  | "receiving-output"
  | "verifying-output"
  | "prepared"
  | "committing"
  | "committed"
  | "publishing"
  | "published"
  | "tombstoning"
  | "cancelling-worker"
  | "rolling-back"
  | "rolled-back";

export type WorkerState =
  | "starting"
  | "ready"
  | "receiving-input"
  | "input-complete"
  | "validating"
  | "transforming"
  | "emitting-output"
  | "output-complete"
  | "result-sent"
  | "cancelling"
  | "cancelled"
  | "failed";

export interface ChunkDescriptor {
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly offset: number;
  readonly byteLength: number;
  readonly sha256: string;
  readonly final: boolean;
  readonly bytes: Uint8Array;
}

export interface WorkerEnvelope<TType extends string = string, TPayload = unknown> {
  readonly protocol: typeof WORKER_PROTOCOL;
  readonly major: 1;
  readonly minor: 0;
  readonly requestId: `request:${string}`;
  readonly transactionId: `tx:${string}`;
  readonly sequence: number;
  readonly direction: WorkerDirection;
  readonly type: TType;
  readonly payload: TPayload;
}

export interface BeginRequest {
  readonly operation: WorkerOperation;
  readonly memoryProfile: string;
  readonly protocolCapabilities: readonly string[];
  readonly inputManifestHash: string;
  readonly expectedInputBytes: number;
  readonly expectedOutputClass: string;
  readonly replayable: boolean;
  readonly maxInputBytes?: number;
  readonly maxResidentBytes?: number;
}

export interface ProgressPayload {
  readonly stage: string;
  readonly consumedBytes: number;
  readonly producedBytes: number;
  readonly completedItems: number;
  readonly totalItems: number | null;
  readonly estimatedResidentBytes: number;
}

export interface LongTaskBudget {
  readonly maxTaskMs: number;
  readonly taskCount: number;
  readonly overBudgetCount: number;
}

export function assertResourceLimit(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

export interface WorkerErrorPayload {
  readonly code: string;
  readonly stage: string;
  readonly retryable: boolean;
  readonly message: string;
}

export function assertChunk(chunk: ChunkDescriptor): void {
  if (!Number.isSafeInteger(chunk.chunkIndex) || chunk.chunkIndex < 0) {
    throw new Error("chunkIndex must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(chunk.offset) || chunk.offset < 0) {
    throw new Error("offset must be a non-negative safe integer");
  }
  if (chunk.byteLength !== chunk.bytes.byteLength) {
    throw new Error("chunk byteLength does not match bytes");
  }
  if (!/^[0-9a-f]{64}$/u.test(chunk.sha256)) {
    throw new Error("chunk sha256 must be a lowercase SHA-256 hex digest");
  }
}

const HOST_TRANSITIONS: Readonly<Record<HostState, readonly HostState[]>> = {
  idle: ["allocated", "tombstoning"],
  allocated: ["validating-request", "tombstoning"],
  "validating-request": ["staging-input", "tombstoning"],
  "staging-input": ["dispatched", "tombstoning"],
  dispatched: ["receiving-output", "tombstoning"],
  "receiving-output": ["verifying-output", "tombstoning"],
  "verifying-output": ["prepared", "tombstoning"],
  prepared: ["committing", "tombstoning"],
  committing: ["committed", "tombstoning"],
  committed: ["publishing", "tombstoning"],
  publishing: ["published"],
  published: [],
  tombstoning: ["cancelling-worker"],
  "cancelling-worker": ["rolling-back"],
  "rolling-back": ["rolled-back"],
  "rolled-back": [],
};

export function canTransitionHost(from: HostState, to: HostState): boolean {
  return HOST_TRANSITIONS[from].includes(to);
}

const WORKER_TRANSITIONS: Readonly<Record<WorkerState, readonly WorkerState[]>> = {
  starting: ["ready", "failed"],
  ready: ["receiving-input", "cancelling", "failed"],
  "receiving-input": ["input-complete", "cancelling", "failed"],
  "input-complete": ["validating", "cancelling", "failed"],
  validating: ["transforming", "cancelling", "failed"],
  transforming: ["emitting-output", "cancelling", "failed"],
  "emitting-output": ["output-complete", "cancelling", "failed"],
  "output-complete": ["result-sent", "failed"],
  "result-sent": ["ready", "failed"],
  cancelling: ["cancelled"],
  cancelled: [],
  failed: [],
};

export function canTransitionWorker(from: WorkerState, to: WorkerState): boolean {
  return WORKER_TRANSITIONS[from].includes(to);
}

import {
  assertChunk,
  canTransitionWorker,
  type ChunkDescriptor,
  type LongTaskBudget,
  type MemoryProfile,
  type ProgressPayload,
  type WorkerState,
  DEFAULT_LONG_TASK_BUDGET_MS,
  MEMORY_PROFILE_LIMITS,
  MAX_LONG_TASK_BUDGET_MS,
  assertMemoryProfile,
  assertResourceLimit,
} from "#core/io/transactional/protocol";

export { DEFAULT_LONG_TASK_BUDGET_MS };

export class WorkerProtocolError extends Error {
  readonly name: string = "WorkerProtocolError";
  readonly code: string = "worker-protocol-error";
}

export class WorkerMemoryPressureError extends WorkerProtocolError {
  readonly name = "WorkerMemoryPressureError";
  readonly code: string = "worker-memory-pressure";
}

export class WorkerCancelledError extends WorkerProtocolError {
  readonly name = "WorkerCancelledError";
  readonly code: string = "worker-cancelled";
}

export type WorkerMemoryState = "WITHIN_BUDGET" | "PRESSURE";

export interface WorkerMemoryStatus {
  readonly version: "worker-memory-status-v1";
  readonly state: WorkerMemoryState;
  readonly profile: MemoryProfile | null;
  readonly limits: {
    readonly maxInputBytes: number | null;
    readonly maxResidentBytes: number | null;
    readonly maxRenderBufferBytes: number | null;
  };
  readonly accounting: Pick<MemoryAccounting, "residentBytes" | "peakResidentBytes">;
}

export interface WorkerAdmissionOptions {
  readonly memoryProfile: MemoryProfile;
  readonly maxResidentBytes: number;
  readonly maxInputBytes?: number;
  readonly maxRenderBufferBytes?: number;
  readonly maxTaskMs?: number;
}

export function createWorkerAdmissionOptions(
  memoryProfile: MemoryProfile,
  overrides: Omit<Partial<WorkerAdmissionOptions>, "memoryProfile"> = {},
): WorkerAdmissionOptions {
  const limits = MEMORY_PROFILE_LIMITS[memoryProfile];
  return {
    memoryProfile,
    maxInputBytes: limits.maxInputBytes,
    maxResidentBytes: limits.maxResidentBytes,
    maxRenderBufferBytes: limits.maxRenderBufferBytes,
    ...overrides,
  };
}

export interface MemoryReservation {
  readonly sourcesBytes?: number;
  readonly masksBytes?: number;
  readonly groupCanvasesBytes?: number;
  readonly renderBytes?: number;
  readonly readbackBytes?: number;
}

export interface MemoryAccounting extends Required<MemoryReservation> {
  readonly residentBytes: number;
  readonly peakResidentBytes: number;
}

export class WorkerStateMachine {
  state: WorkerState = "starting";
  private inputSequence = 0;
  private readonly options?: WorkerAdmissionOptions;
  private taskCount = 0;
  private overBudgetCount = 0;
  private totalTaskMs = 0;
  private maxObservedTaskMs = 0;
  private inputCount = 0;
  private inputBytes = 0;
  private inputFinal = false;
  private residentBytes = 0;
  private peakResidentBytes = 0;
  private memoryState: WorkerMemoryState = "WITHIN_BUDGET";

  constructor(options?: WorkerAdmissionOptions) {
    if (options) {
      assertMemoryProfile(options.memoryProfile);
      assertResourceLimit(options.maxResidentBytes, "maxResidentBytes");
      if (options.maxInputBytes !== undefined) {
        assertResourceLimit(options.maxInputBytes, "maxInputBytes");
      }
      if (options.maxRenderBufferBytes !== undefined) {
        assertResourceLimit(options.maxRenderBufferBytes, "maxRenderBufferBytes");
        if (options.maxRenderBufferBytes > options.maxResidentBytes) {
          throw new WorkerProtocolError("maxRenderBufferBytes exceeds maxResidentBytes");
        }
      }
      if (options.maxTaskMs !== undefined) {
        assertResourceLimit(options.maxTaskMs, "maxTaskMs");
        if (options.maxTaskMs > MAX_LONG_TASK_BUDGET_MS) {
          throw new WorkerProtocolError("maxTaskMs exceeds 50ms budget");
        }
      }
      this.options = options;
    }
  }

  ready(): void {
    this.advance("ready");
  }

  beginInput(): void {
    this.advance("receiving-input");
  }

  receiveInput(chunk: ChunkDescriptor): void {
    this.requireActive("receiving input");
    if (this.state !== "receiving-input")
      throw new WorkerProtocolError("worker is not receiving input");
    assertChunk(chunk);
    if (chunk.chunkIndex !== this.inputSequence)
      throw new WorkerProtocolError("input sequence gap");
    if (this.inputFinal) throw new WorkerProtocolError("input already complete");
    if (chunk.offset !== this.inputBytes) throw new WorkerProtocolError("input offset gap");
    const nextInputBytes = this.inputBytes + chunk.byteLength;
    if (!Number.isSafeInteger(nextInputBytes)) {
      throw new WorkerMemoryPressureError("input size exceeds safe integer range");
    }
    if (this.options?.maxInputBytes !== undefined && nextInputBytes > this.options.maxInputBytes) {
      throw new WorkerMemoryPressureError(
        `input exceeds ${this.options.memoryProfile} maxInputBytes admission`,
      );
    }
    this.inputSequence += 1;
    this.inputCount += 1;
    this.inputBytes = nextInputBytes;
    this.inputFinal = chunk.final;
  }

  finishInput(): void {
    this.requireActive("finish input");
    if (this.inputCount === 0 || !this.inputFinal)
      throw new WorkerProtocolError("input must end with a final chunk");
    this.advance("input-complete");
    this.advance("validating");
  }

  transform(): void {
    this.requireActive("transform");
    this.advance("transforming");
    this.advance("emitting-output");
  }

  finishOutput(): void {
    this.requireActive("finish output");
    this.advance("output-complete");
  }

  sendResult(): void {
    this.requireActive("send result");
    this.advance("result-sent");
  }

  cancel(): void {
    if (this.state === "cancelled" || this.state === "failed") return;
    this.advance("cancelling");
    this.advance("cancelled");
  }

  fail(): void {
    if (canTransitionWorker(this.state, "failed")) this.advance("failed");
    else throw new WorkerProtocolError(`cannot fail worker from ${this.state}`);
  }

  admitProgress(progress: ProgressPayload): void {
    if (
      progress.estimatedResidentBytes < 0 ||
      !Number.isSafeInteger(progress.estimatedResidentBytes)
    ) {
      throw new WorkerProtocolError("estimatedResidentBytes must be a non-negative safe integer");
    }
    if (this.options && progress.estimatedResidentBytes > this.options.maxResidentBytes) {
      this.rejectMemoryPressure(
        `estimatedResidentBytes exceeds ${this.options.memoryProfile} admission`,
      );
    }
  }

  admitRenderBuffer(width: number, height: number, bytesPerPixel = 4): number {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      !Number.isSafeInteger(bytesPerPixel) ||
      width <= 0 ||
      height <= 0 ||
      bytesPerPixel <= 0
    ) {
      throw new WorkerProtocolError("render dimensions must be positive safe integers");
    }
    const bytes = width * height * bytesPerPixel;
    if (!Number.isSafeInteger(bytes)) {
      this.rejectMemoryPressure("render buffer size exceeds safe integer range");
    }
    const maxRenderBufferBytes =
      this.options?.maxRenderBufferBytes ?? this.options?.maxResidentBytes;
    if (maxRenderBufferBytes !== undefined && bytes > maxRenderBufferBytes) {
      this.rejectMemoryPressure(`render buffer exceeds ${this.options.memoryProfile} admission`);
    }
    return bytes;
  }

  /**
   * Validate the full reservation before mutating accounting.
   * This keeps hostile work from reaching a partial render/publish state.
   */
  admitMemory(reservation: MemoryReservation): MemoryAccounting {
    const normalized: Required<MemoryReservation> = {
      sourcesBytes: reservation.sourcesBytes ?? 0,
      masksBytes: reservation.masksBytes ?? 0,
      groupCanvasesBytes: reservation.groupCanvasesBytes ?? 0,
      renderBytes: reservation.renderBytes ?? 0,
      readbackBytes: reservation.readbackBytes ?? 0,
    };
    const values = Object.values(normalized);
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new WorkerProtocolError("memory reservation must contain non-negative safe integers");
    }
    const renderLimit = this.options?.maxRenderBufferBytes ?? this.options?.maxResidentBytes;
    if (renderLimit !== undefined && normalized.renderBytes > renderLimit) {
      this.rejectMemoryPressure(
        `render buffer exceeds ${this.options?.memoryProfile ?? "unknown"} admission`,
      );
    }
    const reservationBytes = values.reduce((total, value) => total + value, 0);
    const residentBytes = this.residentBytes + reservationBytes;
    if (!Number.isSafeInteger(residentBytes)) {
      this.rejectMemoryPressure("resident memory exceeds safe integer range");
    }
    if (this.options && residentBytes > this.options.maxResidentBytes) {
      this.rejectMemoryPressure(`resident memory exceeds ${this.options.memoryProfile} admission`);
    }
    this.residentBytes = residentBytes;
    this.peakResidentBytes = Math.max(this.peakResidentBytes, residentBytes);
    return { ...normalized, residentBytes, peakResidentBytes: this.peakResidentBytes };
  }

  releaseMemory(reservation: MemoryReservation): MemoryAccounting {
    const normalized: Required<MemoryReservation> = {
      sourcesBytes: reservation.sourcesBytes ?? 0,
      masksBytes: reservation.masksBytes ?? 0,
      groupCanvasesBytes: reservation.groupCanvasesBytes ?? 0,
      renderBytes: reservation.renderBytes ?? 0,
      readbackBytes: reservation.readbackBytes ?? 0,
    };
    const values = Object.values(normalized);
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new WorkerProtocolError("memory reservation must contain non-negative safe integers");
    }
    const releasedBytes = values.reduce((total, value) => total + value, 0);
    if (releasedBytes > this.residentBytes) {
      throw new WorkerProtocolError("memory release exceeds resident accounting");
    }
    this.residentBytes -= releasedBytes;
    return { ...normalized, residentBytes: this.residentBytes, peakResidentBytes: this.peakResidentBytes };
  }

  memoryAccounting(): Pick<MemoryAccounting, "residentBytes" | "peakResidentBytes"> {
    return { residentBytes: this.residentBytes, peakResidentBytes: this.peakResidentBytes };
  }

  memoryStatus(): WorkerMemoryStatus {
    return {
      version: "worker-memory-status-v1",
      state: this.memoryState,
      profile: this.options?.memoryProfile ?? null,
      limits: {
        maxInputBytes: this.options?.maxInputBytes ?? null,
        maxResidentBytes: this.options?.maxResidentBytes ?? null,
        maxRenderBufferBytes: this.options?.maxRenderBufferBytes ?? null,
      },
      accounting: this.memoryAccounting(),
    };
  }

  recordLongTask(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new WorkerProtocolError("durationMs must be a non-negative finite number");
    }
    this.taskCount += 1;
    this.totalTaskMs += durationMs;
    this.maxObservedTaskMs = Math.max(this.maxObservedTaskMs, durationMs);
    if (durationMs > (this.options?.maxTaskMs ?? DEFAULT_LONG_TASK_BUDGET_MS)) {
      this.overBudgetCount += 1;
    }
  }

  longTaskBudget(): LongTaskBudget {
    return {
      maxTaskMs: this.options?.maxTaskMs ?? DEFAULT_LONG_TASK_BUDGET_MS,
      taskCount: this.taskCount,
      overBudgetCount: this.overBudgetCount,
      totalTaskMs: this.totalTaskMs,
      maxObservedTaskMs: this.maxObservedTaskMs,
    };
  }

  private advance(next: WorkerState): void {
    if (!canTransitionWorker(this.state, next)) {
      throw new WorkerProtocolError(`invalid worker transition: ${this.state} -> ${next}`);
    }
    this.state = next;
  }

  private requireActive(operation: string): void {
    if (this.state === "cancelled")
      throw new WorkerCancelledError(`cannot ${operation}: worker cancelled`);
  }

  private rejectMemoryPressure(message: string): never {
    this.memoryState = "PRESSURE";
    throw new WorkerMemoryPressureError(message);
  }
}

import {
  assertChunk,
  canTransitionWorker,
  type ChunkDescriptor,
  type LongTaskBudget,
  type ProgressPayload,
  type WorkerState,
  assertResourceLimit,
} from "#core/io/transactional/protocol";

export class WorkerProtocolError extends Error {
  readonly code = "worker-protocol-error";
}

export class WorkerMemoryPressureError extends WorkerProtocolError {
  readonly code = "worker-memory-pressure";
}

export interface WorkerAdmissionOptions {
  readonly memoryProfile: string;
  readonly maxResidentBytes: number;
  readonly maxTaskMs?: number;
}

export class WorkerStateMachine {
  state: WorkerState = "starting";
  private inputSequence = 0;
  private readonly options?: WorkerAdmissionOptions;
  private taskCount = 0;
  private overBudgetCount = 0;

  constructor(options?: WorkerAdmissionOptions) {
    if (options) {
      assertResourceLimit(options.maxResidentBytes, "maxResidentBytes");
      if (options.maxTaskMs !== undefined) assertResourceLimit(options.maxTaskMs, "maxTaskMs");
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
    if (this.state !== "receiving-input")
      throw new WorkerProtocolError("worker is not receiving input");
    assertChunk(chunk);
    if (chunk.chunkIndex !== this.inputSequence)
      throw new WorkerProtocolError("input sequence gap");
    this.inputSequence += 1;
  }

  finishInput(): void {
    this.advance("input-complete");
    this.advance("validating");
  }

  transform(): void {
    this.advance("transforming");
    this.advance("emitting-output");
  }

  finishOutput(): void {
    this.advance("output-complete");
  }

  sendResult(): void {
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
      throw new WorkerMemoryPressureError(
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
      throw new WorkerMemoryPressureError("render buffer size exceeds safe integer range");
    }
    if (this.options && bytes > this.options.maxResidentBytes) {
      throw new WorkerMemoryPressureError(
        `render buffer exceeds ${this.options.memoryProfile} admission`,
      );
    }
    return bytes;
  }

  recordLongTask(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new WorkerProtocolError("durationMs must be a non-negative finite number");
    }
    this.taskCount += 1;
    if (this.options?.maxTaskMs !== undefined && durationMs > this.options.maxTaskMs) {
      this.overBudgetCount += 1;
    }
  }

  longTaskBudget(): LongTaskBudget {
    return {
      maxTaskMs: this.options?.maxTaskMs ?? 0,
      taskCount: this.taskCount,
      overBudgetCount: this.overBudgetCount,
    };
  }

  private advance(next: WorkerState): void {
    if (!canTransitionWorker(this.state, next)) {
      throw new WorkerProtocolError(`invalid worker transition: ${this.state} -> ${next}`);
    }
    this.state = next;
  }
}

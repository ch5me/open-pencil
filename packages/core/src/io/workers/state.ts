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

export interface WorkerAdmissionOptions {
  readonly memoryProfile: string;
  readonly maxResidentBytes: number;
  readonly maxInputBytes?: number;
  readonly maxTaskMs?: number;
}

export class WorkerStateMachine {
  state: WorkerState = "starting";
  private inputSequence = 0;
  private readonly options?: WorkerAdmissionOptions;
  private taskCount = 0;
  private overBudgetCount = 0;
  private inputCount = 0;
  private inputBytes = 0;
  private inputFinal = false;

  constructor(options?: WorkerAdmissionOptions) {
    if (options) {
      assertResourceLimit(options.maxResidentBytes, "maxResidentBytes");
      if (options.maxInputBytes !== undefined) {
        assertResourceLimit(options.maxInputBytes, "maxInputBytes");
      }
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

  private requireActive(operation: string): void {
    if (this.state === "cancelled")
      throw new WorkerCancelledError(`cannot ${operation}: worker cancelled`);
  }
}

import {
  assertChunk,
  canTransitionHost,
  type BeginRequest,
  type ChunkDescriptor,
  type HostState,
  assertResourceLimit,
  assertMemoryProfile,
  MAX_LONG_TASK_BUDGET_MS,
} from "./protocol";

export class TransactionProtocolError extends Error {
  readonly code = "transaction-protocol-error";
}

export class TransactionCancelledError extends Error {
  readonly code = "transaction-cancelled";
}

export interface HostTransactionIds {
  transactionId(): `tx:${string}`;
  requestId(): `request:${string}`;
}

export function createHostTransactionIds(
  randomUUID: () => string = () => crypto.randomUUID(),
): HostTransactionIds {
  return {
    transactionId: () => `tx:${randomUUID()}`,
    requestId: () => `request:${randomUUID()}`,
  };
}

export class HostTransaction {
  readonly transactionId: `tx:${string}`;
  readonly requestId: `request:${string}`;
  readonly inputChunks: ChunkDescriptor[] = [];
  readonly outputChunks: ChunkDescriptor[] = [];
  state: HostState = "idle";
  private inputSequence = 0;
  private outputSequence = 0;
  private tombstoned = false;

  constructor(private readonly ids: HostTransactionIds = createHostTransactionIds()) {
    this.transactionId = ids.transactionId();
    this.requestId = ids.requestId();
  }

  begin(request: BeginRequest): void {
    this.advance("allocated");
    this.advance("validating-request");
    assertMemoryProfile(request.memoryProfile);
    if (request.expectedInputBytes < 0 || !Number.isSafeInteger(request.expectedInputBytes)) {
      throw new TransactionProtocolError("expectedInputBytes must be a non-negative safe integer");
    }
    if (request.maxInputBytes !== undefined) {
      assertResourceLimit(request.maxInputBytes, "maxInputBytes");
      if (request.expectedInputBytes > request.maxInputBytes) {
        throw new TransactionProtocolError("expectedInputBytes exceeds maxInputBytes");
      }
    }
    if (request.maxResidentBytes !== undefined) {
      assertResourceLimit(request.maxResidentBytes, "maxResidentBytes");
    }
    if (request.maxRenderBufferBytes !== undefined) {
      assertResourceLimit(request.maxRenderBufferBytes, "maxRenderBufferBytes");
      if (
        request.maxResidentBytes !== undefined &&
        request.maxRenderBufferBytes > request.maxResidentBytes
      ) {
        throw new TransactionProtocolError("maxRenderBufferBytes exceeds maxResidentBytes");
      }
    }
    if (request.maxTaskMs !== undefined) {
      assertResourceLimit(request.maxTaskMs, "maxTaskMs");
      if (request.maxTaskMs > MAX_LONG_TASK_BUDGET_MS) {
        throw new TransactionProtocolError("maxTaskMs exceeds 50ms budget");
      }
    }
    this.advance("staging-input");
  }

  stageInput(chunk: ChunkDescriptor): void {
    this.requireState("staging-input");
    assertChunk(chunk);
    if (chunk.chunkIndex !== this.inputSequence)
      throw new TransactionProtocolError("input sequence gap");
    this.inputChunks.push({ ...chunk, bytes: new Uint8Array(chunk.bytes) });
    this.inputSequence += 1;
  }

  inputComplete(): void {
    this.requireState("staging-input");
    if (this.inputChunks.length === 0) throw new TransactionProtocolError("input cannot be empty");
    this.advance("dispatched");
  }

  receiveOutput(chunk: ChunkDescriptor): void {
    this.requireState("receiving-output");
    assertChunk(chunk);
    if (chunk.chunkIndex !== this.outputSequence)
      throw new TransactionProtocolError("output sequence gap");
    this.outputChunks.push({ ...chunk, bytes: new Uint8Array(chunk.bytes) });
    this.outputSequence += 1;
  }

  workerDispatched(): void {
    this.requireState("dispatched");
    this.advance("receiving-output");
  }

  verifyOutput(): void {
    this.requireState("receiving-output");
    if (this.outputChunks.length === 0)
      throw new TransactionProtocolError("output cannot be empty");
    this.advance("verifying-output");
    this.advance("prepared");
  }

  commit(): void {
    this.requireState("prepared");
    this.advance("committing");
    this.advance("committed");
  }

  publish(): void {
    if (this.tombstoned) throw new TransactionCancelledError("transaction is tombstoned");
    this.requireState("committed");
    this.advance("publishing");
    this.advance("published");
  }

  cancel(): void {
    if (this.tombstoned || this.state === "published" || this.state === "rolled-back") return;
    this.tombstoned = true;
    this.advance("tombstoning");
    this.advance("cancelling-worker");
    this.advance("rolling-back");
    this.advance("rolled-back");
  }

  acceptsWorkerMessage(): boolean {
    return !this.tombstoned;
  }

  private advance(next: HostState): void {
    if (!canTransitionHost(this.state, next)) {
      throw new TransactionProtocolError(`invalid host transition: ${this.state} -> ${next}`);
    }
    this.state = next;
  }

  private requireState(expected: HostState): void {
    if (this.state !== expected)
      throw new TransactionProtocolError(`expected ${expected}, got ${this.state}`);
    if (this.tombstoned) throw new TransactionCancelledError("transaction is tombstoned");
  }
}

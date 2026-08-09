import {
  assertChunk,
  canTransitionWorker,
  type ChunkDescriptor,
  type WorkerState,
} from "#core/io/transactional/protocol";

export class WorkerProtocolError extends Error {
  readonly code = "worker-protocol-error";
}

export class WorkerStateMachine {
  state: WorkerState = "starting";
  private inputSequence = 0;

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

  private advance(next: WorkerState): void {
    if (!canTransitionWorker(this.state, next)) {
      throw new WorkerProtocolError(`invalid worker transition: ${this.state} -> ${next}`);
    }
    this.state = next;
  }
}

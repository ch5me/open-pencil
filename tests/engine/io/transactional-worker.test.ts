import { describe, expect, test } from "bun:test";

import { HostTransaction } from "#core/io/transactional";
import { WorkerStateMachine } from "#core/io/workers";

const digest = "a".repeat(64);
const chunk = (index: number) => ({
  chunkId: `chunk-${index}`,
  chunkIndex: index,
  offset: index,
  byteLength: 1,
  sha256: digest,
  final: true,
  bytes: new Uint8Array([index]),
});

describe("transactional IO and worker contracts", () => {
  test("host stages, verifies, commits, and publishes without partial states", () => {
    const tx = new HostTransaction({
      transactionId: () => "tx:host",
      requestId: () => "request:host",
    });
    tx.begin({
      operation: "open-archive",
      memoryProfile: "D1",
      protocolCapabilities: [],
      inputManifestHash: digest,
      expectedInputBytes: 1,
      expectedOutputClass: "archive",
      replayable: true,
    });
    tx.stageInput(chunk(0));
    tx.inputComplete();
    tx.workerDispatched();
    tx.receiveOutput(chunk(0));
    tx.verifyOutput();
    tx.commit();
    tx.publish();
    expect(tx.state).toBe("published");
  });

  test("tombstoned host ignores later worker output", () => {
    const tx = new HostTransaction();
    tx.cancel();
    expect(tx.state).toBe("rolled-back");
    expect(tx.acceptsWorkerMessage()).toBe(false);
    expect(() => tx.receiveOutput(chunk(0))).toThrow("expected receiving-output");
  });

  test("worker enforces sequence and directional lifecycle", () => {
    const worker = new WorkerStateMachine();
    worker.ready();
    worker.beginInput();
    expect(() => worker.receiveInput(chunk(1))).toThrow("input sequence gap");
    worker.receiveInput(chunk(0));
    worker.finishInput();
    worker.transform();
    worker.finishOutput();
    worker.sendResult();
    expect(worker.state).toBe("result-sent");
  });
});

import { describe, expect, test } from "bun:test";

import { HostTransaction, TransactionCancelledError } from "#core/io/transactional";
import { WorkerMemoryPressureError, WorkerStateMachine } from "#core/io/workers";

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

  test("tombstoned host cannot publish after cancellation", () => {
    const tx = new HostTransaction();
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
    tx.cancel();

    expect(() => tx.publish()).toThrow(TransactionCancelledError);
    expect(tx.state).toBe("rolled-back");
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

  test("admission rejects resident-memory overflow and records long tasks", () => {
    const worker = new WorkerStateMachine({
      memoryProfile: "D1",
      maxResidentBytes: 64,
      maxRenderBufferBytes: 64,
      maxTaskMs: 50,
    });
    expect(() =>
      worker.admitProgress({
        stage: "decode",
        consumedBytes: 1,
        producedBytes: 1,
        completedItems: 0,
        totalItems: null,
        estimatedResidentBytes: 65,
      }),
    ).toThrow("D1 admission");
    worker.admitProgress({
      stage: "decode",
      consumedBytes: 1,
      producedBytes: 1,
      completedItems: 0,
      totalItems: null,
      estimatedResidentBytes: 64,
    });
    worker.recordLongTask(50);
    worker.recordLongTask(51);
    expect(worker.longTaskBudget()).toEqual({
      maxTaskMs: 50,
      taskCount: 2,
      overBudgetCount: 1,
      totalTaskMs: 101,
      maxObservedTaskMs: 51,
    });
    expect(worker.admitRenderBuffer(4, 4)).toBe(64);
    expect(() => worker.admitRenderBuffer(5, 5)).toThrow(WorkerMemoryPressureError);
  });

  test("named profiles default to a 50ms long-task budget", () => {
    const worker = new WorkerStateMachine({ memoryProfile: "M1", maxResidentBytes: 128 });
    worker.recordLongTask(50);
    expect(worker.longTaskBudget()).toMatchObject({
      maxTaskMs: 50,
      taskCount: 1,
      overBudgetCount: 0,
    });
    expect(() => new WorkerStateMachine({ memoryProfile: "unknown", maxResidentBytes: 128 })).toThrow(
      "unsupported memory profile",
    );
  });

  test("render buffer admission has its own bound within resident memory", () => {
    const worker = new WorkerStateMachine({
      memoryProfile: "D1",
      maxResidentBytes: 128,
      maxRenderBufferBytes: 64,
    });
    expect(worker.admitRenderBuffer(4, 4)).toBe(64);
    expect(() => worker.admitRenderBuffer(5, 4)).toThrow("render buffer exceeds D1 admission");
    expect(
      () =>
        new WorkerStateMachine({
          memoryProfile: "D1",
          maxResidentBytes: 64,
          maxRenderBufferBytes: 65,
        }),
    ).toThrow("maxRenderBufferBytes exceeds maxResidentBytes");
  });

  test("worker admits incremental input without retaining prior chunks", () => {
    const worker = new WorkerStateMachine({
      memoryProfile: "D1",
      maxResidentBytes: 4,
      maxInputBytes: 6,
    });
    worker.ready();
    worker.beginInput();
    worker.receiveInput({
      ...chunk(0),
      byteLength: 2,
      offset: 0,
      final: false,
      bytes: new Uint8Array([0, 1]),
    });
    worker.receiveInput({
      ...chunk(1),
      byteLength: 2,
      offset: 2,
      final: false,
      bytes: new Uint8Array([2, 3]),
    });
    worker.receiveInput({
      ...chunk(2),
      byteLength: 2,
      offset: 4,
      final: true,
      bytes: new Uint8Array([4, 5]),
    });
    worker.finishInput();
    expect(worker.state).toBe("validating");
  });

  test("worker rejects non-contiguous or over-admission incremental input", () => {
    const worker = new WorkerStateMachine({
      memoryProfile: "D1",
      maxResidentBytes: 4,
      maxInputBytes: 3,
    });
    worker.ready();
    worker.beginInput();
    expect(() =>
      worker.receiveInput({
        ...chunk(0),
        byteLength: 1,
        offset: 1,
        bytes: new Uint8Array([0]),
      }),
    ).toThrow("input offset gap");
    worker.receiveInput({
      ...chunk(0),
      byteLength: 2,
      offset: 0,
      final: false,
      bytes: new Uint8Array([0, 1]),
    });
    expect(() =>
      worker.receiveInput({
        ...chunk(1),
        byteLength: 2,
        offset: 2,
        final: true,
        bytes: new Uint8Array([2, 3]),
      }),
    ).toThrow("maxInputBytes admission");
  });

  test("host rejects input above declared admission before staging", () => {
    const tx = new HostTransaction();
    expect(() =>
      tx.begin({
        operation: "decode-raster",
        memoryProfile: "D1",
        protocolCapabilities: [],
        inputManifestHash: digest,
        expectedInputBytes: 65,
        expectedOutputClass: "raster",
        replayable: true,
        maxInputBytes: 64,
      }),
    ).toThrow("exceeds maxInputBytes");
  });
});

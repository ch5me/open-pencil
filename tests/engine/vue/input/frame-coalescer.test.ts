import { describe, expect, test } from "bun:test";

import {
  createRafCoalescer,
  createRafInputController,
  createScrubSession,
} from "#vue/shared/input/raf-scheduler";

function scheduler() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  return {
    request: (callback: () => void) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel: (id: number) => {
      callbacks.delete(id);
    },
    flush: () => {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback();
    },
    get pendingCount() {
      return callbacks.size;
    },
  };
}

describe("frame coalescer", () => {
  test("keeps one frame and consumes the latest value", () => {
    const frames = scheduler();
    const values: number[] = [];
    const coalescer = createRafCoalescer(
      (value: number) => values.push(value),
      undefined,
      frames.request,
      frames.cancel,
    );

    coalescer.push(1);
    coalescer.push(2);
    expect(frames.pendingCount).toBe(1);
    expect(values).toEqual([]);

    frames.flush();
    expect(values).toEqual([2]);
  });

  test("merges pointer deltas and flushes final work immediately", () => {
    const frames = scheduler();
    const deltas: number[] = [];
    const coalescer = createRafCoalescer(
      (value: number) => deltas.push(value),
      (pending, next) => pending + next,
      frames.request,
      frames.cancel,
    );

    coalescer.push(3);
    coalescer.push(-1);
    coalescer.flush();
    expect(deltas).toEqual([2]);
    coalescer.cancel();
    expect(frames.pendingCount).toBe(0);
  });

  test("cancel drops pending work", () => {
    const frames = scheduler();
    const values: number[] = [];
    const coalescer = createRafCoalescer(
      (value: number) => values.push(value),
      undefined,
      frames.request,
      frames.cancel,
    );

    coalescer.push(1);
    coalescer.cancel();
    frames.flush();
    expect(values).toEqual([]);
  });

  test("flush cancels the old frame before accepting new work", () => {
    const frames = scheduler();
    const values: number[] = [];
    const coalescer = createRafCoalescer(
      (value: number) => values.push(value),
      undefined,
      frames.request,
      frames.cancel,
    );

    coalescer.push(1);
    coalescer.flush();
    coalescer.push(2);
    expect(frames.pendingCount).toBe(1);
    frames.flush();

    expect(values).toEqual([1, 2]);
  });

  test("empty flush is a no-op and does not schedule work", () => {
    const frames = scheduler();
    const values: number[] = [];
    const coalescer = createRafCoalescer(
      (value: number) => values.push(value),
      undefined,
      frames.request,
      frames.cancel,
    );

    coalescer.flush();
    expect(values).toEqual([]);
    expect(frames.pendingCount).toBe(0);
  });

  test("consuming a value can queue the next value for a later frame", () => {
    const frames = scheduler();
    const values: number[] = [];
    const coalescer = createRafCoalescer(
      (value: number) => {
        values.push(value);
        if (value === 1) coalescer.push(2);
      },
      undefined,
      frames.request,
      frames.cancel,
    );

    coalescer.push(1);
    frames.flush();
    expect(values).toEqual([1]);
    expect(frames.pendingCount).toBe(1);

    frames.flush();
    expect(values).toEqual([1, 2]);
  });

  test("input change flushes synchronously and cancels the scheduled frame", () => {
    const frames = scheduler();
    const values: number[] = [];
    const input = createRafInputController(
      (value: number) => values.push(value),
      undefined,
      frames.request,
      frames.cancel,
    );

    input.input(4);
    input.change();
    expect(values).toEqual([4]);
    expect(frames.pendingCount).toBe(0);
    frames.flush();
    expect(values).toEqual([4]);
  });

  test("input cancellation prevents late work after unmount", () => {
    const frames = scheduler();
    const values: number[] = [];
    const input = createRafInputController(
      (value: number) => values.push(value),
      undefined,
      frames.request,
      frames.cancel,
    );

    input.input(4);
    input.cancel();
    frames.flush();
    expect(values).toEqual([]);
  });

  test("scrub session preserves fractional movement across scheduled frames", () => {
    const frames = scheduler();
    const updates: number[] = [];
    const commits: Array<[number, number]> = [];
    const scrub = createScrubSession(
      0,
      0,
      10,
      0.25,
      (value) => updates.push(value),
      (value, previous) => commits.push([value, previous]),
      frames.request,
      frames.cancel,
    );

    for (let index = 0; index < 4; index++) {
      scrub.move(1);
      frames.flush();
    }
    scrub.finish();

    expect(updates).toEqual([1]);
    expect(commits).toEqual([[1, 0]]);
    expect(frames.pendingCount).toBe(0);
  });

  test("scrub finish flushes final movement before commit", () => {
    const frames = scheduler();
    const updates: number[] = [];
    const commits: Array<[number, number]> = [];
    const scrub = createScrubSession(
      0,
      0,
      10,
      1,
      (value) => updates.push(value),
      (value, previous) => commits.push([value, previous]),
      frames.request,
      frames.cancel,
    );

    scrub.move(3);
    scrub.finish();

    expect(updates).toEqual([3]);
    expect(commits).toEqual([[3, 0]]);
    expect(frames.pendingCount).toBe(0);
  });

  test("scrub cancellation restores the initial value and prevents late work", () => {
    const frames = scheduler();
    const updates: number[] = [];
    const commits: Array<[number, number]> = [];
    const scrub = createScrubSession(
      2,
      0,
      10,
      1,
      (value) => updates.push(value),
      (value, previous) => commits.push([value, previous]),
      frames.request,
      frames.cancel,
    );

    scrub.move(3);
    frames.flush();
    scrub.move(2);
    scrub.cancel();
    frames.flush();

    expect(updates).toEqual([5, 2]);
    expect(commits).toEqual([]);
    expect(frames.pendingCount).toBe(0);
  });
});

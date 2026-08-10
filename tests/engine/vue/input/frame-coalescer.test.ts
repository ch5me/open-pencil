import { describe, expect, test } from "bun:test";

import {
  createRafCoalescer,
  createScrubAccumulator,
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

  test("scrub accumulator preserves fractional movement across frames", () => {
    const values: number[] = [];
    const accumulator = createScrubAccumulator(0, 0, 10, 0.25, (value) => values.push(value));

    accumulator.add(1);
    accumulator.add(1);
    accumulator.add(1);
    accumulator.add(1);

    expect(accumulator.value()).toBe(1);
    expect(values).toEqual([1]);
  });

  test("scrub accumulator suppresses duplicate clamped values", () => {
    const values: number[] = [];
    const accumulator = createScrubAccumulator(0, 0, 1, 1, (value) => values.push(value));

    accumulator.add(1);
    accumulator.add(1);
    accumulator.add(1);

    expect(accumulator.value()).toBe(1);
    expect(values).toEqual([1]);
  });
});

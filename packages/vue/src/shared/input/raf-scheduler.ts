export function createRafScheduler(flush: () => void) {
  let rafId = 0;

  function schedule() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      flush();
    });
  }

  function cancel() {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  return { schedule, cancel };
}

export function createRafCoalescer<T>(
  consume: (value: T) => void,
  merge: (pending: T, next: T) => T = (_, next) => next,
  request: (callback: () => void) => number = (callback) => requestAnimationFrame(callback),
  cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
) {
  let pending: { value: T } | undefined;
  let frameId: number | null = null;

  function flush() {
    if (frameId !== null) cancel(frameId);
    frameId = null;
    if (!pending) return;
    const value = pending.value;
    pending = undefined;
    consume(value);
  }

  return {
    push(value: T) {
      pending = pending ? { value: merge(pending.value, value) } : { value };
      if (frameId === null) frameId = request(flush);
    },
    flush,
    cancel() {
      if (frameId !== null) cancel(frameId);
      frameId = null;
      pending = undefined;
    },
  };
}

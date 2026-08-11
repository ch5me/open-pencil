import { describe, expect, test } from "bun:test";

import { createCanvasContextRecovery } from "#vue/canvas/surface/context-recovery";

function canvas() {
  return new EventTarget() as HTMLCanvasElement;
}

describe("canvas context recovery", () => {
  test("prevents default on loss and restores once", () => {
    const target = canvas();
    let restored = 0;
    const recovery = createCanvasContextRecovery({
      getCanvas: () => target,
      isDestroyed: () => false,
      onRestored: () => {
        restored++;
      },
    });
    recovery.bind(target);

    const lost = new Event("webglcontextlost", { cancelable: true });
    target.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(recovery.isLost()).toBe(true);

    target.dispatchEvent(new Event("webglcontextrestored"));
    target.dispatchEvent(new Event("webglcontextrestored"));
    expect(restored).toBe(1);
    expect(recovery.isLost()).toBe(false);
  });

  test("ignores restoration after destruction and removes listeners", () => {
    const target = canvas();
    let destroyed = false;
    let restored = 0;
    const recovery = createCanvasContextRecovery({
      getCanvas: () => target,
      isDestroyed: () => destroyed,
      onRestored: () => {
        restored++;
      },
    });
    recovery.bind(target);
    target.dispatchEvent(new Event("webglcontextlost"));
    destroyed = true;
    target.dispatchEvent(new Event("webglcontextrestored"));
    expect(restored).toBe(0);

    recovery.unbind();
    destroyed = false;
    target.dispatchEvent(new Event("webglcontextlost"));
    target.dispatchEvent(new Event("webglcontextrestored"));
    expect(restored).toBe(0);
  });
});

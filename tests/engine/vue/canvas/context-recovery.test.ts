import { describe, expect, mock, test } from "bun:test";

import type { CanvasKit, Surface } from "canvaskit-wasm";

import type { SkiaRenderer } from "#core/canvas";
import { createEditor } from "#core/editor";
import { createCanvasContextRecovery } from "#vue/canvas/surface/context-recovery";
import { createCanvasSurfaceManager } from "#vue/canvas/surface/lifecycle";

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

  test("recreates WebGL2 resources for 20 loss/restart cycles without leaks", () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
    globalThis.cancelAnimationFrame = () => undefined;

    let contextsCreated = 0;
    let contextsDeleted = 0;
    let handlesDeleted = 0;
    let renderersCreated = 0;
    let renderersDestroyed = 0;
    let activeRenderers = 0;
    const target = Object.assign(new EventTarget(), {
      clientWidth: 800,
      clientHeight: 600,
      width: 0,
      height: 0,
      dataset: {} as DOMStringMap,
      getContext: (kind: string) => (kind === "webgl2" ? ({} as WebGL2RenderingContext) : null),
    }) as HTMLCanvasElement;
    const ck = {
      ColorSpace: { SRGB: "srgb", DISPLAY_P3: "display-p3" },
      GetWebGLContext: () => ++contextsCreated,
      MakeGrContext: () => ({
        delete: () => {
          contextsDeleted++;
        },
      }),
      deleteContext: () => {
        handlesDeleted++;
      },
      MakeOnScreenGLSurface: () => ({ delete: () => undefined }) as Surface,
    };
    const editor = createEditor();
    editor.removeCanvasRenderer = mock(() => {
      activeRenderers--;
    });
    editor.setCanvasKit = mock(() => {
      activeRenderers++;
    });
    const manager = createCanvasSurfaceManager({
      editor,
      canvasRef: { value: target },
      getCanvasKit: () => ck as CanvasKit,
      isDestroyed: () => false,
      shouldShowRulers: () => false,
      createRenderer: () => {
        renderersCreated++;
        return {
          destroy: () => {
            renderersDestroyed++;
          },
          renderFromEditorState: () => undefined,
          loadFonts: async () => undefined,
          sceneBackingNeedsCrispRender: false,
          sceneBackingPreviewUntil: 0,
        } as SkiaRenderer;
      },
    });

    try {
      expect(manager.createSurface(target)).toBe(true);
      expect(manager.getBackend()).toBe("webgl2");
      expect(target.dataset.rendererBackend).toBe("webgl2");

      for (let cycle = 1; cycle <= 20; cycle += 1) {
        const lost = new Event("webglcontextlost", { cancelable: true });
        target.dispatchEvent(lost);
        expect(lost.defaultPrevented).toBe(true);
        expect(manager.getBackend()).toBeNull();
        expect(activeRenderers).toBe(0);
        expect(target.dataset.surfaceError).toBe("webgl-context-lost");

        target.dispatchEvent(new Event("webglcontextrestored"));
        expect(manager.getBackend()).toBe("webgl2");
        expect(manager.getResourceGeneration()).toBe(cycle);
        expect(activeRenderers).toBe(1);
        expect(target.dataset.rendererBackend).toBe("webgl2");
        expect(target.dataset.surfaceError).toBeUndefined();
      }

      expect(manager.getLifecycleStats()).toEqual({
        backend: "webgl2",
        contextLosses: 20,
        contextRestorations: 20,
        contextsCreated: 21,
        contextsDeleted: 20,
        renderersCreated: 21,
        renderersDeleted: 20,
        resourceGeneration: 20,
      });
      manager.destroy();
      expect(activeRenderers).toBe(0);
      expect(renderersCreated).toBe(21);
      expect(renderersDestroyed).toBe(renderersCreated);
      expect(contextsCreated).toBe(21);
      expect(contextsDeleted).toBe(contextsCreated);
      expect(handlesDeleted).toBe(contextsCreated);
      expect(manager.getLifecycleStats()).toEqual({
        backend: null,
        contextLosses: 20,
        contextRestorations: 20,
        contextsCreated: 21,
        contextsDeleted: 21,
        renderersCreated: 21,
        renderersDeleted: 21,
        resourceGeneration: 20,
      });
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });
});

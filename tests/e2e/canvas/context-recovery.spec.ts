import { expect, test, useEditorSetupWithClear as setupEditor } from "#tests/e2e/fixtures";

const editor = setupEditor("/?test&no-chrome&no-rulers");

test.setTimeout(60_000);

async function cycleWebGL2Context(testId: string, cycles: number) {
  return editor.page.getByTestId(testId).evaluate(
    async (element, options) => {
      const canvas = element as HTMLCanvasElement;
      const gl = canvas.getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_lose_context");
      if (!gl || !extension) {
        throw new Error(`${options.testId} has no WEBGL_lose_context support`);
      }

      const waitForEvent = (type: "webglcontextlost" | "webglcontextrestored") =>
        new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error(`${options.testId} timed out waiting for ${type}`)),
            5_000,
          );
          canvas.addEventListener(
            type,
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        });

      for (let cycle = 1; cycle <= options.cycles; cycle += 1) {
        const lost = waitForEvent("webglcontextlost");
        extension.loseContext();
        await lost;
        if (canvas.dataset.ready !== undefined) {
          throw new Error(`${options.testId} kept stale data-ready after loss ${cycle}`);
        }

        await new Promise((resolve) => {
          setTimeout(resolve, 50);
        });
        const restored = waitForEvent("webglcontextrestored");
        extension.restoreContext();
        await restored;
        await new Promise(requestAnimationFrame);
        if (canvas.dataset.ready !== "1" || Number(canvas.dataset.resourceGeneration) !== cycle) {
          throw new Error(`${options.testId} failed recreation cycle ${cycle}`);
        }
      }

      return {
        backend: canvas.dataset.rendererBackend,
        contextLosses: Number(canvas.dataset.contextLosses),
        contextRestorations: Number(canvas.dataset.contextRestorations),
        contextsCreated: Number(canvas.dataset.contextsCreated),
        contextsDeleted: Number(canvas.dataset.contextsDeleted),
        renderersCreated: Number(canvas.dataset.renderersCreated),
        renderersDeleted: Number(canvas.dataset.renderersDeleted),
        resourceGeneration: Number(canvas.dataset.resourceGeneration),
      };
    },
    { cycles, testId },
  );
}

test("WebGL2 scene and overlay resources survive 20 context loss cycles", async () => {
  const sceneCanvas = editor.page.getByTestId("scene-canvas-element");
  const overlayCanvas = editor.page.getByTestId("canvas-element");
  const blankScene = await sceneCanvas.screenshot();
  const blankOverlay = await overlayCanvas.screenshot();
  await editor.page.evaluate(() => {
    const OriginalWorker = window.Worker;
    let created = 0;
    let terminated = 0;
    window.Worker = class extends OriginalWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        created++;
      }

      override terminate() {
        terminated++;
        super.terminate();
      }
    };
    Object.assign(window, {
      getContextRecoveryWorkerCounts: () => ({ created, terminated }),
    });
  });

  for (const testId of ["scene-canvas-element", "canvas-element"]) {
    const report = await cycleWebGL2Context(testId, 20);
    expect(report).toEqual({
      backend: "webgl2",
      contextLosses: 20,
      contextRestorations: 20,
      contextsCreated: 21,
      contextsDeleted: 20,
      renderersCreated: 21,
      renderersDeleted: 20,
      resourceGeneration: 20,
    });
    expect(report.contextsCreated - report.contextsDeleted).toBe(1);
    expect(report.renderersCreated - report.renderersDeleted).toBe(1);
  }

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.();
    if (!store) throw new Error("OpenPencil store not initialized");
    const rectangle = store.graph.createNode("RECTANGLE", store.state.currentPageId, {
      name: "Post-restore edit",
      x: 96,
      y: 80,
      width: 240,
      height: 160,
      cornerRadius: 20,
      fills: [
        { type: "SOLID", color: { r: 0.08, g: 0.73, b: 0.73, a: 1 }, visible: true, opacity: 1 },
      ],
    });
    store.select([rectangle.id]);
    store.requestRender();
  });
  await editor.canvas.waitForRender();

  const restoredScene = await sceneCanvas.screenshot();
  const restoredOverlay = await overlayCanvas.screenshot();
  const workerCounts = await editor.page.evaluate(() => {
    const trackedWindow = window as typeof window & {
      getContextRecoveryWorkerCounts?: () => { created: number; terminated: number };
    };
    return trackedWindow.getContextRecoveryWorkerCounts?.();
  });
  expect(restoredScene.equals(blankScene)).toBe(false);
  expect(restoredOverlay.equals(blankOverlay)).toBe(false);
  expect(workerCounts).toEqual({ created: 0, terminated: 0 });
  editor.canvas.assertNoErrors();
});

import { afterEach, expect, test } from "bun:test";

import { RasterWorkerFontUnavailableError, renderRasterViaWorker } from "#core/io/formats/raster";
import { IOCancelledError } from "#core/io/limits";
import { SceneGraph } from "#core/scene-graph";
import { fontManager } from "#core/text/fonts";

const originalWorker = globalThis.Worker;
const originalFetch = globalThis.fetch;
const originalCreateExportSnapshot = fontManager.createExportSnapshot;

afterEach(() => {
  Object.assign(globalThis, { Worker: originalWorker, fetch: originalFetch });
  fontManager.createExportSnapshot = originalCreateExportSnapshot;
  fontManager.setDownloadedFontCache(null);
});

function graphWithImage() {
  const graph = new SceneGraph();
  const page = graph.getPages()[0];
  const image = new Uint8Array([1, 2, 3, 4]);
  graph.images.set("image", image);
  const node = graph.createNode("RECTANGLE", page.id, { width: 10, height: 10 });
  return { graph, image, pageId: page.id, nodeId: node.id };
}

async function waitForWorkerDispatch(): Promise<void> {
  await Bun.sleep(0);
}

test("pre-cancelled raster export never dispatches", async () => {
  let constructed = false;
  class FakeWorker {
    constructor() {
      constructed = true;
    }
    postMessage() {
      throw new Error("unexpected dispatch");
    }
    terminate() {
      throw new Error("unexpected termination");
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker });

  const controller = new AbortController();
  controller.abort();
  const { graph, pageId, nodeId } = graphWithImage();

  await expect(
    Promise.resolve().then(() =>
      renderRasterViaWorker(graph, pageId, [nodeId], { format: "PNG" }, controller.signal),
    ),
  ).rejects.toBeInstanceOf(IOCancelledError);
  expect(constructed).toBe(false);
});

test("abort terminates active raster work and ignores late settlement", async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;

    constructor() {
      workers.push(this);
    }

    postMessage() {
      return undefined;
    }

    terminate() {
      this.terminated = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker });

  const controller = new AbortController();
  const { graph, pageId, nodeId } = graphWithImage();
  const exporting = renderRasterViaWorker(
    graph,
    pageId,
    [nodeId],
    { format: "PNG" },
    controller.signal,
  );
  await waitForWorkerDispatch();
  controller.abort();

  await expect(exporting).rejects.toBeInstanceOf(IOCancelledError);
  expect(workers[0]?.terminated).toBe(true);
  workers[0]?.onmessage?.({ data: { bytes: new Uint8Array([9]) } } as MessageEvent);
  workers[0]?.onerror?.({ message: "late error" } as ErrorEvent);
});

test("abort during font acquisition settles immediately and never dispatches late load", async () => {
  let constructed = false;
  let resolveFonts: (() => void) | undefined;
  fontManager.createExportSnapshot = () =>
    new Promise((resolve) => {
      resolveFonts = () => resolve({ fonts: [], fallbackFamilies: { cjk: [], arabic: [] } });
    });
  function FakeWorker() {
    constructed = true;
  }
  Object.assign(globalThis, { Worker: FakeWorker });

  const controller = new AbortController();
  const { graph, pageId, nodeId } = graphWithImage();
  const exporting = renderRasterViaWorker(
    graph,
    pageId,
    [nodeId],
    { format: "PNG" },
    controller.signal,
  );
  controller.abort();

  await expect(exporting).rejects.toBeInstanceOf(IOCancelledError);
  expect(constructed).toBe(false);
  resolveFonts?.();
  await waitForWorkerDispatch();
  expect(constructed).toBe(false);
});

test("timeout terminates raster work", async () => {
  let terminated = false;
  class FakeWorker {
    onmessage = null;
    onerror = null;
    postMessage() {
      return undefined;
    }
    terminate() {
      terminated = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker });

  const { graph, pageId, nodeId } = graphWithImage();
  await expect(
    renderRasterViaWorker(graph, pageId, [nodeId], { format: "PNG" }, undefined, 1),
  ).rejects.toBeInstanceOf(IOCancelledError);
  expect(terminated).toBe(true);
});

test("timeout still terminates raster work with a caller signal", async () => {
  let terminated = false;
  class FakeWorker {
    onmessage = null;
    onerror = null;
    postMessage() {
      return undefined;
    }
    terminate() {
      terminated = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker });

  const controller = new AbortController();
  const { graph, pageId, nodeId } = graphWithImage();
  await expect(
    renderRasterViaWorker(graph, pageId, [nodeId], { format: "PNG" }, controller.signal, 1),
  ).rejects.toBeInstanceOf(IOCancelledError);
  expect(controller.signal.aborted).toBe(false);
  expect(terminated).toBe(true);
});

test("cancelled font acquisition cannot mutate loaded font state after settling", async () => {
  let resolveCache: ((data: ArrayBuffer) => void) | undefined;
  fontManager.setDownloadedFontCache({
    read: () =>
      new Promise((resolve) => {
        resolveCache = resolve;
      }),
    write: () => Promise.resolve(),
  });

  const graph = new SceneGraph();
  const page = graph.getPages()[0];
  const family = `LateCancelledExport_${Date.now()}`;
  const text = graph.createNode("TEXT", page.id, {
    text: "Cancelled",
    fontFamily: family,
    fontWeight: 400,
  });
  const controller = new AbortController();
  const exporting = renderRasterViaWorker(
    graph,
    page.id,
    [text.id],
    { format: "PNG" },
    controller.signal,
  );
  controller.abort();

  await expect(exporting).rejects.toBeInstanceOf(IOCancelledError);
  resolveCache?.(new Uint8Array([0, 1, 0, 0, 7, 8, 9, 10]).buffer);
  await waitForWorkerDispatch();
  expect(fontManager.isStyleLoaded(family, "Regular")).toBe(false);
});

test("concurrent raster exports stay caller-owned without detaching editor bytes", async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror = null;
    terminated = false;
    transfer: Transferable[] | undefined;

    constructor() {
      workers.push(this);
    }

    postMessage(_request: unknown, transfer: Transferable[]) {
      this.transfer = transfer;
    }

    terminate() {
      this.terminated = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker });

  const firstInput = graphWithImage();
  const first = renderRasterViaWorker(firstInput.graph, firstInput.pageId, [firstInput.nodeId], {
    format: "PNG",
  });
  const secondInput = graphWithImage();
  const second = renderRasterViaWorker(
    secondInput.graph,
    secondInput.pageId,
    [secondInput.nodeId],
    { format: "PNG" },
  );
  await waitForWorkerDispatch();

  expect(workers[0].terminated).toBe(false);
  expect(workers[0].transfer).toEqual([]);
  expect(firstInput.image).toEqual(new Uint8Array([1, 2, 3, 4]));

  workers[0].onmessage?.({ data: { bytes: new Uint8Array([3, 4]) } } as MessageEvent);
  workers[1].onmessage?.({ data: { bytes: new Uint8Array([5, 6]) } } as MessageEvent);
  await expect(first).resolves.toEqual(new Uint8Array([3, 4]));
  await expect(second).resolves.toEqual(new Uint8Array([5, 6]));
});

test("worker request carries exact loaded custom font bytes without detaching them", async () => {
  let request:
    | {
        fontSnapshot?: {
          fonts: Array<{ family: string; style: string; data: ArrayBuffer }>;
        };
      }
    | undefined;
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror = null;

    constructor() {
      workers.push(this);
    }

    postMessage(value: typeof request) {
      request = value;
    }

    terminate() {
      return undefined;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker });

  const graph = new SceneGraph();
  const page = graph.getPages()[0];
  const family = `CustomExport_${Date.now()}`;
  const bytes = new Uint8Array([0, 1, 0, 0, 7, 8, 9, 10]).buffer;
  const text = graph.createNode("TEXT", page.id, {
    text: "Custom",
    fontFamily: family,
    fontWeight: 400,
  });
  fontManager.markLoaded(family, "Regular", bytes);

  const exporting = renderRasterViaWorker(graph, page.id, [text.id], { format: "PNG" });
  await waitForWorkerDispatch();
  expect(request?.fontSnapshot?.fonts).toHaveLength(1);
  expect(request?.fontSnapshot?.fonts[0]).toEqual({ family, style: "Regular", data: bytes });
  expect(bytes.byteLength).toBe(8);

  workers[0]?.onmessage?.({ data: { bytes: new Uint8Array([1]) } } as MessageEvent);
  await exporting;
});

test("text export fails loud when exact font bytes are unavailable", async () => {
  let constructed = false;
  class FakeWorker {
    constructor() {
      constructed = true;
    }
    postMessage() {
      throw new Error("unexpected dispatch");
    }
    terminate() {
      throw new Error("unexpected termination");
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker });
  Reflect.deleteProperty(globalThis, "fetch");

  const graph = new SceneGraph();
  const page = graph.getPages()[0];
  const family = `UnavailableExport_${Date.now()}`;
  const text = graph.createNode("TEXT", page.id, {
    text: "Missing",
    fontFamily: family,
    fontWeight: 400,
  });

  await expect(
    renderRasterViaWorker(graph, page.id, [text.id], { format: "PNG" }),
  ).rejects.toBeInstanceOf(RasterWorkerFontUnavailableError);
  expect(constructed).toBe(false);
});

test("dispatch failure terminates worker", async () => {
  let terminated = false;
  class FakeWorker {
    onmessage = null;
    onerror = null;
    postMessage() {
      throw new Error("post failed");
    }
    terminate() {
      terminated = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker });

  const { graph, pageId, nodeId } = graphWithImage();
  await expect(renderRasterViaWorker(graph, pageId, [nodeId], { format: "PNG" })).rejects.toThrow(
    "post failed",
  );
  expect(terminated).toBe(true);
});

test("serialization failure terminates worker and removes caller listener", async () => {
  let terminated = false;
  class FakeWorker {
    onmessage = null;
    onerror = null;
    postMessage() {
      throw new Error("unexpected dispatch");
    }
    terminate() {
      terminated = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker });

  const controller = new AbortController();
  let listeners = 0;
  const addEventListener = controller.signal.addEventListener.bind(controller.signal);
  const removeEventListener = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = ((...args: Parameters<AbortSignal["addEventListener"]>) => {
    listeners++;
    return addEventListener(...args);
  }) as AbortSignal["addEventListener"];
  controller.signal.removeEventListener = ((
    ...args: Parameters<AbortSignal["removeEventListener"]>
  ) => {
    listeners--;
    return removeEventListener(...args);
  }) as AbortSignal["removeEventListener"];

  const { graph, pageId, nodeId } = graphWithImage();
  class ThrowingMap<K, V> extends Map<K, V> {
    override [Symbol.iterator](): MapIterator<[K, V]> {
      throw new Error("serialize failed");
    }
  }
  graph.nodes = new ThrowingMap(graph.nodes);

  await expect(
    renderRasterViaWorker(graph, pageId, [nodeId], { format: "PNG" }, controller.signal),
  ).rejects.toThrow("serialize failed");
  expect(terminated).toBe(true);
  expect(listeners).toBe(0);
});

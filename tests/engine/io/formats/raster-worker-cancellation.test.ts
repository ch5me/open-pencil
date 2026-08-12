import { afterEach, expect, test } from "bun:test";

import { renderRasterViaWorker } from "#core/io/formats/raster";
import { IOCancelledError } from "#core/io/limits";
import { SceneGraph } from "#core/scene-graph";

const originalWorker = globalThis.Worker;

afterEach(() => {
  Object.assign(globalThis, { Worker: originalWorker });
});

function graphWithImage() {
  const graph = new SceneGraph();
  const page = graph.getPages()[0];
  const image = new Uint8Array([1, 2, 3, 4]);
  graph.images.set("image", image);
  const node = graph.createNode("RECTANGLE", page.id, { width: 10, height: 10 });
  return { graph, image, pageId: page.id, nodeId: node.id };
}

test("pre-cancelled raster export never dispatches", async () => {
  let constructed = false;
  class FakeWorker {
    constructor() {
      constructed = true;
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
  let worker: FakeWorker | undefined;
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;

    constructor() {
      worker = this;
    }

    postMessage() {}

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
  controller.abort();

  await expect(exporting).rejects.toBeInstanceOf(IOCancelledError);
  expect(worker?.terminated).toBe(true);
  worker?.onmessage?.({ data: { bytes: new Uint8Array([9]) } } as MessageEvent);
  worker?.onerror?.({ message: "late error" } as ErrorEvent);
});

test("timeout terminates raster work", async () => {
  let terminated = false;
  class FakeWorker {
    onmessage = null;
    onerror = null;
    postMessage() {}
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

test("new raster export cancels overlap without detaching editor bytes", async () => {
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

  await expect(first).rejects.toBeInstanceOf(IOCancelledError);
  expect(workers[0].terminated).toBe(true);
  expect(workers[0].transfer).toEqual([]);
  expect(firstInput.image).toEqual(new Uint8Array([1, 2, 3, 4]));

  workers[1].onmessage?.({ data: { bytes: new Uint8Array([5, 6]) } } as MessageEvent);
  await expect(second).resolves.toEqual(new Uint8Array([5, 6]));
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

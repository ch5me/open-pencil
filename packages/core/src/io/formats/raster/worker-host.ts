import { IS_BROWSER } from "#core/constants";
import { IOCancelledError, throwIfIOCancelled } from "#core/io/limits";
import { serializeSceneGraph } from "#core/kiwi/fig/parse/transfer";
import type { SceneGraph } from "#core/scene-graph";
import { fontManager } from "#core/text/fonts";

import type {
  RasterWorkerOptions,
  RasterWorkerRequest,
  RasterWorkerResponse,
} from "./worker-protocol";

const RASTER_EXPORT_TIMEOUT_MS = 60_000;

export type { RasterWorkerOptions } from "./worker-protocol";

export class RasterWorkerFontUnavailableError extends Error {
  override name = "RasterWorkerFontUnavailableError";
}

export function canUseRasterExportWorker(): boolean {
  return IS_BROWSER && typeof Worker !== "undefined";
}

function canvasKitWasmUrl(): string {
  if (typeof location !== "undefined") {
    const base = "env" in import.meta ? import.meta.env.BASE_URL : "/";
    const prefix = base === "/" ? "" : base.replace(/\/$/, "");
    return new URL(`${prefix}/canvaskit.wasm`, location.origin).href;
  }
  const ckPath = import.meta.resolve("canvaskit-wasm/full");
  return new URL("../bin/full/canvaskit.wasm", ckPath).href;
}

export async function renderRasterViaWorker(
  graph: SceneGraph,
  pageId: string,
  nodeIds: string[],
  options: RasterWorkerOptions,
  signal?: AbortSignal,
  timeoutMs = RASTER_EXPORT_TIMEOUT_MS,
): Promise<Uint8Array | null> {
  throwIfIOCancelled(signal);
  const fontKeys = fontManager.collectFontKeys(graph, nodeIds);
  await Promise.all(fontKeys.map(([family, style]) => fontManager.loadFont(family, style)));
  const fonts = fontManager.loadedDataForGraph(graph, nodeIds);
  if (fonts.length !== fontKeys.length) {
    const loaded = new Set(fonts.map(({ family, style }) => `${family}\0${style}`));
    const missing = fontKeys
      .filter(([family, style]) => !loaded.has(`${family}\0${style}`))
      .map(([family, style]) => `"${family}" ${style}`)
      .join(", ");
    throw new RasterWorkerFontUnavailableError(
      `Abortable raster export requires loaded font bytes: ${missing}`,
    );
  }
  throwIfIOCancelled(signal);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      if (timeout) clearTimeout(timeout);
      worker.terminate();
      callback();
    };
    const cancelWith = (message: string) => {
      finish(() => reject(new IOCancelledError(message)));
    };
    const cancel = () => cancelWith("IO export cancelled");

    worker.onmessage = (event: MessageEvent<RasterWorkerResponse>) => {
      finish(() => {
        if (signal?.aborted) {
          reject(new IOCancelledError("IO export cancelled"));
        } else if (event.data.error) {
          reject(new Error(event.data.error));
        } else if (event.data.bytes instanceof Uint8Array) {
          resolve(event.data.bytes);
        } else {
          resolve(null);
        }
      });
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || "Raster export worker failed")));
    };

    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    timeout = setTimeout(() => cancelWith("IO export timed out"), timeoutMs);

    const request: RasterWorkerRequest = {
      graph: serializeSceneGraph(graph),
      pageId,
      nodeIds: [...nodeIds],
      options,
      canvasKitWasmUrl: canvasKitWasmUrl(),
      fonts,
    };
    try {
      // Structured clone preserves caller-owned image and document buffers.
      worker.postMessage(request, []);
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

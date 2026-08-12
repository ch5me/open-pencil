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

function waitForAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new IOCancelledError("IO export cancelled"));
  let rejectAbort: (error: IOCancelledError) => void = () => undefined;
  const cancel = () => rejectAbort(new IOCancelledError("IO export cancelled"));
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  signal.addEventListener("abort", cancel, { once: true });
  return Promise.race([promise, aborted]).finally(() =>
    signal.removeEventListener("abort", cancel),
  );
}

function canvasKitWasmUrl(): string {
  if (typeof location !== "undefined") {
    const base = "env" in import.meta ? import.meta.env.BASE_URL : "/";
    const prefix = base === "/" ? "" : base.replace(/\/$/, "");
    return new URL(`${prefix}/canvaskit.wasm`, location.origin).href;
  }
  const ckPath = import.meta.resolve("canvaskit-wasm/full");
  return new URL("canvaskit.wasm", ckPath).href;
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
  const exportController = new AbortController();
  const cancel = () => exportController.abort();
  const deadlineTimer = setTimeout(cancel, timeoutMs);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const exportSignal = exportController.signal;

  try {
    const fontSnapshot = await waitForAbortable(
      fontManager.createExportSnapshot(graph, nodeIds, exportSignal),
      exportSignal,
    );
    const requiredKeys = fontManager.collectFontKeys(graph, nodeIds);
    const requiredFallbacks = fontManager.collectFallbackScripts(graph, nodeIds);
    const loaded = new Set(fontSnapshot.fonts.map(({ family, style }) => `${family}\0${style}`));
    const missing = requiredKeys
      .filter(([family, style]) => !loaded.has(`${family}\0${style}`))
      .map(([family, style]) => `"${family}" ${style}`)
      .concat(
        requiredFallbacks.flatMap((script) =>
          fontSnapshot.fallbackFamilies[script].length === 0
            ? [`${script} fallback`]
            : fontSnapshot.fallbackFamilies[script]
                .filter((family) => !loaded.has(`${family}\0Regular`))
                .map((family) => `"${family}" Regular`),
        ),
      );
    if (missing.length > 0) {
      throw new RasterWorkerFontUnavailableError(
        `Abortable raster export requires loaded font bytes: ${missing.join(", ")}`,
      );
    }
    throwIfIOCancelled(exportSignal);

    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        exportSignal.removeEventListener("abort", cancelWorker);
        worker.terminate();
        callback();
      };
      const cancelWorker = () => finish(() => reject(new IOCancelledError("IO export cancelled")));

      worker.onmessage = (event: MessageEvent<RasterWorkerResponse>) => {
        finish(() => {
          if (exportSignal.aborted) {
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

      exportSignal.addEventListener("abort", cancelWorker, { once: true });
      if (exportSignal.aborted) {
        cancelWorker();
        return;
      }

      try {
        const request: RasterWorkerRequest = {
          graph: serializeSceneGraph(graph),
          pageId,
          nodeIds: [...nodeIds],
          options,
          canvasKitWasmUrl: canvasKitWasmUrl(),
          fontSnapshot,
        };
        // Structured clone preserves caller-owned image, document, and font buffers.
        worker.postMessage(request, []);
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  } finally {
    clearTimeout(deadlineTimer);
    signal?.removeEventListener("abort", cancel);
  }
}

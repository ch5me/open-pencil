import { rasterizePsdLayers } from "./raster";
import type { PsdRasterInput } from "./types";

type WorkerScope = typeof self & {
  postMessage(message: unknown, transfer: Transferable[]): void;
};

self.onmessage = (event: MessageEvent<PsdRasterInput>) => {
  const startedAt = performance.now();
  try {
    const pixels = rasterizePsdLayers(event.data);
    (self as WorkerScope).postMessage({ pixels, workerMs: performance.now() - startedAt }, [
      pixels.buffer,
    ]);
  } catch (error) {
    (self as WorkerScope).postMessage(
      {
        error: error instanceof Error ? error.message : String(error),
        code:
          error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : undefined,
      },
      [],
    );
  }
};

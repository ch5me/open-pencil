import CanvasKitInit from "canvaskit-wasm/full";

import { SkiaRenderer } from "#core/canvas";
import { deserializeSceneGraph } from "#core/kiwi/fig/parse/transfer";

import { renderNodesToRaster } from "./render";
import type { RasterWorkerRequest } from "./worker-protocol";

type WorkerScope = typeof self & {
  postMessage(message: unknown, transfer: Transferable[]): void;
};

self.onmessage = async (event: MessageEvent<RasterWorkerRequest>) => {
  try {
    const { graph: serialized, pageId, nodeIds, options, canvasKitWasmUrl } = event.data;
    const ck = await CanvasKitInit({ locateFile: () => canvasKitWasmUrl });
    const surface = ck.MakeSurface(1, 1);
    if (!surface) throw new Error("Failed to create CanvasKit surface");
    const renderer = new SkiaRenderer(ck, surface);
    renderer.viewportWidth = 1;
    renderer.viewportHeight = 1;
    renderer.dpr = 1;
    const graph = deserializeSceneGraph(serialized);
    await renderer.loadFonts();
    renderer.invalidateAllPictures();
    const restoreTextMeasurer = await renderer.prepareForExport(graph, pageId, nodeIds);
    let result;
    try {
      result = renderNodesToRaster(ck, renderer, graph, pageId, nodeIds, {
        scale: options.scale ?? 1,
        format: options.format ?? "PNG",
        quality: options.quality,
        trimTransparent: options.trimTransparent,
      });
    } finally {
      restoreTextMeasurer();
      renderer.destroy();
    }

    let bytes = result?.bytes ?? null;
    if (!bytes && result?.fallback) {
      if (typeof OffscreenCanvas === "undefined") {
        throw new Error(`Raster worker cannot encode ${result.fallback.format}`);
      }
      const canvas = new OffscreenCanvas(result.fallback.width, result.fallback.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Raster worker could not create encoding canvas");
      const image = new ImageData(
        new Uint8ClampedArray(result.fallback.pixels),
        result.fallback.width,
        result.fallback.height,
      );
      context.putImageData(image, 0, 0);
      const mimeType =
        result.fallback.format === "JPG"
          ? "image/jpeg"
          : `image/${result.fallback.format.toLowerCase()}`;
      const blob = await canvas.convertToBlob({
        type: mimeType,
        quality: result.fallback.quality / 100,
      });
      if (blob.type !== mimeType) throw new Error(`Raster worker cannot encode ${mimeType}`);
      bytes = new Uint8Array(await blob.arrayBuffer());
    }

    const transfer = bytes?.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
    (self as WorkerScope).postMessage({ bytes }, transfer);
  } catch (error) {
    (self as WorkerScope).postMessage(
      { error: error instanceof Error ? error.message : String(error) },
      [],
    );
  }
};

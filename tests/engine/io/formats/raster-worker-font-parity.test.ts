import { beforeAll, expect, test } from "bun:test";

import { headlessRenderNodes, renderRasterViaWorker } from "#core/io/formats/raster";
import { SceneGraph } from "#core/scene-graph";
import { fontManager } from "#core/text/fonts";
import { expectDefined } from "#tests/helpers/assert";

beforeAll(async () => {
  const inter = await Bun.file("packages/core/assets/Inter-Regular.ttf").arrayBuffer();
  const cjk = await Bun.file("tests/fixtures/fonts/NotoSansSC-Regular.ttf").arrayBuffer();
  const arabic = await Bun.file("tests/fixtures/fonts/NotoNaskhArabic-Regular.ttf").arrayBuffer();
  fontManager.markLoaded("Inter", "Regular", inter);
  fontManager.markLoaded("Noto Sans SC", "Regular", cjk);
  fontManager.markLoaded("Noto Naskh Arabic", "Regular", arabic);
  fontManager.setCJKFallbackFamily("Noto Sans SC");
  fontManager.setArabicFallbackFamily("Noto Naskh Arabic");
});

async function expectWorkerParity(text: string, width: number): Promise<void> {
  const graph = new SceneGraph();
  const page = graph.getPages()[0];
  const node = graph.createNode("TEXT", page.id, {
    text,
    textDirection: "AUTO",
    fontFamily: "Inter",
    fontSize: 32,
    fontWeight: 400,
    width,
    height: 64,
    fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
  });

  const direct = expectDefined(
    await headlessRenderNodes(graph, page.id, [node.id], { format: "PNG" }),
    "direct PNG",
  );

  const worker = expectDefined(
    await renderRasterViaWorker(graph, page.id, [node.id], { format: "PNG" }),
    "worker PNG",
  );
  expect(worker).toEqual(direct);
}

test(
  "CJK raster worker snapshot matches direct render",
  () => expectWorkerParity("你好世界", 200),
  15_000,
);

test(
  "Arabic raster worker snapshot matches direct render",
  () => expectWorkerParity("مرحبا بالعالم", 220),
  15_000,
);

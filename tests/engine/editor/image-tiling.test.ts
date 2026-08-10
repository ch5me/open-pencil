import { describe, expect, test } from "bun:test";

import {
  chooseProxyScale,
  createImageTilePlan,
  ImageTilePlanLimitError,
  mipmapLevelForScale,
} from "#core/canvas/image-editor";

describe("image tile planning", () => {
  test("plans only tiles intersecting a dirty rectangle", () => {
    const plan = createImageTilePlan({
      sourceWidth: 600,
      sourceHeight: 500,
      tileSize: 256,
      dirtyRect: { x: 260, y: 10, width: 20, height: 20 },
    });

    expect(plan.tiles).toEqual([
      { column: 1, row: 0, x: 256, y: 0, width: 256, height: 256 },
    ]);
  });

  test("does not include the next tile when dirty bounds end on a tile edge", () => {
    const plan = createImageTilePlan({
      sourceWidth: 600,
      sourceHeight: 500,
      tileSize: 256,
      dirtyRect: { x: 0, y: 0, width: 256, height: 256 },
    });

    expect(plan.tiles).toEqual([
      { column: 0, row: 0, x: 0, y: 0, width: 256, height: 256 },
    ]);
  });

  test("clips edge tiles and dirty rectangles to source bounds", () => {
    const plan = createImageTilePlan({
      sourceWidth: 300,
      sourceHeight: 260,
      tileSize: 256,
      dirtyRect: { x: 280, y: 250, width: 100, height: 100 },
    });

    expect(plan.tiles).toEqual([
      { column: 1, row: 0, x: 256, y: 0, width: 44, height: 256 },
      { column: 1, row: 1, x: 256, y: 256, width: 44, height: 4 },
    ]);
  });

  test("selects a bounded proxy scale and matching mipmap level", () => {
    expect(chooseProxyScale(4096, 2048, 1, 1024)).toBe(0.25);
    expect(mipmapLevelForScale(0.25)).toBe(2);
    expect(
      createImageTilePlan({
        sourceWidth: 4096,
        sourceHeight: 2048,
        tileSize: 512,
        proxyMaxDimension: 1024,
      }),
    ).toMatchObject({
      renderWidth: 1024,
      renderHeight: 512,
      scale: 0.25,
      proxy: true,
      mipmapLevel: 2,
    });
  });

  test("scales dirty rectangles into proxy tile coordinates", () => {
    const plan = createImageTilePlan({
      sourceWidth: 1024,
      sourceHeight: 1024,
      tileSize: 128,
      proxyMaxDimension: 256,
      dirtyRect: { x: 512, y: 0, width: 512, height: 512 },
    });

    expect(plan.tiles).toEqual([
      { column: 1, row: 0, x: 128, y: 0, width: 128, height: 128 },
    ]);
  });

  test("rejects invalid dimensions and unbounded tile plans", () => {
    expect(() => createImageTilePlan({ sourceWidth: 0, sourceHeight: 1 })).toThrow(
      "invalid source width",
    );
    expect(() =>
      createImageTilePlan({ sourceWidth: 1, sourceHeight: 1, tileSize: 1.5 }),
    ).toThrow("invalid tile size");
    expect(() =>
      createImageTilePlan({
        sourceWidth: 100,
        sourceHeight: 100,
        tileSize: 1,
        maxTiles: 100,
      }),
    ).toThrow(ImageTilePlanLimitError);
  });
});

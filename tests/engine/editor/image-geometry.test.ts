import { describe, expect, test } from "bun:test";

import {
  forwardTransform,
  inverseTransform,
  InvalidTransformError,
  mapForward,
  mapInverse,
  selectLayerAtPoint,
  pointInTransformedRect,
  resizeTransform,
  snapValue,
  selectionBounds,
  updateNumericTransform,
  transformedBounds,
} from "#core/editor/image-geometry";

const transform = {
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  rotation: 30,
};

describe("image geometry", () => {
  test("forward and inverse transforms round-trip points", () => {
    const point = { x: 25, y: 10 };
    const mapped = mapForward(transform, point);
    expect(mapInverse(transform, mapped).x).toBeCloseTo(point.x, 8);
    expect(mapInverse(transform, mapped).y).toBeCloseTo(point.y, 8);
    expect(forwardTransform(transform)).toHaveLength(9);
    expect(inverseTransform(transform)).toHaveLength(9);
  });

  test("bounds and hit testing respect rotation", () => {
    const bounds = transformedBounds(transform);
    expect(bounds.right).toBeGreaterThan(bounds.left);
    expect(pointInTransformedRect(transform, mapForward(transform, { x: 50, y: 25 }))).toBe(true);
    expect(pointInTransformedRect(transform, { x: -100, y: -100 })).toBe(false);
  });

  test("scaled rotated bounds follow the transformed corners", () => {
    const bounds = transformedBounds({
      ...transform,
      rotation: 45,
      scaleX: 2,
      scaleY: 0.5,
    });
    const corners = [
      mapForward({ ...transform, rotation: 45, scaleX: 2, scaleY: 0.5 }, { x: 0, y: 0 }),
      mapForward({ ...transform, rotation: 45, scaleX: 2, scaleY: 0.5 }, { x: 100, y: 0 }),
      mapForward({ ...transform, rotation: 45, scaleX: 2, scaleY: 0.5 }, { x: 100, y: 50 }),
      mapForward({ ...transform, rotation: 45, scaleX: 2, scaleY: 0.5 }, { x: 0, y: 50 }),
    ];
    expect(bounds.left).toBeCloseTo(Math.min(...corners.map((point) => point.x)), 8);
    expect(bounds.right).toBeCloseTo(Math.max(...corners.map((point) => point.x)), 8);
    expect(bounds.top).toBeCloseTo(Math.min(...corners.map((point) => point.y)), 8);
    expect(bounds.bottom).toBeCloseTo(Math.max(...corners.map((point) => point.y)), 8);
  });

  test("selection union and typed invalid transform", () => {
    const selection = selectionBounds([transform, { ...transform, x: 200 }]);
    expect(selection.bounds.x).toBeLessThan(200);
    expect(selection.bounds.width).toBeGreaterThan(100);
    expect(() => forwardTransform({ ...transform, scaleX: 0 })).toThrow(InvalidTransformError);
  });

  test("resize handles, aspect lock, snapping, numeric updates, and flip", () => {
    const resized = resizeTransform(
      transform,
      "bottom-right",
      { x: 20, y: 0 },
      { lockAspect: true },
    );
    expect(resized.width / resized.height).toBeCloseTo(2, 8);
    expect(snapValue(13, 8)).toBe(16);
    expect(updateNumericTransform(transform, { x: 30, rotation: 90 }).rotation).toBe(90);
  });

  test("corner resize keeps the opposite anchor fixed", () => {
    expect(resizeTransform(transform, "top-left", { x: 10, y: 5 })).toMatchObject({
      x: 20,
      y: 25,
      width: 90,
      height: 45,
    });
    expect(resizeTransform(transform, "top-right", { x: 10, y: 5 })).toMatchObject({
      x: 10,
      y: 25,
      width: 110,
      height: 45,
    });
    expect(resizeTransform(transform, "bottom-left", { x: 10, y: 5 })).toMatchObject({
      x: 20,
      y: 20,
      width: 90,
      height: 55,
    });
  });

  test("invalid resize inputs fail loudly", () => {
    expect(() => resizeTransform(transform, "bottom-right", { x: Number.NaN, y: 0 })).toThrow(
      InvalidTransformError,
    );
    expect(() => resizeTransform(transform, "bottom-right", { x: 0, y: 0 }, { snap: 0 })).toThrow(
      InvalidTransformError,
    );
    expect(() => updateNumericTransform(transform, { width: Number.POSITIVE_INFINITY })).toThrow(
      InvalidTransformError,
    );
  });

  test("geometry-v1 10,000-case metamorphic corpus has no hit-test errors", () => {
    let seed = 0x13579bdf;
    const next = (max: number) => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed % max;
    };
    let roundTripFailures = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const candidate = {
        x: next(500),
        y: next(500),
        width: 1 + next(300),
        height: 1 + next(300),
        rotation: next(360),
      };
      const local = { x: candidate.width / 3, y: candidate.height / 3 };
      const mapped = mapForward(candidate, local);
      const restored = mapInverse(candidate, mapped);
      if (Math.abs(restored.x - local.x) > 0.25 || Math.abs(restored.y - local.y) > 0.25) {
        roundTripFailures += 1;
      }
      if (!pointInTransformedRect(candidate, mapped)) falseNegatives += 1;
      if (pointInTransformedRect(candidate, { x: -10_000, y: -10_000 })) falsePositives += 1;
      const resized = resizeTransform(candidate, "bottom-right", { x: 2, y: 2 });
      if (resized.width < 1 || resized.height < 1) roundTripFailures += 1;
    }
    expect(roundTripFailures).toBe(0);
    expect(falsePositives).toBe(0);
    expect(falseNegatives).toBe(0);
    expect(() => snapValue(Number.NaN, 8)).toThrow(InvalidTransformError);
  });

  test("pixel hit-testing selects the topmost visible opaque layer", () => {
    const source = (alpha: number) => ({
      width: 2,
      height: 2,
      pixels: new Uint8Array([
        0, 0, 0, alpha,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    });
    const layers = [
      { id: "bottom", transform, source: source(255) },
      { id: "top-transparent", transform: { ...transform, x: 10 }, source: source(0) },
      { id: "top-opaque", transform: { ...transform, x: 10 }, source: source(255) },
    ];
    expect(selectLayerAtPoint(layers, mapForward(layers[2].transform, { x: 10, y: 10 }))?.id).toBe(
      "top-opaque",
    );
    expect(
      selectLayerAtPoint(
        [{ ...layers[0], locked: true }, { ...layers[1], visible: false }],
        mapForward(transform, { x: 10, y: 10 }),
      ),
    ).toBeNull();
  });
});

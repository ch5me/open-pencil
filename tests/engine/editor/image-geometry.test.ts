import { describe, expect, test } from "bun:test";

import {
  forwardTransform,
  inverseTransform,
  InvalidTransformError,
  mapForward,
  mapInverse,
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
});

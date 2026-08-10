import { expect, test } from "bun:test";

import {
  assertEffectPixelAcceptance,
  EffectAccelerationUnavailableError,
  EffectPixelAcceptanceError,
} from "#core/editor/image-capabilities/effects";

const WIDTH = 4;
const HEIGHT = 4;
const PIXELS = WIDTH * HEIGHT * 4;

function blankPixels(): number[] {
  return Array.from({ length: PIXELS }, () => 0);
}

test("effects-bounds-v1 accepts the exact 25 percent affected-area boundary", () => {
  const source = blankPixels();
  const reference = [...source];
  const accelerated = [...source];
  reference[0] = 100;
  accelerated[0] = 100;

  expect(() =>
    assertEffectPixelAcceptance(source, reference, accelerated, WIDTH, HEIGHT, [0, 0, 2, 2]),
  ).not.toThrow();
});

test("effects-bounds-v1 rejects malformed or out-of-canvas affected areas", () => {
  const pixels = blankPixels();
  const invalidAreas = [
    [-1, 0, 1, 1],
    [0, -1, 1, 1],
    [3, 0, 2, 1],
    [0, 3, 1, 2],
    [0, 0, 1.5, 1],
    [0, 0, 1, Number.NaN],
  ] as const;

  for (const area of invalidAreas) {
    expect(() => assertEffectPixelAcceptance(pixels, pixels, pixels, WIDTH, HEIGHT, area)).toThrow(
      EffectPixelAcceptanceError,
    );
  }
});

test("effects-bounds-v1 separates channel and mean-bias tolerance failures", () => {
  const source = blankPixels();
  const reference = [...source];
  const accelerated = [...source];
  reference[0] = 100;
  accelerated[0] = 102;

  expect(() =>
    assertEffectPixelAcceptance(source, reference, accelerated, WIDTH, HEIGHT, [0, 0, 1, 1], {
      maxChannelDelta: 1,
      maxMeanBias: 2,
    }),
  ).toThrow("accelerated pixel exceeds tolerance");

  reference[1] = 100;
  reference[2] = 100;
  reference[3] = 100;
  accelerated[0] = 101;
  accelerated[1] = 101;
  accelerated[2] = 101;
  accelerated[3] = 101;
  expect(() =>
    assertEffectPixelAcceptance(source, reference, accelerated, WIDTH, HEIGHT, [0, 0, 1, 1], {
      maxChannelDelta: 1,
      maxMeanBias: 0.5,
    }),
  ).toThrow("accelerated pixel mean bias exceeds tolerance");
});

test("effects-bounds-v1 exposes typed unavailable acceleration", () => {
  const error = new EffectAccelerationUnavailableError("WebGPU unavailable");
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe("E_EFFECT_ACCELERATION_UNAVAILABLE");
  expect(error.message).toBe("WebGPU unavailable");
});

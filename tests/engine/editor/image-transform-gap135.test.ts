import { expect, test } from "bun:test";

import {
  mapForward,
  resizeTransform,
  type GeometryTransform,
  type ResizeHandle,
} from "#core/editor/image-geometry";
import { EvidenceCollector } from "#core/editor/image-observability";
import {
  createImageQaRegressionContract,
  validateImageQaRegressionContract,
} from "#core/editor/image-qa";

const TEST_IDENTITY =
  "PROOF-GAP-135 catches rotated nonuniform-scale resize regressions";
const SEED = 0x5135cafe;
const HANDLES = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
] as const satisfies readonly ResizeHandle[];

function corner(
  handle: ResizeHandle,
  width: number,
  height: number,
  opposite = false,
) {
  const left = handle.includes("left");
  const top = handle.includes("top");
  return {
    x: (left === opposite) ? width : 0,
    y: (top === opposite) ? height : 0,
  };
}

function assertClose(actual: number, expected: number, caseId: string): void {
  if (Math.abs(actual - expected) > 1e-7) {
    throw new Error(`${TEST_IDENTITY}: seed=${SEED} case=${caseId}; expected ${expected}, got ${actual}`);
  }
}

function assertResizeInvariant(
  transform: GeometryTransform,
  handle: ResizeHandle,
  delta: { readonly x: number; readonly y: number },
  caseId: string,
): void {
  const draggedBefore = mapForward(
    transform,
    corner(handle, transform.width, transform.height),
  );
  const anchorBefore = mapForward(
    transform,
    corner(handle, transform.width, transform.height, true),
  );
  const resized = resizeTransform(transform, handle, delta);
  const draggedAfter = mapForward(resized, corner(handle, resized.width, resized.height));
  const anchorAfter = mapForward(
    resized,
    corner(handle, resized.width, resized.height, true),
  );

  assertClose(draggedAfter.x - draggedBefore.x, delta.x, `${caseId}:drag-x`);
  assertClose(draggedAfter.y - draggedBefore.y, delta.y, `${caseId}:drag-y`);
  assertClose(anchorAfter.x, anchorBefore.x, `${caseId}:anchor-x`);
  assertClose(anchorAfter.y, anchorBefore.y, `${caseId}:anchor-y`);
}

test(TEST_IDENTITY, () => {
  assertResizeInvariant(
    {
      x: 17,
      y: -23,
      width: 101,
      height: 59,
      rotation: 30,
      scaleX: 2,
      scaleY: 0.5,
    },
    "bottom-right",
    { x: 12, y: -7 },
    "exact-regression",
  );
});

test("PROOF-GAP-135 seeded rotated resize properties preserve handle and anchor identity", () => {
  let state = SEED;
  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };

  for (let index = 0; index < 2_048; index += 1) {
    const transform = {
      x: random() * 1_000 - 500,
      y: random() * 1_000 - 500,
      width: random() * 300 + 100,
      height: random() * 300 + 100,
      rotation: random() * 360 - 180,
      scaleX: random() * 2.75 + 0.25,
      scaleY: random() * 2.75 + 0.25,
    };
    const delta = {
      x: random() * 8 - 4,
      y: random() * 8 - 4,
    };
    assertResizeInvariant(
      transform,
      HANDLES[index % HANDLES.length],
      delta,
      String(index),
    );
  }

  const evidence = new EvidenceCollector("G136-PROOF-GAP-135", {
    repo: "open-pencil",
    commit: "seeded-defect-run-required",
    runtime: "bun",
  });
  evidence.record("published", new TextEncoder().encode(TEST_IDENTITY).byteLength, 2_048);
  evidence.assertNonzeroOutput();
  expect(evidence.receipt()).toMatchObject({
    lane: "G136-PROOF-GAP-135",
    outputBytes: TEST_IDENTITY.length,
    stale: false,
    substituted: false,
  });
});

test("PROOF-GAP-135 keeps unobserved consuming transform surfaces typed UNKNOWN", () => {
  const qa = createImageQaRegressionContract({ transformMath: "SUPPORTED" });
  validateImageQaRegressionContract(qa);
  expect(qa.transformMath).toBe("SUPPORTED");
  expect({
    realTouch: qa.realTouch,
    deviceMatrix: qa.deviceMatrix,
    firefoxGpu: qa.firefoxGpu,
    orientationThermal: qa.orientationThermal,
  }).toEqual({
    realTouch: "UNKNOWN",
    deviceMatrix: "UNKNOWN",
    firefoxGpu: "UNKNOWN",
    orientationThermal: "UNKNOWN",
  });
});

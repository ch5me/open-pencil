import type { Vector } from "#core/types";

import {
  InvalidTransformError,
  type GeometryTransform,
  type ResizeHandle,
  type ResizeOptions,
} from "./types";
import { mapForward, validateTransform } from "./transform";

function screenDeltaToLocal(transform: GeometryTransform, delta: Vector): Vector {
  const angle = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const scaleX = transform.scaleX ?? 1;
  const scaleY = transform.scaleY ?? 1;
  return {
    x: (cos * delta.x + sin * delta.y) / scaleX,
    y: (-sin * delta.x + cos * delta.y) / scaleY,
  };
}

function oppositeAnchor(handle: ResizeHandle, width: number, height: number): Vector {
  return {
    x: handle.includes("left") ? width : 0,
    y: handle.includes("top") ? height : 0,
  };
}

export function snapValue(value: number, grid: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(grid) || grid <= 0) {
    throw new InvalidTransformError("snap grid must be positive and finite");
  }
  return Math.round(value / grid) * grid;
}

export function resizeTransform(
  transform: GeometryTransform,
  handle: ResizeHandle,
  delta: Vector,
  options: ResizeOptions = {},
): GeometryTransform {
  validateTransform(transform);
  if (
    handle !== "top-left" &&
    handle !== "top-right" &&
    handle !== "bottom-right" &&
    handle !== "bottom-left"
  ) {
    throw new InvalidTransformError("resize handle must be a corner");
  }
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new InvalidTransformError("resize delta must be finite");
  }
  if (options.snap !== undefined && (!Number.isFinite(options.snap) || options.snap <= 0)) {
    throw new InvalidTransformError("snap grid must be positive and finite");
  }

  const horizontal = handle.includes("right") ? 1 : handle.includes("left") ? -1 : 0;
  const vertical = handle.includes("bottom") ? 1 : handle.includes("top") ? -1 : 0;
  const localDelta = screenDeltaToLocal(transform, delta);
  let width = Math.max(1, transform.width + horizontal * localDelta.x);
  let height = Math.max(1, transform.height + vertical * localDelta.y);
  const ratio = transform.width / transform.height;
  if (options.lockAspect) {
    if (Math.abs(localDelta.x) >= Math.abs(localDelta.y)) {
      height = Math.max(1, width / ratio);
    } else {
      width = Math.max(1, height * ratio);
    }
  }
  if (options.snap) {
    width = Math.max(1, snapValue(width, options.snap));
    height = Math.max(1, snapValue(height, options.snap));
  }

  const anchor = oppositeAnchor(handle, transform.width, transform.height);
  const next = {
    ...transform,
    width,
    height,
  };
  const before = mapForward(transform, anchor);
  const after = mapForward(next, oppositeAnchor(handle, width, height));
  return {
    ...next,
    x: next.x + before.x - after.x,
    y: next.y + before.y - after.y,
  };
}

export function updateNumericTransform(
  transform: GeometryTransform,
  updates: Partial<Pick<GeometryTransform, "x" | "y" | "width" | "height" | "rotation">>,
): GeometryTransform {
  validateTransform(transform);
  const next = { ...transform, ...updates };
  validateTransform(next);
  return next;
}

export function flipTransform(transform: GeometryTransform, axis: "x" | "y"): GeometryTransform {
  validateTransform(transform);
  return axis === "x"
    ? { ...transform, scaleX: -(transform.scaleX ?? 1) }
    : { ...transform, scaleY: -(transform.scaleY ?? 1) };
}

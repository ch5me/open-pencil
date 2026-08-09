import Matrix, { type Mat3 } from "#core/canvas/matrix";
import { degToRad, rotatedBBox } from "#core/geometry";
import type { Vector } from "#core/types";

import { InvalidTransformError, type GeometryTransform } from "./types";

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new InvalidTransformError(`${label} must be finite`);
}

export function validateTransform(transform: GeometryTransform): void {
  for (const [label, value] of Object.entries(transform)) {
    if (typeof value === "number") assertFinite(value, label);
  }
  if (transform.width < 0 || transform.height < 0) {
    throw new InvalidTransformError("width and height must be non-negative");
  }
  if (transform.scaleX === 0 || transform.scaleY === 0) {
    throw new InvalidTransformError("scale cannot be zero");
  }
}

export function forwardTransform(transform: GeometryTransform): Mat3 {
  validateTransform(transform);
  const scaleX = transform.scaleX ?? 1;
  const scaleY = transform.scaleY ?? 1;
  const cx = transform.width / 2;
  const cy = transform.height / 2;
  return Matrix.multiply(
    Matrix.translated(transform.x, transform.y),
    Matrix.translated(cx, cy),
    Matrix.scaled(scaleX, scaleY),
    Matrix.rotated(degToRad(transform.rotation)),
    Matrix.translated(-cx, -cy),
  );
}

export function inverseTransform(transform: GeometryTransform): Mat3 {
  const inverse = Matrix.invert(forwardTransform(transform));
  if (!inverse) throw new InvalidTransformError("transform is not invertible");
  return inverse;
}

export function mapForward(transform: GeometryTransform, point: Vector): Vector {
  return Matrix.mapPoint(forwardTransform(transform), point);
}

export function mapInverse(transform: GeometryTransform, point: Vector): Vector {
  return Matrix.mapPoint(inverseTransform(transform), point);
}

export function transformedBounds(transform: GeometryTransform): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
} {
  validateTransform(transform);
  const base = rotatedBBox(
    transform.x,
    transform.y,
    transform.width,
    transform.height,
    transform.rotation,
  );
  const scaleX = Math.abs(transform.scaleX ?? 1);
  const scaleY = Math.abs(transform.scaleY ?? 1);
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  const halfWidth = ((base.right - base.left) * scaleX) / 2;
  const halfHeight = ((base.bottom - base.top) * scaleY) / 2;
  return {
    left: centerX - halfWidth,
    right: centerX + halfWidth,
    top: centerY - halfHeight,
    bottom: centerY + halfHeight,
    centerX,
    centerY,
  };
}

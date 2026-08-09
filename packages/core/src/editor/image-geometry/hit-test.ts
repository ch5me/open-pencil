import { mapInverse } from "./transform";
import type { GeometryTransform, HitTestOptions, Vector } from "./types";

export function pointInTransformedRect(
  transform: GeometryTransform,
  point: Vector,
  options: HitTestOptions = {},
): boolean {
  const local = mapInverse(transform, point);
  const tolerance = options.tolerance ?? 0;
  return (
    local.x >= -tolerance &&
    local.y >= -tolerance &&
    local.x <= transform.width + tolerance &&
    local.y <= transform.height + tolerance
  );
}

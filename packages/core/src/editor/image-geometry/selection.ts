import type { Rect } from "#core/types";

import { transformedBounds } from "./transform";
import type { GeometrySelection, GeometryTransform } from "./types";

export function selectionBounds(transforms: readonly GeometryTransform[]): GeometrySelection {
  const matrices = transforms.map((transform) => {
    const bounds = transformedBounds(transform);
    return {
      x: bounds.left,
      y: bounds.top,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    };
  });
  const bounds = matrices.reduce<Rect | null>((current, rect) => {
    if (!current) return rect;
    const minX = Math.min(current.x, rect.x);
    const minY = Math.min(current.y, rect.y);
    const maxX = Math.max(current.x + current.width, rect.x + rect.width);
    const maxY = Math.max(current.y + current.height, rect.y + rect.height);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, null) ?? { x: 0, y: 0, width: 0, height: 0 };
  return { bounds, transforms: transforms.map(() => [1, 0, 0, 0, 1, 0, 0, 0, 1]) };
}

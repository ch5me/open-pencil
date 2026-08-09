export type VectorForm = "rect" | "ellipse" | "polygon" | "path";

export interface VectorCapability {
  readonly form: VectorForm;
  readonly width: number;
  readonly height: number;
  readonly fill: readonly [number, number, number, number];
  readonly stroke: readonly [number, number, number, number] | null;
  readonly strokeWidth: number;
  readonly cornerRadius: number;
  readonly path: readonly string[];
}

export interface PathAnchor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly handleIn?: readonly [number, number];
  readonly handleOut?: readonly [number, number];
}

export interface PenPath {
  readonly anchors: readonly PathAnchor[];
  readonly closed: boolean;
  readonly transactionId: `tx:${string}`;
}

export class UnsupportedPsdFlatteningError extends Error {
  readonly code = "unsupported-psd-flattening";
}

export class VectorCapabilityUnavailableError extends Error {
  readonly code = "E_CAPABILITY_VECTOR_UNAVAILABLE";
}

function validateAnchor(anchor: PathAnchor): void {
  if (!anchor.id || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    throw new RangeError("invalid path anchor");
  }
}

export function validatePenPath(path: PenPath): void {
  if (path.anchors.length === 0) throw new RangeError("path requires an anchor");
  path.anchors.forEach(validateAnchor);
}

export function insertPathAnchor(
  path: PenPath,
  anchor: PathAnchor,
  index = path.anchors.length,
): PenPath {
  validateAnchor(anchor);
  if (index < 0 || index > path.anchors.length) throw new RangeError("invalid anchor index");
  const anchors = [...path.anchors];
  anchors.splice(index, 0, { ...anchor });
  return { ...path, anchors, transactionId: path.transactionId };
}

export function deletePathAnchor(path: PenPath, id: string): PenPath {
  const anchors = path.anchors.filter((anchor) => anchor.id !== id);
  if (anchors.length === 0) throw new RangeError("path requires an anchor");
  return { ...path, anchors };
}

export function movePathAnchor(path: PenPath, id: string, x: number, y: number): PenPath {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError("invalid anchor position");
  let found = false;
  const anchors = path.anchors.map((anchor) => {
    if (anchor.id !== id) return anchor;
    found = true;
    return { ...anchor, x, y };
  });
  if (!found) throw new RangeError(`missing path anchor: ${id}`);
  return { ...path, anchors };
}

export function validateVectorCapability(value: VectorCapability): void {
  if (value.width <= 0 || value.height <= 0) throw new RangeError("invalid vector dimensions");
  if (value.cornerRadius < 0 || value.strokeWidth < 0) throw new RangeError("invalid vector style");
  if (value.form === "path" && value.path.length === 0) {
    throw new RangeError("path vector requires path commands");
  }
}

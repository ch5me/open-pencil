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

export class UnsupportedPsdFlatteningError extends Error {
  readonly code = "unsupported-psd-flattening";
}

export function validateVectorCapability(value: VectorCapability): void {
  if (value.width <= 0 || value.height <= 0) throw new RangeError("invalid vector dimensions");
  if (value.cornerRadius < 0 || value.strokeWidth < 0) throw new RangeError("invalid vector style");
  if (value.form === "path" && value.path.length === 0) {
    throw new RangeError("path vector requires path commands");
  }
}

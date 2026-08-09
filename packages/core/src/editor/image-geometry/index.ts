export { pointInTransformedRect } from "./hit-test";
export { selectionBounds } from "./selection";
export { flipTransform, resizeTransform, snapValue, updateNumericTransform } from "./operations";
export {
  forwardTransform,
  inverseTransform,
  mapForward,
  mapInverse,
  transformedBounds,
  validateTransform,
} from "./transform";
export {
  InvalidTransformError,
  type GeometrySelection,
  type GeometryTransform,
  type HitTestOptions,
  type ResizeHandle,
  type ResizeOptions,
} from "./types";

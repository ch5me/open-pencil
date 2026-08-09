import type { BlendMode, Color, NodeType, SceneNode, Vector } from "#core/scene-graph";

export const LAYER_MODEL_VERSION = "layer-model-v1";
export type LayerModelMaskTransform = readonly [number, number, number, number, number, number];
export type LayerModelMaskTransformMode = "linked" | "independent";
export type LayerModelMaskType = "ALPHA" | "VECTOR" | "LUMINANCE";
export const LAYER_MODEL_COLOR_LABELS = [
  "NONE",
  "RED",
  "ORANGE",
  "YELLOW",
  "GREEN",
  "BLUE",
  "VIOLET",
  "GRAY",
] as const;
export type LayerModelColorLabel = (typeof LAYER_MODEL_COLOR_LABELS)[number];
export interface UnsupportedLayerColorLabel {
  readonly kind: "unsupported";
  readonly code: "layer-model-unsupported-color-label";
  readonly value: string;
}
export type LayerModelResolvedColorLabel = LayerModelColorLabel | UnsupportedLayerColorLabel;

export interface LayerModelEdgeRefinement {
  readonly smooth: number;
  readonly feather: number;
  readonly contrast: number;
  readonly shiftEdge: number;
}

export type LayerModelEffectKind = "shadow" | "glow" | "stroke" | "overlay" | "bevel" | "pattern";

export interface LayerModelShadowEffect {
  readonly kind: "shadow";
  readonly color: Color;
  readonly offset: Vector;
  readonly blur: number;
  readonly spread: number;
  readonly visible: boolean;
  readonly inset: boolean;
}

export interface LayerModelGlowEffect {
  readonly kind: "glow";
  readonly color: Color;
  readonly radius: number;
  readonly intensity: number;
  readonly visible: boolean;
}

export interface LayerModelStrokeEffect {
  readonly kind: "stroke";
  readonly color: Color;
  readonly width: number;
  readonly position: "inside" | "center" | "outside";
  readonly visible: boolean;
}

export interface LayerModelOverlayEffect {
  readonly kind: "overlay";
  readonly color: Color;
  readonly opacity: number;
  readonly blendMode: LayerModelResolvedBlendMode;
  readonly visible: boolean;
}

export interface LayerModelBevelEffect {
  readonly kind: "bevel";
  readonly highlightColor: Color;
  readonly shadowColor: Color;
  readonly depth: number;
  readonly angle: number;
  readonly visible: boolean;
}

export interface LayerModelPatternEffect {
  readonly kind: "pattern";
  readonly patternId: string;
  readonly opacity: number;
  readonly scale: number;
  readonly rotation: number;
  readonly visible: boolean;
}

export type LayerModelEffect =
  | LayerModelShadowEffect
  | LayerModelGlowEffect
  | LayerModelStrokeEffect
  | LayerModelOverlayEffect
  | LayerModelBevelEffect
  | LayerModelPatternEffect;

export interface UnsupportedLayerEffect {
  readonly kind: "unsupported";
  readonly code: "layer-model-unsupported-effect";
  readonly value: string;
}

export type LayerModelResolvedEffect = LayerModelEffect | UnsupportedLayerEffect;

export type LayerModelEffectInput =
  | LayerModelEffect
  | {
      readonly kind: string;
      readonly [key: string]: unknown;
    };

export const LAYER_MODEL_BLEND_MODES = [
  "NORMAL",
  "DARKEN",
  "MULTIPLY",
  "COLOR_BURN",
  "LIGHTEN",
  "SCREEN",
  "COLOR_DODGE",
  "OVERLAY",
  "SOFT_LIGHT",
  "HARD_LIGHT",
  "DIFFERENCE",
  "EXCLUSION",
  "HUE",
  "SATURATION",
  "COLOR",
  "LUMINOSITY",
  "PASS_THROUGH",
] as const satisfies readonly BlendMode[];

export type LayerModelBlendMode = (typeof LAYER_MODEL_BLEND_MODES)[number];

export interface UnsupportedLayerBlendMode {
  readonly kind: "unsupported";
  readonly code: "layer-model-unsupported-blend-mode";
  readonly value: string;
}

export type LayerModelResolvedBlendMode = LayerModelBlendMode | UnsupportedLayerBlendMode;

export type LayerModelMaskKind = "group" | "adjustment-layer";

export interface UnsupportedLayerMaskKind {
  readonly kind: "unsupported";
  readonly code: "layer-model-unsupported-mask-kind";
  readonly value: string;
}

export type LayerModelResolvedMaskKind = LayerModelMaskKind | UnsupportedLayerMaskKind;

export interface UnsupportedLayerMaskType {
  readonly kind: "unsupported";
  readonly code: "layer-model-unsupported-mask-type";
  readonly value: string;
}

export type LayerModelResolvedMaskType = LayerModelMaskType | UnsupportedLayerMaskType;

export type LayerModelNodeInput = Omit<
  Pick<SceneNode, "id" | "parentId" | "childIds" | "blendMode">,
  "blendMode"
> & {
  readonly blendMode: BlendMode | string;
  readonly type?: NodeType | string;
  readonly maskId?: string | null;
  readonly maskKind?: LayerModelMaskKind | string | null;
  readonly maskTransform?: LayerModelMaskTransform | null;
  readonly maskTransformMode?: LayerModelMaskTransformMode | string | null;
  readonly maskType?: LayerModelMaskType | string | null;
  readonly maskDensity?: number | null;
  readonly maskFeather?: number | null;
  readonly edgeRefinement?: Partial<LayerModelEdgeRefinement> | null;
  readonly linkId?: string | null;
  readonly linkedLayerIds?: readonly string[] | null;
  readonly colorLabel?: LayerModelColorLabel | string | null;
  readonly effects?: readonly LayerModelEffectInput[] | null;
};

export interface LayerModelNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly blendMode: LayerModelResolvedBlendMode;
  readonly type: NodeType | string;
  readonly maskId: string | null;
  readonly maskKind: LayerModelResolvedMaskKind | null;
  readonly maskTransform: LayerModelMaskTransform | null;
  readonly maskTransformMode: LayerModelMaskTransformMode;
  readonly maskType: LayerModelResolvedMaskType | null;
  readonly maskDensity: number;
  readonly maskFeather: number;
  readonly edgeRefinement: LayerModelEdgeRefinement | null;
  readonly vectorMask: boolean;
  readonly groupMask: boolean;
  readonly adjustmentLayerMask: boolean;
  readonly passThrough: boolean;
  readonly linkId: string | null;
  readonly linkedLayerIds: readonly string[];
  readonly colorLabel: LayerModelResolvedColorLabel | null;
  readonly effects: readonly LayerModelResolvedEffect[];
}

export interface LayerModel {
  readonly version: typeof LAYER_MODEL_VERSION;
  readonly migrationHash: string;
  readonly nodes: ReadonlyMap<string, LayerModelNode>;
}

export interface LayerModelMigration {
  readonly model: LayerModel;
  readonly cycles: number;
  readonly danglingRefs: number;
  readonly invalidatedNodeIds: readonly string[];
}

export class LayerModelValidationError extends Error {
  readonly code = "layer-model-validation-error";
}

export class LayerModelMaskValidationError extends LayerModelValidationError {
  readonly code = "layer-model-invalid-mask";
}

export class LayerModelTransactionConflict extends Error {
  readonly code = "layer-model-transaction-conflict";
}

function finiteEffectNumber(value: unknown, label: string, min = 0, max?: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    (max !== undefined && value > max)
  ) {
    throw new LayerModelValidationError(`invalid ${label}: ${String(value)}`);
  }
  return value;
}

function effectColor(value: unknown, label: string): Color {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { r?: unknown }).r !== "number" ||
    typeof (value as { g?: unknown }).g !== "number" ||
    typeof (value as { b?: unknown }).b !== "number" ||
    typeof (value as { a?: unknown }).a !== "number"
  ) {
    throw new LayerModelValidationError(`invalid ${label}`);
  }
  const color = value as Color;
  if (![color.r, color.g, color.b, color.a].every(Number.isFinite)) {
    throw new LayerModelValidationError(`invalid ${label}`);
  }
  return { ...color };
}

function effectOffset(value: unknown): Vector {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { x?: unknown }).x !== "number" ||
    typeof (value as { y?: unknown }).y !== "number"
  ) {
    throw new LayerModelValidationError("invalid shadow offset");
  }
  const offset = value as Vector;
  if (![offset.x, offset.y].every(Number.isFinite)) {
    throw new LayerModelValidationError("invalid shadow offset");
  }
  return { ...offset };
}

function effectVisible(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new LayerModelValidationError(`invalid effect visibility: ${String(value)}`);
  }
  return value;
}

function resolveEffect(effect: LayerModelEffectInput): LayerModelResolvedEffect {
  if (effect.kind === "shadow") {
    const shadow = effect as LayerModelShadowEffect;
    return {
      kind: "shadow",
      color: effectColor(shadow.color, "shadow color"),
      offset: effectOffset(shadow.offset),
      blur: finiteEffectNumber(shadow.blur, "shadow blur"),
      spread: finiteEffectNumber(shadow.spread, "shadow spread"),
      visible: effectVisible(shadow.visible),
      inset: shadow.inset,
    };
  }
  if (effect.kind === "glow") {
    const glow = effect as LayerModelGlowEffect;
    return {
      kind: "glow",
      color: effectColor(glow.color, "glow color"),
      radius: finiteEffectNumber(glow.radius, "glow radius"),
      intensity: finiteEffectNumber(glow.intensity, "glow intensity", 0, 1),
      visible: effectVisible(glow.visible),
    };
  }
  if (effect.kind === "stroke") {
    const stroke = effect as LayerModelStrokeEffect;
    if (
      stroke.position !== "inside" &&
      stroke.position !== "center" &&
      stroke.position !== "outside"
    ) {
      throw new LayerModelValidationError(`invalid stroke position: ${String(stroke.position)}`);
    }
    return {
      kind: "stroke",
      color: effectColor(stroke.color, "stroke color"),
      width: finiteEffectNumber(stroke.width, "stroke width"),
      position: stroke.position,
      visible: effectVisible(stroke.visible),
    };
  }
  if (effect.kind === "overlay") {
    const overlay = effect as LayerModelOverlayEffect;
    return {
      kind: "overlay",
      color: effectColor(overlay.color, "overlay color"),
      opacity: finiteEffectNumber(overlay.opacity, "overlay opacity", 0, 1),
      blendMode: resolveBlendMode(overlay.blendMode),
      visible: effectVisible(overlay.visible),
    };
  }
  if (effect.kind === "bevel") {
    const bevel = effect as LayerModelBevelEffect;
    return {
      kind: "bevel",
      highlightColor: effectColor(bevel.highlightColor, "bevel highlight color"),
      shadowColor: effectColor(bevel.shadowColor, "bevel shadow color"),
      depth: finiteEffectNumber(bevel.depth, "bevel depth"),
      angle: finiteEffectNumber(bevel.angle, "bevel angle", -360, 360),
      visible: effectVisible(bevel.visible),
    };
  }
  if (effect.kind === "pattern") {
    const pattern = effect as LayerModelPatternEffect;
    if (typeof pattern.patternId !== "string" || pattern.patternId.length === 0) {
      throw new LayerModelValidationError("invalid pattern id");
    }
    return {
      kind: "pattern",
      patternId: pattern.patternId,
      opacity: finiteEffectNumber(pattern.opacity, "pattern opacity", 0, 1),
      scale: finiteEffectNumber(pattern.scale, "pattern scale"),
      rotation: finiteEffectNumber(pattern.rotation, "pattern rotation", -360, 360),
      visible: effectVisible(pattern.visible),
    };
  }
  return {
    kind: "unsupported",
    code: "layer-model-unsupported-effect",
    value: effect.kind,
  };
}

function resolveEffects(
  effects: LayerModelNodeInput["effects"],
): readonly LayerModelResolvedEffect[] {
  return (effects ?? []).map(resolveEffect);
}

function canonicalNode(node: LayerModelNodeInput): LayerModelNode {
  const type = node.type ?? "GROUP";
  const blendMode = resolveBlendMode(node.blendMode);
  const maskKind = resolveMaskKind(node.maskKind);
  const maskTransform = node.maskTransform
    ? ([...node.maskTransform] as LayerModelMaskTransform)
    : null;
  const maskTransformMode = node.maskTransformMode ?? (maskTransform ? "independent" : "linked");
  const maskType = resolveMaskType(node.maskType);
  const linkId = node.linkId ?? null;
  if (linkId !== null && linkId.length === 0) {
    throw new LayerModelValidationError(`empty layer link id: ${node.id}`);
  }
  const linkedLayerIds = [...new Set(node.linkedLayerIds ?? [])];
  if (linkedLayerIds.some((id) => id.length === 0)) {
    throw new LayerModelValidationError(`empty linked layer reference: ${node.id}`);
  }
  const colorLabel = resolveColorLabel(node.colorLabel);
  const maskDensity = node.maskDensity ?? 1;
  const maskFeather = node.maskFeather ?? 0;
  const edgeRefinement = resolveEdgeRefinement(node.edgeRefinement);
  const passThrough = blendMode === "PASS_THROUGH" && type === "GROUP";
  const effects = resolveEffects(node.effects);
  return {
    id: node.id,
    parentId: node.parentId,
    childIds: [...node.childIds],
    blendMode,
    type,
    maskId: node.maskId ?? null,
    maskKind,
    maskTransform,
    maskTransformMode: resolveMaskTransformMode(maskTransformMode),
    maskType,
    maskDensity,
    maskFeather,
    edgeRefinement,
    vectorMask: maskType === "VECTOR",
    groupMask: maskKind === "group",
    adjustmentLayerMask: maskKind === "adjustment-layer",
    passThrough,
    linkId,
    linkedLayerIds,
    colorLabel,
    effects,
  };
}

function resolveColorLabel(
  label: LayerModelNodeInput["colorLabel"],
): LayerModelResolvedColorLabel | null {
  if (label === undefined || label === null) return null;
  if ((LAYER_MODEL_COLOR_LABELS as readonly string[]).includes(label)) {
    return label as LayerModelColorLabel;
  }
  return {
    kind: "unsupported",
    code: "layer-model-unsupported-color-label",
    value: label,
  };
}

export function isUnsupportedLayerColorLabel(
  label: LayerModelResolvedColorLabel,
): label is UnsupportedLayerColorLabel {
  return typeof label === "object" && label.kind === "unsupported";
}

function resolveMaskTransformMode(
  mode: LayerModelNodeInput["maskTransformMode"],
): LayerModelMaskTransformMode {
  if (mode === undefined || mode === null || mode === "linked" || mode === "independent") {
    return mode ?? "linked";
  }
  throw new LayerModelMaskValidationError(`unsupported mask transform mode: ${mode}`);
}

function resolveMaskType(type: LayerModelNodeInput["maskType"]): LayerModelResolvedMaskType | null {
  if (type === undefined || type === null) return null;
  if (type === "ALPHA" || type === "VECTOR" || type === "LUMINANCE") return type;
  return {
    kind: "unsupported",
    code: "layer-model-unsupported-mask-type",
    value: type,
  };
}

export function isUnsupportedLayerMaskType(
  type: LayerModelResolvedMaskType,
): type is UnsupportedLayerMaskType {
  return typeof type === "object" && type.kind === "unsupported";
}

function maskNumber(value: number | undefined, label: string, min: number, max?: number): number {
  const resolved = value ?? 0;
  if (!Number.isFinite(resolved) || resolved < min || (max !== undefined && resolved > max)) {
    throw new LayerModelMaskValidationError(`invalid ${label}: ${String(value)}`);
  }
  return resolved;
}

function resolveEdgeRefinement(
  refinement: LayerModelNodeInput["edgeRefinement"],
): LayerModelEdgeRefinement | null {
  if (refinement === undefined || refinement === null) return null;
  return {
    smooth: maskNumber(refinement.smooth, "edge refinement smooth", 0, 100),
    feather: maskNumber(refinement.feather, "edge refinement feather", 0),
    contrast: maskNumber(refinement.contrast, "edge refinement contrast", -100, 100),
    shiftEdge: maskNumber(refinement.shiftEdge, "edge refinement shift", -100, 100),
  };
}

function resolveBlendMode(mode: BlendMode | string): LayerModelResolvedBlendMode {
  if ((LAYER_MODEL_BLEND_MODES as readonly string[]).includes(mode)) {
    return mode as LayerModelBlendMode;
  }
  return {
    kind: "unsupported",
    code: "layer-model-unsupported-blend-mode",
    value: mode,
  };
}

export function isUnsupportedLayerBlendMode(
  mode: LayerModelResolvedBlendMode,
): mode is UnsupportedLayerBlendMode {
  return typeof mode === "object" && mode.kind === "unsupported";
}

function resolveMaskKind(
  kind: LayerModelNodeInput["maskKind"],
): LayerModelResolvedMaskKind | null {
  if (kind === null || kind === undefined) return null;
  if (kind === "group" || kind === "adjustment-layer") return kind;
  return {
    kind: "unsupported",
    code: "layer-model-unsupported-mask-kind",
    value: kind,
  };
}

export function isUnsupportedLayerMaskKind(
  kind: LayerModelResolvedMaskKind,
): kind is UnsupportedLayerMaskKind {
  return typeof kind === "object" && kind.kind === "unsupported";
}

function canonicalJson(nodes: readonly LayerModelNode[]): string {
  return JSON.stringify(
    nodes
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => ({
        id: node.id,
        parentId: node.parentId,
        childIds: [...node.childIds],
        blendMode: node.blendMode,
        type: node.type,
        maskId: node.maskId,
        maskKind: node.maskKind,
        maskTransform: node.maskTransform,
        maskTransformMode: node.maskTransformMode,
        maskType: node.maskType,
        maskDensity: node.maskDensity,
        maskFeather: node.maskFeather,
        edgeRefinement: node.edgeRefinement,
        vectorMask: node.vectorMask,
        groupMask: node.groupMask,
        adjustmentLayerMask: node.adjustmentLayerMask,
        passThrough: node.passThrough,
        linkId: node.linkId,
        linkedLayerIds: [...node.linkedLayerIds],
        colorLabel: node.colorLabel,
        effects: node.effects,
      })),
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nodeList(
  input: readonly LayerModelNodeInput[] | ReadonlyMap<string, LayerModelNodeInput>,
): LayerModelNode[] {
  return Array.isArray(input) ? input.map(canonicalNode) : [...input.values()].map(canonicalNode);
}

function validateNodes(nodes: readonly LayerModelNode[]): void {
  const byId = new Map<string, LayerModelNode>();
  for (const node of nodes) {
    if (!node.id || byId.has(node.id)) {
      throw new LayerModelValidationError(`duplicate or empty layer id: ${node.id}`);
    }
    byId.set(node.id, node);
  }

  for (const node of nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) {
      throw new LayerModelValidationError(
        `dangling parent reference: ${node.id} -> ${node.parentId}`,
      );
    }
    const children = new Set<string>();
    for (const childId of node.childIds) {
      if (children.has(childId)) {
        throw new LayerModelValidationError(`duplicate child reference: ${node.id} -> ${childId}`);
      }
      children.add(childId);
      const child = byId.get(childId);
      if (!child)
        throw new LayerModelValidationError(`dangling child reference: ${node.id} -> ${childId}`);
      if (child.parentId !== node.id) {
        throw new LayerModelValidationError(
          `parent mismatch: ${childId} -> ${child.parentId ?? "null"}`,
        );
      }
    }
    if (node.maskId !== null && !byId.has(node.maskId)) {
      throw new LayerModelValidationError(`dangling mask reference: ${node.id} -> ${node.maskId}`);
    }
    if (node.maskKind !== null && node.maskId === null) {
      throw new LayerModelMaskValidationError(
        `mask kind requires mask reference: ${node.id} -> ${String(node.maskKind)}`,
      );
    }
    if (node.maskDensity < 0 || node.maskDensity > 1 || !Number.isFinite(node.maskDensity)) {
      throw new LayerModelMaskValidationError(`invalid mask density: ${node.id}`);
    }
    if (!Number.isFinite(node.maskFeather) || node.maskFeather < 0) {
      throw new LayerModelMaskValidationError(`invalid mask feather: ${node.id}`);
    }
    if (node.maskType !== null && node.maskId === null) {
      throw new LayerModelMaskValidationError(
        `mask type requires mask reference: ${node.id} -> ${String(node.maskType)}`,
      );
    }
    if (node.maskType === "VECTOR" && !node.vectorMask) {
      throw new LayerModelMaskValidationError(`vector mask flag mismatch: ${node.id}`);
    }
    if (node.maskType !== "VECTOR" && node.vectorMask) {
      throw new LayerModelMaskValidationError(`vector mask flag mismatch: ${node.id}`);
    }
    if (
      node.edgeRefinement !== null &&
      (node.edgeRefinement.smooth > 100 ||
        node.edgeRefinement.feather < 0 ||
        node.edgeRefinement.contrast < -100 ||
        node.edgeRefinement.contrast > 100 ||
        node.edgeRefinement.shiftEdge < -100 ||
        node.edgeRefinement.shiftEdge > 100)
    ) {
      throw new LayerModelMaskValidationError(`invalid edge refinement: ${node.id}`);
    }
    if (node.maskTransformMode === "independent" && node.maskTransform === null) {
      throw new LayerModelMaskValidationError(
        `independent mask transform requires transform: ${node.id}`,
      );
    }
    if (
      (node.maskTransformMode === "independent" || node.maskTransform !== null) &&
      node.maskId === null
    ) {
      throw new LayerModelMaskValidationError(
        `mask transform requires mask reference: ${node.id}`,
      );
    }
    if (
      node.maskTransform !== null &&
      node.maskTransform.some((value) => !Number.isFinite(value))
    ) {
      throw new LayerModelMaskValidationError(`invalid mask transform: ${node.id}`);
    }
    if (node.maskTransform !== null && node.maskTransform.length !== 6) {
      throw new LayerModelMaskValidationError(`invalid mask transform: ${node.id}`);
    }
    if (node.maskId === node.id) {
      throw new LayerModelMaskValidationError(`self-referencing mask: ${node.id}`);
    }
    if (node.linkedLayerIds.includes(node.id)) {
      throw new LayerModelValidationError(`self-referencing layer link: ${node.id}`);
    }
    if (new Set(node.linkedLayerIds).size !== node.linkedLayerIds.length) {
      throw new LayerModelValidationError(`duplicate linked layer reference: ${node.id}`);
    }
    for (const linkedId of node.linkedLayerIds) {
      if (!byId.has(linkedId)) {
        throw new LayerModelValidationError(
          `dangling linked layer reference: ${node.id} -> ${linkedId}`,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new LayerModelValidationError(`cyclic layer parent link: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const childId of byId.get(id)?.childIds ?? []) visit(childId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);

  const maskVisiting = new Set<string>();
  const maskVisited = new Set<string>();
  const visitMask = (id: string): void => {
    if (maskVisiting.has(id)) throw new LayerModelMaskValidationError(`cyclic mask reference: ${id}`);
    if (maskVisited.has(id)) return;
    maskVisiting.add(id);
    const maskId = byId.get(id)?.maskId;
    if (maskId !== null && maskId !== undefined) visitMask(maskId);
    maskVisiting.delete(id);
    maskVisited.add(id);
  };
  for (const node of nodes) visitMask(node.id);
}

export async function migrateLayerModel(
  input: readonly LayerModelNodeInput[] | ReadonlyMap<string, LayerModelNodeInput>,
  previous?: LayerModel,
): Promise<LayerModelMigration> {
  const nodes = nodeList(input);
  validateNodes(nodes);
  const ordered = nodes.slice().sort((left, right) => left.id.localeCompare(right.id));
  const migrationHash = `sha256:${await sha256(canonicalJson(ordered))}`;
  const model: LayerModel = {
    version: LAYER_MODEL_VERSION,
    migrationHash,
    nodes: new Map(ordered.map((node) => [node.id, node])),
  };
  const invalidatedNodeIds = previous
    ? ordered
        .filter((node) => JSON.stringify(node) !== JSON.stringify(previous.nodes.get(node.id)))
        .map((node) => node.id)
    : ordered.map((node) => node.id);
  return { model, cycles: 0, danglingRefs: 0, invalidatedNodeIds };
}

export class LayerModelTransaction {
  private current: LayerModel;

  constructor(initial: LayerModel) {
    this.current = initial;
  }

  get model(): LayerModel {
    return this.current;
  }

  async commit(
    baseMigrationHash: string,
    input: readonly LayerModelNodeInput[] | ReadonlyMap<string, LayerModelNodeInput>,
  ): Promise<LayerModelMigration> {
    if (baseMigrationHash !== this.current.migrationHash) {
      throw new LayerModelTransactionConflict("layer model changed before commit");
    }
    const next = await migrateLayerModel(input, this.current);
    this.current = next.model;
    return next;
  }
}

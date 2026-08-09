import type { BlendMode, NodeType, SceneNode } from "#core/scene-graph";

export const LAYER_MODEL_VERSION = "layer-model-v1";

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

export type LayerModelNodeInput = Omit<
  Pick<SceneNode, "id" | "parentId" | "childIds" | "blendMode">,
  "blendMode"
> & {
  readonly blendMode: BlendMode | string;
  readonly type?: NodeType | string;
  readonly maskId?: string | null;
  readonly maskKind?: LayerModelMaskKind | string | null;
};

export interface LayerModelNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly blendMode: LayerModelResolvedBlendMode;
  readonly type: NodeType | string;
  readonly maskId: string | null;
  readonly maskKind: LayerModelResolvedMaskKind | null;
  readonly groupMask: boolean;
  readonly adjustmentLayerMask: boolean;
  readonly passThrough: boolean;
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

function canonicalNode(node: LayerModelNodeInput): LayerModelNode {
  const type = node.type ?? "GROUP";
  const blendMode = resolveBlendMode(node.blendMode);
  const maskKind = resolveMaskKind(node.maskKind);
  const passThrough = blendMode === "PASS_THROUGH" && type === "GROUP";
  return {
    id: node.id,
    parentId: node.parentId,
    childIds: [...node.childIds],
    blendMode,
    type,
    maskId: node.maskId ?? null,
    maskKind,
    groupMask: maskKind === "group",
    adjustmentLayerMask: maskKind === "adjustment-layer",
    passThrough,
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
        groupMask: node.groupMask,
        adjustmentLayerMask: node.adjustmentLayerMask,
        passThrough: node.passThrough,
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
    if (node.maskId === node.id) {
      throw new LayerModelMaskValidationError(`self-referencing mask: ${node.id}`);
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

import type { BlendMode, NodeType, SceneNode } from "#core/scene-graph";

export const LAYER_MODEL_VERSION = "layer-model-v1";

export type LayerModelNodeInput = Pick<SceneNode, "id" | "parentId" | "childIds" | "blendMode"> & {
  readonly type?: NodeType | string;
  readonly maskId?: string | null;
};

export interface LayerModelNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly blendMode: BlendMode | string;
  readonly type: NodeType | string;
  readonly maskId: string | null;
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

export class LayerModelTransactionConflict extends Error {
  readonly code = "layer-model-transaction-conflict";
}

function canonicalNode(node: LayerModelNodeInput): LayerModelNode {
  const type = node.type ?? "GROUP";
  const passThrough = node.blendMode === "PASS_THROUGH" && type === "GROUP";
  return {
    id: node.id,
    parentId: node.parentId,
    childIds: [...node.childIds],
    blendMode: node.blendMode,
    type,
    maskId: node.maskId ?? null,
    passThrough,
  };
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

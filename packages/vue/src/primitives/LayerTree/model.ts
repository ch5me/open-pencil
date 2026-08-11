import type { SceneGraph, SceneNode } from "@open-pencil/core/scene-graph";

import type { LayerNode } from "#vue/primitives/LayerTree/context";

function toLayerNode(node: SceneNode): LayerNode {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    layoutMode: node.layoutMode,
    visible: node.visible,
    locked: node.locked,
  };
}

export interface LayerTreeModel {
  items: LayerNode[];
  byId: Map<string, LayerNode>;
}

export function buildLayerTreeModel(graph: SceneGraph, parentId: string): LayerTreeModel {
  const byId = new Map<string, LayerNode>();

  function buildChildren(id: string): LayerNode[] {
    const parent = graph.getNode(id);
    if (!parent) return [];

    const children: LayerNode[] = [];
    for (const childId of parent.childIds) {
      const sceneNode = graph.getNode(childId);
      if (!sceneNode || sceneNode.internalOnly) continue;

      const node = toLayerNode(sceneNode);
      byId.set(node.id, node);
      if (sceneNode.childIds.length > 0) node.children = buildChildren(node.id);
      children.push(node);
    }
    return children;
  }

  return { items: buildChildren(parentId), byId };
}

export function indexLayerNodes(items: readonly LayerNode[]): Map<string, LayerNode> {
  const byId = new Map<string, LayerNode>();

  function visit(nodes: readonly LayerNode[]) {
    for (const node of nodes) {
      byId.set(node.id, node);
      if (node.children) visit(node.children);
    }
  }

  visit(items);
  return byId;
}

export function retainLayerExpansion(
  expandedIds: readonly string[],
  byId: ReadonlyMap<string, LayerNode>,
): string[] {
  return expandedIds.filter((id) => byId.has(id));
}

export function isNodeWithinComponent(graph: SceneGraph, nodeId: string | null): boolean {
  let node = nodeId ? graph.getNode(nodeId) : undefined;
  while (node) {
    if (node.type === "COMPONENT") return true;
    node = node.parentId ? graph.getNode(node.parentId) : undefined;
  }
  return false;
}

export function createLayerTreeRebuildScheduler(rebuild: () => void) {
  let pending = false;
  let generation = 0;
  let disposed = false;

  function flush(expectedGeneration: number) {
    if (disposed || !pending || generation !== expectedGeneration) return;
    pending = false;
    rebuild();
  }

  function schedule(afterComponentSync = false) {
    if (disposed || pending) return;
    pending = true;
    const expectedGeneration = ++generation;
    if (afterComponentSync) {
      queueMicrotask(() => queueMicrotask(() => flush(expectedGeneration)));
    } else {
      queueMicrotask(() => flush(expectedGeneration));
    }
  }

  function cancel() {
    pending = false;
    generation++;
  }

  function dispose() {
    disposed = true;
    cancel();
  }

  return { schedule, cancel, dispose };
}

export function patchLayerNode(target: LayerNode, source: SceneNode): boolean {
  const changed =
    target.name !== source.name ||
    target.type !== source.type ||
    target.layoutMode !== source.layoutMode ||
    target.visible !== source.visible ||
    target.locked !== source.locked;
  if (!changed) return false;

  target.name = source.name;
  target.type = source.type;
  target.layoutMode = source.layoutMode;
  target.visible = source.visible;
  target.locked = source.locked;
  return true;
}

import { describe, expect, test } from "bun:test";

import { createRect, firstPageId, makeSceneGraph } from "#tests/helpers/scene";
import {
  buildLayerTreeModel,
  indexLayerNodes,
  patchLayerNode,
  retainLayerExpansion,
} from "#vue/primitives/LayerTree/model";

describe("layer tree model", () => {
  test("builds indexed nested items in scene order", () => {
    const graph = makeSceneGraph();
    const pageId = firstPageId(graph);
    const frame = graph.createNode("FRAME", pageId, { name: "Frame" });
    const child = createRect(graph, frame.id, { name: "Child" });
    const sibling = createRect(graph, pageId, { name: "Sibling" });
    const internal = graph.createNode("RECTANGLE", pageId, {
      name: "Internal style",
      internalOnly: true,
    });

    const model = buildLayerTreeModel(graph, pageId);

    expect(model.items.map((node) => node.id)).toEqual([frame.id, sibling.id]);
    expect(model.items[0]?.children?.map((node) => node.id)).toEqual([child.id]);
    expect(model.byId.get(child.id)?.name).toBe("Child");
    expect(model.byId.has(internal.id)).toBe(false);
  });

  test("patches display fields without replacing node identity", () => {
    const graph = makeSceneGraph();
    const pageId = firstPageId(graph);
    const sceneNode = createRect(graph, pageId, { name: "Before" });
    const model = buildLayerTreeModel(graph, pageId);
    const items = model.items;
    const layerNode = indexLayerNodes(items).get(sceneNode.id);
    expect(layerNode).toBeDefined();
    if (!layerNode) return;

    graph.updateNode(sceneNode.id, { name: "After", visible: false });
    const updated = graph.getNode(sceneNode.id);
    expect(updated).toBeDefined();
    if (!updated) return;

    expect(patchLayerNode(layerNode, updated)).toBe(true);
    expect(items[0]).toBe(layerNode);
    expect(layerNode).toMatchObject({ name: "After", visible: false });
    expect(patchLayerNode(layerNode, updated)).toBe(false);
  });

  test("ignores geometry-only edits", () => {
    const graph = makeSceneGraph();
    const pageId = firstPageId(graph);
    const sceneNode = createRect(graph, pageId, { name: "Stable", x: 1, y: 2 });
    const model = buildLayerTreeModel(graph, pageId);
    const layerNode = model.byId.get(sceneNode.id);
    expect(layerNode).toBeDefined();
    if (!layerNode) return;

    graph.updateNode(sceneNode.id, { x: 20, y: 30 });
    const updated = graph.getNode(sceneNode.id);
    expect(updated).toBeDefined();
    if (!updated) return;

    expect(patchLayerNode(layerNode, updated)).toBe(false);
    expect(model.items[0]).toBe(layerNode);
    expect(layerNode.name).toBe("Stable");
  });

  test("retains expansion only for nodes still in the rebuilt model", () => {
    const graph = makeSceneGraph();
    const pageId = firstPageId(graph);
    const frame = graph.createNode("FRAME", pageId, { name: "Frame" });
    const model = buildLayerTreeModel(graph, pageId);

    expect(retainLayerExpansion([frame.id, "deleted"], model.byId)).toEqual([frame.id]);
  });
});

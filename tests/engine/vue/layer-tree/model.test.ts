import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { SceneNode } from "@open-pencil/core";
import { createEditor } from "@open-pencil/core/editor";

import { createRect, firstPageId, makeSceneGraph } from "#tests/helpers/scene";
import type { LayerTreeContext } from "#vue/primitives/LayerTree/context";
import {
  buildLayerTreeModel,
  createLayerTreeRebuildScheduler,
  indexLayerNodes,
  isNodeWithinComponent,
  patchLayerNode,
  retainLayerExpansion,
} from "#vue/primitives/LayerTree/model";

function hasPatchableComponentChange(changes: Partial<SceneNode>): boolean {
  return "name" in changes || "layoutMode" in changes;
}

describe("layer tree model", () => {
  test("keeps treeKey context and tree-key slot compatibility aliases", () => {
    const aliasTypeMatches: LayerTreeContext["treeKey"] extends LayerTreeContext["treeVersion"]
      ? true
      : false = true;
    const rootSource = readFileSync(
      "packages/vue/src/primitives/LayerTree/LayerTreeRoot.vue",
      "utf8",
    );

    expect(aliasTypeMatches).toBe(true);
    expect(rootSource).toContain("treeKey: treeVersion");
    expect(rootSource).toContain(':tree-key="treeVersion"');
  });

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

  test("rebuilds after component synchronization updates instance child fields and order", async () => {
    const editor = createEditor();
    const pageId = editor.state.currentPageId;
    const component = editor.graph.createNode("COMPONENT", pageId, { name: "Card" });
    const first = editor.graph.createNode("FRAME", component.id, {
      name: "First",
      layoutMode: "NONE",
    });
    const second = editor.graph.createNode("FRAME", component.id, { name: "Second" });
    const instance = editor.graph.createInstance(component.id, pageId);
    expect(instance).toBeDefined();
    if (!instance) return;

    let model = buildLayerTreeModel(editor.graph, pageId);
    const scheduler = createLayerTreeRebuildScheduler(() => {
      model = buildLayerTreeModel(editor.graph, pageId);
    });
    const stop = [
      editor.onEditorEvent("node:updated", (id, changes) => {
        if (hasPatchableComponentChange(changes) && isNodeWithinComponent(editor.graph, id)) {
          scheduler.schedule(true);
        }
      }),
      editor.onEditorEvent("node:reordered", (_, parentId) => {
        scheduler.schedule(isNodeWithinComponent(editor.graph, parentId));
      }),
    ];

    editor.graph.updateNode(first.id, { name: "First synced", layoutMode: "VERTICAL" });
    editor.graph.reorderChild(second.id, component.id, 0);

    await Promise.resolve();
    const staleInstance = model.byId.get(instance.id);
    expect(staleInstance?.children?.map((node) => node.name)).toEqual(["First", "Second"]);

    await Promise.resolve();
    const syncedInstance = model.byId.get(instance.id);
    expect(syncedInstance?.children?.map((node) => node.name)).toEqual(["Second", "First synced"]);
    expect(syncedInstance?.children?.[1]?.layoutMode).toBe("VERTICAL");

    for (const unsubscribe of stop) unsubscribe();
    scheduler.dispose();
  });

  test("coalesces structural rebuilds and cancels pending work on disposal", async () => {
    let rebuilds = 0;
    const scheduler = createLayerTreeRebuildScheduler(() => rebuilds++);

    scheduler.schedule();
    scheduler.schedule();
    await Promise.resolve();
    expect(rebuilds).toBe(1);

    scheduler.schedule(true);
    scheduler.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(rebuilds).toBe(1);
  });

  test("upgrades a pending immediate rebuild to run after component synchronization", async () => {
    let componentSynced = false;
    const observedSyncState: boolean[] = [];
    const scheduler = createLayerTreeRebuildScheduler(() => {
      observedSyncState.push(componentSynced);
    });

    scheduler.schedule(false);
    scheduler.schedule(true);
    queueMicrotask(() => {
      componentSynced = true;
    });

    await Promise.resolve();
    expect(observedSyncState).toEqual([]);
    await Promise.resolve();
    expect(observedSyncState).toEqual([true]);
  });
});

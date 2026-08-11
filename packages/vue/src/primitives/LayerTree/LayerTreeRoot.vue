<script setup lang="ts">
import type { SceneNode } from "@open-pencil/core/scene-graph";
import { TreeRoot } from "reka-ui";
import { computed, nextTick, onScopeDispose, ref, watch } from "vue";

import { useEditor } from "#vue/editor/context";
import { provideLayerTree } from "#vue/primitives/LayerTree/context";
import type { LayerNode } from "#vue/primitives/LayerTree/context";
import {
  buildLayerTreeModel,
  createLayerTreeRebuildScheduler,
  indexLayerNodes,
  isNodeWithinComponent,
  patchLayerNode,
  retainLayerExpansion,
} from "#vue/primitives/LayerTree/model";
import { useLayerDrag } from "#vue/primitives/LayerTree/useLayerDrag";

const { indentPerLevel = 16 } = defineProps<{
  indentPerLevel?: number;
}>();

const emit = defineEmits<{
  select: [id: string, additive: boolean];
  toggleExpand: [id: string];
  toggleVisibility: [id: string];
  toggleLock: [id: string];
  rename: [id: string, name: string];
}>();

const editor = useEditor();

function expandNode(id: string) {
  if (!expanded.value.includes(id)) expanded.value = [...expanded.value, id];
}

const { draggingId, instruction, instructionTargetId, setupItem } = useLayerDrag(
  editor,
  indentPerLevel,
  expandNode,
);

const initialModel = buildLayerTreeModel(editor.graph, editor.state.currentPageId);
const items = ref(initialModel.items);
const treeVersion = ref(0);
const expanded = ref<string[]>([]);
const selectedIds = computed(() => editor.state.selectedIds);
let nodesById = indexLayerNodes(items.value);

function rebuildTree() {
  rebuildScheduler.cancel();
  const model = buildLayerTreeModel(editor.graph, editor.state.currentPageId);
  items.value = model.items;
  nodesById = indexLayerNodes(items.value);
  expanded.value = retainLayerExpansion(expanded.value, nodesById);
  treeVersion.value++;
}

const rebuildScheduler = createLayerTreeRebuildScheduler(rebuildTree);

const PATCHABLE_NODE_KEYS = new Set<keyof SceneNode>([
  "name",
  "type",
  "layoutMode",
  "visible",
  "locked",
]);

function patchTreeNode(id: string, changes: Partial<SceneNode>) {
  if ("childIds" in changes || "parentId" in changes) {
    rebuildScheduler.schedule(isNodeWithinComponent(editor.graph, id));
    return;
  }
  if (!(Object.keys(changes) as (keyof SceneNode)[]).some((key) => PATCHABLE_NODE_KEYS.has(key))) {
    return;
  }

  const target = nodesById.get(id);
  const source = editor.graph.getNode(id);
  if (target && source) patchLayerNode(target, source);
  if (isNodeWithinComponent(editor.graph, id)) rebuildScheduler.schedule(true);
}

const unsubscribe = [
  editor.onEditorEvent("graph:replaced", rebuildTree),
  editor.onEditorEvent("page:changed", rebuildTree),
  editor.onEditorEvent("node:created", (node) => {
    rebuildScheduler.schedule(isNodeWithinComponent(editor.graph, node.id));
  }),
  editor.onEditorEvent("node:deleted", () => rebuildScheduler.schedule(true)),
  editor.onEditorEvent("node:reparented", (nodeId, oldParentId, newParentId) => {
    rebuildScheduler.schedule(
      isNodeWithinComponent(editor.graph, nodeId) ||
        isNodeWithinComponent(editor.graph, oldParentId) ||
        isNodeWithinComponent(editor.graph, newParentId),
    );
  }),
  editor.onEditorEvent("node:reordered", (_, parentId) => {
    rebuildScheduler.schedule(isNodeWithinComponent(editor.graph, parentId));
  }),
  editor.onEditorEvent("node:updated", patchTreeNode),
];

onScopeDispose(() => {
  for (const stop of unsubscribe) stop();
  rebuildScheduler.dispose();
});

const rowRefs = new Map<string, HTMLElement>();

function setRowRef(id: string, el: HTMLElement | null) {
  if (el) rowRefs.set(id, el);
  else rowRefs.delete(id);
}

watch(
  () => editor.state.selectedIds,
  (ids) => {
    const toExpand = new Set(expanded.value);
    for (const id of ids) {
      let node = editor.graph.getNode(id);
      while (node?.parentId && node.parentId !== editor.state.currentPageId) {
        toExpand.add(node.parentId);
        node = editor.graph.getNode(node.parentId);
      }
    }
    if (toExpand.size > expanded.value.length) expanded.value = [...toExpand];
    nextTick(() => {
      const first = [...ids][0];
      if (first) rowRefs.get(first)?.scrollIntoView({ block: "nearest" });
    });
  },
);

function syncCanvasScope(nodeId: string) {
  const node = editor.graph.getNode(nodeId);
  if (!node) return;
  let parentId = node.parentId;
  while (parentId && parentId !== editor.state.currentPageId) {
    if (editor.graph.isContainer(parentId)) {
      editor.enterContainer(parentId);
      return;
    }
    const parent = editor.graph.getNode(parentId);
    parentId = parent?.parentId ?? null;
  }
  editor.state.enteredContainerId = null;
}

function select(id: string, additive: boolean) {
  emit("select", id, additive);
  if (additive) {
    editor.select([id], true);
  } else {
    editor.select([id]);
    syncCanvasScope(id);
  }
}

function toggleExpand(id: string) {
  emit("toggleExpand", id);
  const idx = expanded.value.indexOf(id);
  if (idx !== -1) expanded.value = expanded.value.filter((e) => e !== id);
  else expandNode(id);
}

function getKey(node: LayerNode) {
  return node.id;
}

function getChildren(node: LayerNode) {
  return node.children;
}

const actions = {
  select,
  toggleExpand,
};

provideLayerTree({
  editor,
  items,
  expanded,
  treeKey: treeVersion,
  treeVersion,
  selectedIds,
  indentPerLevel,
  draggingId,
  instruction,
  instructionTargetId,
  setupDrag: setupItem,
  select,
  toggleExpand,
  toggleVisibility: (id: string) => {
    emit("toggleVisibility", id);
    editor.toggleNodeVisibility(id);
  },
  toggleLock: (id: string) => {
    emit("toggleLock", id);
    editor.toggleNodeLock(id);
  },
  rename: (id: string, name: string) => {
    emit("rename", id, name);
    editor.renameNode(id, name);
  },
  setRowRef,
});
</script>

<template>
  <TreeRoot
    v-slot="{ flattenItems }"
    v-model:expanded="expanded"
    as="div"
    class="flex min-h-0 flex-1 flex-col overflow-hidden"
    :items="items"
    :get-key="getKey"
    :get-children="getChildren"
  >
    <slot
      :items="items"
      :flatten-items="flattenItems"
      :expanded="expanded"
      :tree-key="treeVersion"
      :tree-version="treeVersion"
      :selected-ids="selectedIds"
      :dragging-id="draggingId"
      :instruction="instruction"
      :instruction-target-id="instructionTargetId"
      :actions="actions"
    />
  </TreeRoot>
</template>

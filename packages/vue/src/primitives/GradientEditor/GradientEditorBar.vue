<script setup lang="ts">
import type { GradientStop } from "@open-pencil/core/scene-graph";
import { templateRef } from "@vueuse/core";
import { onBeforeUnmount, ref } from "vue";

import { createRafCoalescer } from "#vue/shared/input/raf-scheduler";

const { stops, ui } = defineProps<{
  stops: GradientStop[];
  activeStopIndex: number;
  barBackground: string;
  ui?: {
    bar?: string;
  };
}>();

const emit = defineEmits<{
  selectStop: [index: number];
  dragStop: [index: number, position: number];
}>();

const barRef = templateRef<HTMLElement>("barRef");
const draggingIndex = ref<number | null>(null);
const pendingDrag = createRafCoalescer(
  ({ index, position }: { index: number; position: number }) => emit("dragStop", index, position),
);

function stopPointerDown(index: number, e: PointerEvent) {
  emit("selectStop", index);
  draggingIndex.value = index;
  barRef.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  const el = barRef.value;
  if (!el || draggingIndex.value === null || !el.hasPointerCapture(e.pointerId)) return;
  const rect = el.getBoundingClientRect();
  const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  pendingDrag.push({ index: draggingIndex.value, position: pos });
}

function onPointerUp() {
  pendingDrag.flush();
  pendingDrag.cancel();
  draggingIndex.value = null;
}

function onPointerCancel() {
  pendingDrag.cancel();
  draggingIndex.value = null;
}

onBeforeUnmount(onPointerCancel);

const actions = {
  stopPointerDown,
};

defineExpose({ barRef });
</script>

<template>
  <div
    ref="barRef"
    :class="ui?.bar"
    :style="{ background: barBackground }"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <slot
      :stops="stops"
      :active-stop-index="activeStopIndex"
      :bar-background="barBackground"
      :actions="actions"
      :dragging-index="draggingIndex"
    />
  </div>
</template>

<script setup lang="ts">
import { useEventListener } from "@vueuse/core";
import { onBeforeUnmount, ref, computed, toRef, watch } from "vue";

import { provideScrubInput } from "#vue/primitives/ScrubInput/context";
import { inputNumberValue } from "#vue/shared/dom-events";
import { createRafCoalescer } from "#vue/shared/input/raf-scheduler";

const {
  modelValue,
  min = -Infinity,
  max = Infinity,
  step = 1,
  sensitivity = 1,
  placeholder = "Mixed",
} = defineProps<{
  modelValue: number | symbol;
  min?: number;
  max?: number;
  step?: number;
  sensitivity?: number;
  placeholder?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: number];
  commit: [value: number, previous: number];
  "editing-change": [editing: boolean];
}>();

const editing = ref(false);
const scrubbing = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

const isMixed = computed(() => typeof modelValue === "symbol");
const numericValue = computed(() => (isMixed.value ? 0 : (modelValue as number)));
const displayValue = computed(() => (isMixed.value ? "" : String(Math.round(numericValue.value))));

let stopMove: (() => void) | undefined;
let stopUp: (() => void) | undefined;
let stopCancel: (() => void) | undefined;
let cancelScrub: (() => void) | undefined;

function startScrub(e: PointerEvent) {
  e.preventDefault();
  cancelScrub?.();
  const startX = e.clientX;
  let lastX = startX;
  let currentValue = numericValue.value;
  const valueBeforeScrub = currentValue;
  let hasMoved = false;
  const pendingDelta = createRafCoalescer(
    (delta: number) => {
      currentValue += delta * step * sensitivity;
      const clamped = Math.round(Math.min(max, Math.max(min, currentValue)));
      if (clamped !== currentValue) currentValue = clamped;
      if (clamped !== modelValue) emit("update:modelValue", clamped);
    },
    (pending, next) => pending + next,
  );

  function finish(commit: boolean) {
    if (commit) pendingDelta.flush();
    else pendingDelta.cancel();
    stopMove?.();
    stopUp?.();
    stopCancel?.();
    stopMove = undefined;
    stopUp = undefined;
    stopCancel = undefined;
    pendingDelta.cancel();
    scrubbing.value = false;
    document.body.style.cursor = "";
    cancelScrub = undefined;
    if (commit && hasMoved && currentValue !== valueBeforeScrub) {
      emit("commit", currentValue, valueBeforeScrub);
    }
  }

  cancelScrub = () => finish(false);
  stopMove = useEventListener(document, "pointermove", (ev: PointerEvent) => {
    const dx = ev.clientX - lastX;
    lastX = ev.clientX;
    if (!hasMoved && Math.abs(ev.clientX - startX) > 2) {
      hasMoved = true;
      scrubbing.value = true;
      document.body.style.cursor = "ew-resize";
    }
    if (hasMoved) pendingDelta.push(dx);
  });

  stopUp = useEventListener(document, "pointerup", () => {
    if (!hasMoved) {
      finish(false);
      startEdit();
      return;
    }
    finish(true);
  });
  stopCancel = useEventListener(document, "pointercancel", () => finish(false));
}

onBeforeUnmount(() => cancelScrub?.());

function startEdit() {
  editing.value = true;
  requestAnimationFrame(() => {
    const input = inputRef.value;
    if (input) {
      input.focus();
      input.select();
    }
  });
}

function commitEdit(e: Event) {
  if (!editing.value) return;
  const val = inputNumberValue(e);
  const previous = numericValue.value;
  editing.value = false;
  if (!Number.isNaN(val)) {
    const clamped = Math.min(max, Math.max(min, val));
    emit("update:modelValue", clamped);
    if (clamped !== previous) emit("commit", clamped, previous);
  }
}

function liveUpdate(e: Event) {
  const val = inputNumberValue(e);
  if (!Number.isNaN(val)) {
    const clamped = Math.min(max, Math.max(min, val));
    emit("update:modelValue", clamped);
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.code === "Enter") commitEdit(e);
  else if (e.code === "Escape") editing.value = false;
}

const ctx = {
  modelValue: toRef(() => modelValue),
  displayValue,
  isMixed,
  editing,
  scrubbing,
  inputRef,
  startScrub,
  startEdit,
  liveUpdate,
  commitEdit,
  onKeydown,
};

const actions = {
  startScrub,
  startEdit,
  commitEdit,
  keydown: onKeydown,
};

provideScrubInput(ctx);

watch(editing, (v) => emit("editing-change", v));
</script>

<template>
  <slot
    :model-value="modelValue"
    :display-value="displayValue"
    :is-mixed="isMixed"
    :editing="editing"
    :scrubbing="scrubbing"
    :actions="actions"
    :placeholder="placeholder"
  />
</template>

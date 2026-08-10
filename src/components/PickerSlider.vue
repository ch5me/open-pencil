<script setup lang="ts">
import {
  createRafCoalescer,
  inputNumberValue,
  vTestId,
  type TestIdProps,
} from "@open-pencil/vue";
import { onBeforeUnmount } from "vue";

import { usePickerSliderUI } from "./ui/picker-slider";

type PickerSliderDisplay = {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  format?: (value: number) => string | number;
  parse?: (value: number) => number;
};

interface PickerSliderProps extends TestIdProps {
  label: string;
  modelValue: number;
  min: number;
  max: number;
  step?: number;
  display?: PickerSliderDisplay;
  gradientStyle?: string;
  checkerboard?: boolean;
  thumbFill?: string;
  ui?: Partial<
    Record<"root" | "label" | "track" | "gradient" | "range" | "thumb" | "input", string>
  >;
}

const {
  label,
  modelValue,
  min,
  max,
  step = 1,
  display,
  gradientStyle,
  checkerboard = false,
  thumbFill = "#fff",
  testId,
  ui,
} = defineProps<PickerSliderProps>();

const emit = defineEmits<{
  "update:modelValue": [value: number];
}>();

const cls = usePickerSliderUI({ checkerboard, ui });
const pendingValue = createRafCoalescer((value: number) => emit("update:modelValue", value));

function numberValue(): string | number {
  const value = display?.value ?? modelValue;
  return display?.format ? display.format(value) : value;
}

function handleNumberChange(value: number) {
  pendingValue.flush();
  pendingValue.cancel();
  emit("update:modelValue", display?.parse ? display.parse(value) : value);
}

function handleRangeInput(value: number) {
  pendingValue.push(value);
}

function handleRangeChange() {
  pendingValue.flush();
  pendingValue.cancel();
}

onBeforeUnmount(pendingValue.cancel);

function thumbLeft(): string {
  const range = max - min;
  const ratio = range === 0 ? 0 : (modelValue - min) / range;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return `calc(${clampedRatio * 100}% - ${clampedRatio * 14}px)`;
}
</script>

<template>
  <div :class="cls.root" v-test-id="testId">
    <span :class="cls.label">{{ label }}</span>
    <div :class="cls.track">
      <div :class="cls.gradient" :style="gradientStyle" />
      <input
        type="range"
        :class="cls.range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        @input="handleRangeInput(inputNumberValue($event))"
        @change="handleRangeChange"
      />
      <div :class="cls.thumb" :style="{ left: thumbLeft(), background: thumbFill }" />
    </div>
    <input
      type="number"
      :class="cls.input"
      :min="display?.min ?? min"
      :max="display?.max ?? max"
      :step="display?.step ?? step"
      :value="numberValue()"
      @change="handleNumberChange(inputNumberValue($event))"
    />
  </div>
</template>

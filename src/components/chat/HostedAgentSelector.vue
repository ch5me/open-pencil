<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { hostedAgentOptions } from '@/app/ai/agent-service/options'
import AppSelect from '@/components/ui/AppSelect.vue'

const { compact = false } = defineProps<{ compact?: boolean }>()
const { dialogs } = useI18n()

const optionItems = computed(
  () =>
    hostedAgentOptions.catalog.value?.options.map((option) => ({
      value: option.optionId,
      label: `${option.group} · ${option.label}`
    })) ?? []
)
const effortItems = computed(
  () =>
    hostedAgentOptions.selectedOption.value?.efforts.map((item) => ({
      value: item.effort,
      label: item.label
    })) ?? []
)
const selectedOptionId = computed({
  get: () => hostedAgentOptions.optionId.value,
  set: hostedAgentOptions.selectOption
})
const selectedEffort = computed({
  get: () => hostedAgentOptions.effort.value,
  set: hostedAgentOptions.selectEffort
})

onMounted(() => {
  if (!hostedAgentOptions.catalog.value) void hostedAgentOptions.load()
})
</script>

<template>
  <div
    class="flex min-w-0 flex-wrap items-center gap-1.5"
    :class="compact ? 'text-[10px]' : 'text-[11px]'"
    data-test-id="hosted-agent-selector"
  >
    <div v-if="hostedAgentOptions.loading.value" class="text-muted" role="status">
      {{ dialogs.requesting }}
    </div>
    <div
      v-else-if="hostedAgentOptions.error.value"
      class="flex items-center gap-1.5 text-red-400"
      role="alert"
    >
      <span>{{ dialogs.unavailable }}: {{ hostedAgentOptions.error.value }}</span>
      <button type="button" class="underline" @click="hostedAgentOptions.load">
        {{ dialogs.refresh }}
      </button>
    </div>
    <div v-else-if="optionItems.length === 0" class="text-red-400" role="alert">
      {{ dialogs.unavailable }}
    </div>
    <template v-else>
      <AppSelect
        v-model="selectedOptionId"
        :options="optionItems"
        :label="dialogs.hostedAgentManagedTitle"
        :ui="{ trigger: compact ? 'h-6 max-w-40 py-0 text-[10px]' : 'max-w-64' }"
      />
      <AppSelect
        v-if="effortItems.length"
        v-model="selectedEffort"
        :options="effortItems"
        :label="dialogs.modelCapabilities"
        :ui="{ trigger: compact ? 'h-6 max-w-28 py-0 text-[10px]' : 'max-w-40' }"
      />
    </template>
  </div>
</template>

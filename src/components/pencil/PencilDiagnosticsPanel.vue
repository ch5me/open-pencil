<script setup lang="ts">
import { computed, ref } from 'vue'

import type { PencilRuntimeSnapshot, PencilScenarioId } from '@/app/pencil/types'
import { scenarioLabel } from '@/app/pencil/evidence'

const { snapshot } = defineProps<{
  snapshot: PencilRuntimeSnapshot
}>()

const emit = defineEmits<{
  begin: []
  complete: []
  clear: []
  export: []
  passScenario: [id: PencilScenarioId, observations: string]
}>()

const notes = ref<Record<string, string>>({})
const latencyP95 = computed(() => {
  const values = [...snapshot.latencySamplesMs].sort((a, b) => a - b)
  if (!values.length) return null
  return values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)]
})

function featureValue(name: keyof NonNullable<PencilRuntimeSnapshot['capabilities']>['features']) {
  return snapshot.capabilities?.features[name] ?? 'unknown'
}
</script>

<template>
  <aside
    data-test-id="pencil-diagnostics"
    class="flex h-full w-[25rem] shrink-0 flex-col border-l border-[#26313b] bg-[#111820] text-[#eaf0f3]"
  >
    <header class="border-b border-[#26313b] p-5">
      <p class="font-mono text-[10px] tracking-[0.24em] text-[#e97436] uppercase">
        Native input lab
      </p>
      <h1 class="mt-2 font-serif text-3xl leading-none">Apple Pencil</h1>
      <p class="mt-3 text-xs leading-5 text-[#8f9da8]">
        Orange marks are transient predictions. Ink is committed input only.
      </p>
    </header>

    <div class="grid grid-cols-2 gap-px border-b border-[#26313b] bg-[#26313b]">
      <div class="bg-[#111820] p-3">
        <span class="block font-mono text-[9px] tracking-widest text-[#71808c] uppercase"
          >Source</span
        >
        <strong data-test-id="pencil-source" class="mt-1 block text-sm">{{
          snapshot.capabilities?.source ?? 'starting'
        }}</strong>
      </div>
      <div class="bg-[#111820] p-3">
        <span class="block font-mono text-[9px] tracking-widest text-[#71808c] uppercase"
          >Latency p95</span
        >
        <strong class="mt-1 block text-sm">{{
          latencyP95 === null ? '—' : `${latencyP95.toFixed(2)} ms`
        }}</strong>
      </div>
      <div class="bg-[#111820] p-3">
        <span class="block font-mono text-[9px] tracking-widest text-[#71808c] uppercase"
          >Queue peak</span
        >
        <strong class="mt-1 block text-sm"
          >{{ snapshot.diagnostics?.maximumQueueDepth ?? 0 }}/512</strong
        >
      </div>
      <div class="bg-[#111820] p-3">
        <span class="block font-mono text-[9px] tracking-widest text-[#71808c] uppercase"
          >Dropped moves</span
        >
        <strong class="mt-1 block text-sm">{{
          snapshot.diagnostics?.droppedMoveSamples ?? 0
        }}</strong>
      </div>
    </div>

    <section class="border-b border-[#26313b] p-4">
      <div class="grid grid-cols-3 gap-2 text-[10px]">
        <div
          v-for="feature in ['pressure', 'tilt', 'hover', 'roll', 'doubleTap', 'squeeze'] as const"
          :key="feature"
          class="rounded border border-[#26313b] px-2 py-1.5"
        >
          <span class="block text-[#71808c]">{{ feature }}</span>
          <strong
            :class="featureValue(feature) === 'available' ? 'text-[#78c596]' : 'text-[#e6b668]'"
          >
            {{ featureValue(feature) }}
          </strong>
        </div>
      </div>
    </section>

    <section class="min-h-0 flex-1 overflow-y-auto p-4">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-mono text-[10px] tracking-[0.2em] text-[#8f9da8] uppercase">
          Hardware scenarios
        </h2>
        <span class="text-xs text-[#71808c]">
          {{ snapshot.scenarios.filter((scenario) => scenario.pass).length }}/{{
            snapshot.scenarios.length
          }}
        </span>
      </div>
      <div class="space-y-2">
        <article
          v-for="scenario in snapshot.scenarios"
          :key="scenario.id"
          class="rounded-lg border border-[#26313b] bg-[#151e27] p-3"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs">{{ scenarioLabel(scenario.id) }}</span>
            <span
              :class="scenario.pass ? 'text-[#78c596]' : 'text-[#71808c]'"
              class="font-mono text-[10px]"
            >
              {{ scenario.pass ? 'PASS' : 'OPEN' }}
            </span>
          </div>
          <div v-if="!scenario.pass" class="mt-2 flex gap-2">
            <input
              v-model="notes[scenario.id]"
              :aria-label="`${scenarioLabel(scenario.id)} observations`"
              class="min-w-0 flex-1 rounded border border-[#2c3945] bg-[#0d141b] px-2 py-1 text-xs outline-none focus:border-[#e97436]"
              placeholder="Measured observation"
            />
            <button
              class="rounded bg-[#e97436] px-2 text-[10px] font-semibold text-[#121820]"
              @click="emit('passScenario', scenario.id, notes[scenario.id] ?? '')"
            >
              Pass
            </button>
          </div>
          <p v-else class="mt-1 text-[10px] text-[#8f9da8]">
            {{
              scenario.observations.note ??
              Object.entries(scenario.observations)
                .map(([key, value]) => `${key}: ${value}`)
                .join(' · ')
            }}
          </p>
        </article>
      </div>
    </section>

    <footer class="grid grid-cols-2 gap-2 border-t border-[#26313b] p-4">
      <button class="rounded border border-[#364552] px-3 py-2 text-xs" @click="emit('begin')">
        Start run
      </button>
      <button class="rounded border border-[#364552] px-3 py-2 text-xs" @click="emit('complete')">
        Finish run
      </button>
      <button class="rounded border border-[#364552] px-3 py-2 text-xs" @click="emit('clear')">
        Clear ink
      </button>
      <button
        class="rounded bg-[#e97436] px-3 py-2 text-xs font-semibold text-[#121820]"
        @click="emit('export')"
      >
        Export JSON
      </button>
    </footer>
  </aside>
</template>

import { computed, readonly, ref } from 'vue'

import * as agentContracts from '@open-pencil/core/agent'

import { readCacheJSON, writeCacheJSON } from '@/app/cache'
import { createHostedRequester } from '@/app/hosted/http'
import type { HostedRequestOptions } from '@/app/hosted/http'

export type HostedAgentEffort = {
  effort: string
  label: string
}

export type HostedAgentOption = {
  optionId: string
  label: string
  group: string
  description?: string
  efforts: HostedAgentEffort[]
  selected?: boolean
  default?: boolean
}

export type HostedAgentOptionCatalog = {
  options: HostedAgentOption[]
}

export type HostedAgentSelection = {
  optionId: string
  effort?: string
}

type CatalogParser = (value: unknown) => HostedAgentOptionCatalog
type StoredSelection = Partial<HostedAgentSelection>

const STORAGE_KEY = 'hosted-agent/selection.json'

function defaultEffort(option: HostedAgentOption | undefined): string {
  if (!option) return ''
  if (option.efforts.some((item) => item.effort === 'medium')) return 'medium'
  return option.efforts.at(0)?.effort ?? ''
}

function catalogParser(): CatalogParser {
  const parser = Reflect.get(agentContracts, 'parseAgentOptionCatalog')
  if (typeof parser !== 'function') {
    throw new TypeError('Hosted agent option catalog support is unavailable.')
  }
  return (value: unknown) => {
    const parsed = parser(value) as {
      options: {
        optionId: string
        label: string
        group: string
        description: string
        efforts: string[]
        selected?: boolean
        default?: boolean
      }[]
    }
    return {
      options: parsed.options.map((option) => ({
        optionId: option.optionId,
        label: option.label,
        group: option.group,
        description: option.description,
        efforts: option.efforts.map((effort) => ({
          effort,
          label: effort.charAt(0).toUpperCase() + effort.slice(1)
        })),
        selected: option.selected,
        default: option.default
      }))
    }
  }
}

export function createHostedAgentOptions(options: HostedRequestOptions = {}) {
  const catalog = ref<HostedAgentOptionCatalog>()
  const loading = ref(false)
  const error = ref<string>()
  const optionId = ref('')
  const effort = ref('')
  const request = createHostedRequester(options)
  let restored = false

  const selectedOption = computed(() =>
    catalog.value?.options.find((option) => option.optionId === optionId.value)
  )
  const selection = computed<HostedAgentSelection | undefined>(() => {
    const option = selectedOption.value
    if (!option) return undefined
    if (!option.efforts.length) return { optionId: option.optionId }
    if (!option.efforts.some((item) => item.effort === effort.value)) return undefined
    return { optionId: option.optionId, effort: effort.value }
  })
  const ready = computed(
    () => !loading.value && !error.value && !!catalog.value?.options.length && !!selection.value
  )

  function persist(): void {
    const value = selection.value
    if (value) void writeCacheJSON(STORAGE_KEY, value)
  }

  function selectOption(value: string): void {
    optionId.value = value
    const option = catalog.value?.options.find((item) => item.optionId === value)
    if (!option?.efforts.some((item) => item.effort === effort.value)) {
      effort.value = defaultEffort(option)
    }
    persist()
  }

  function selectEffort(value: string): void {
    effort.value = value
    persist()
  }

  async function load(): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = undefined
    try {
      if (!restored) {
        restored = true
        const stored = await readCacheJSON<StoredSelection>(STORAGE_KEY)
        optionId.value = typeof stored?.optionId === 'string' ? stored.optionId : ''
        effort.value = typeof stored?.effort === 'string' ? stored.effort : ''
      }
      catalog.value = catalogParser()(await request<unknown>('/api/agent/options'))
      if (!selectedOption.value) {
        const preferred = catalog.value.options.find((option) => option.selected)
        const fallback = catalog.value.options.find((option) => option.default)
        optionId.value =
          preferred?.optionId ?? fallback?.optionId ?? catalog.value.options.at(0)?.optionId ?? ''
      }
      const option = selectedOption.value
      if (!option?.efforts.some((item) => item.effort === effort.value)) {
        effort.value = defaultEffort(option)
      }
      persist()
    } catch (cause) {
      catalog.value = undefined
      error.value = cause instanceof Error ? cause.message : 'Could not load hosted agent options.'
    } finally {
      loading.value = false
    }
  }

  return {
    catalog: readonly(catalog),
    loading: readonly(loading),
    error: readonly(error),
    optionId: readonly(optionId),
    effort: readonly(effort),
    selectedOption,
    selection,
    ready,
    load,
    selectOption,
    selectEffort
  }
}

export const hostedAgentOptions = createHostedAgentOptions()

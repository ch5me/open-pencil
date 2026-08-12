import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

import { isHostedDocsEnabled } from '@/app/hosted/flags'
import { ELF_HOSTED_STORAGE_PROVIDER_ID } from '@/app/hosted/storage/adapter'

import { storageProviderRegistry } from './providers'
import type { StorageFieldID, StorageProviderID } from './types'

export type StoragePreferences = Record<StorageProviderID, Record<StorageFieldID, string>>

const selectedStorageProviderID = useLocalStorage<StorageProviderID>(
  'open-pencil:storage:provider',
  's3-compatible'
)

export function resolveActiveStorageProviderID(
  selectedProviderID: StorageProviderID,
  hostedDocsEnabled: boolean
): StorageProviderID {
  return hostedDocsEnabled ? ELF_HOSTED_STORAGE_PROVIDER_ID : selectedProviderID
}

export const activeStorageProviderID = computed<StorageProviderID>({
  get: () => resolveActiveStorageProviderID(selectedStorageProviderID.value, isHostedDocsEnabled()),
  set: (providerID) => {
    if (!isHostedDocsEnabled()) selectedStorageProviderID.value = providerID
  }
})

const storedPreferences = useLocalStorage<StoragePreferences>('open-pencil:storage:preferences', {})

export function readStoragePreferences(
  providerID: StorageProviderID
): Readonly<Record<StorageFieldID, string>> {
  return { ...storedPreferences.value[providerID] }
}

export function writeStoragePreference(
  providerID: StorageProviderID,
  field: StorageFieldID,
  value: string
): void {
  const provider = storageProviderRegistry.get(providerID)
  if (!provider.preferenceFields.some((definition) => definition.id === field)) {
    throw new Error(`Unknown preference field for ${providerID}: ${field}`)
  }
  storedPreferences.value = {
    ...storedPreferences.value,
    [providerID]: {
      ...storedPreferences.value[providerID],
      [field]: value.trim()
    }
  }
}

export function storagePreferencesComplete(providerID: StorageProviderID): boolean {
  const provider = storageProviderRegistry.get(providerID)
  const preferences = readStoragePreferences(providerID)
  return provider.preferenceFields.every(
    (field) => !field.required || Boolean(preferences[field.id]?.trim())
  )
}

import {
  createHostedStorageAdapter,
  ELF_HOSTED_STORAGE_PROVIDER_ID
} from '@/app/hosted/storage/adapter'

import { defineStorageProvider, StorageProviderRegistry } from './registry'
import { createS3StorageAdapter } from './s3/adapter'

export const S3_STORAGE_PROVIDER = defineStorageProvider({
  id: 's3-compatible',
  label: 'S3 compatible',
  description: 'AWS S3, Backblaze B2, Cloudflare R2, MinIO, and compatible storage',
  preferenceFields: [
    { id: 'endpoint', label: 'Endpoint', kind: 'url', required: true },
    { id: 'bucket', label: 'Bucket', kind: 'text', required: true },
    { id: 'region', label: 'Region', kind: 'text' }
  ],
  credentialFields: [
    { id: 'access-key-id', label: 'Access key ID', required: true },
    { id: 'secret-access-key', label: 'Secret access key', required: true }
  ],
  createAdapter: createS3StorageAdapter
})

export const ELF_HOSTED_STORAGE_PROVIDER = defineStorageProvider({
  id: ELF_HOSTED_STORAGE_PROVIDER_ID,
  label: 'ELF hosted storage',
  description: 'Firefly-managed OpenPencil documents for the current ELF identity',
  preferenceFields: [],
  credentialFields: [],
  createAdapter: createHostedStorageAdapter
})

export const storageProviderRegistry = new StorageProviderRegistry([
  S3_STORAGE_PROVIDER,
  ELF_HOSTED_STORAGE_PROVIDER
])

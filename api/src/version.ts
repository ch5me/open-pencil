import packageJson from '../package.json'

export interface WorkerVersionMetadata {
  id?: string
  tag?: string
  timestamp?: string
}

export interface ApiVersionInfo {
  version: string
  deployedAt: string
  workerVersionId: string | null
  workerVersionTag: string | null
}

export function getApiVersionInfo(meta?: WorkerVersionMetadata): ApiVersionInfo {
  return {
    version: packageJson.version,
    deployedAt: meta?.timestamp ?? 'unknown',
    workerVersionId: meta?.id ?? null,
    workerVersionTag: meta?.tag ?? null,
  }
}

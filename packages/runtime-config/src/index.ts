import environmentTargetsJson from '../../../config/environment-targets.json'
import runtimeRequirementsJson from '../../../config/runtime-requirements.json'

export const OPENPENCIL_STAGES = ['local', 'staging', 'production'] as const
export type OpenPencilStage = (typeof OPENPENCIL_STAGES)[number]
export const OPENPENCIL_RUNTIME_SURFACES = ['api'] as const
export type OpenPencilRuntimeSurface = (typeof OPENPENCIL_RUNTIME_SURFACES)[number]
export const OPENPENCIL_RUNTIME_DELIVERIES = ['secret', 'variable'] as const
export type OpenPencilRuntimeDelivery = (typeof OPENPENCIL_RUNTIME_DELIVERIES)[number]

export interface OpenPencilRuntimeRequirement {
  name: string
  delivery: OpenPencilRuntimeDelivery
  requiredIn: OpenPencilStage[]
  description: string
}

export interface OpenPencilRuntimeValidationResult {
  missing: OpenPencilRuntimeRequirement[]
  present: OpenPencilRuntimeRequirement[]
}

export interface OpenPencilEnvironmentTarget {
  stage: OpenPencilStage
  displayName: string
  apiBaseUrl: string
  appUrl: string
  siteUrl: string
  assetBaseUrl: string
  webProject: string
  workerEnv: string
  workerName: string
  d1DatabaseName: string
  d1DatabaseId: string
  r2Bucket: string
  r2AssetsBucket: string
}

type EnvironmentTargetsJson = Record<OpenPencilStage, Omit<OpenPencilEnvironmentTarget, 'stage'> & { stage: string }>
type RuntimeRequirementsJson = Record<OpenPencilRuntimeSurface, OpenPencilRuntimeRequirement[]>

const targetsBySource = environmentTargetsJson as EnvironmentTargetsJson
const runtimeRequirementsBySource = runtimeRequirementsJson as RuntimeRequirementsJson

export const OPENPENCIL_ENVIRONMENT_TARGETS: Record<OpenPencilStage, OpenPencilEnvironmentTarget> = {
  local: targetsBySource.local as OpenPencilEnvironmentTarget,
  staging: targetsBySource.staging as OpenPencilEnvironmentTarget,
  production: targetsBySource.production as OpenPencilEnvironmentTarget,
}

export function getOpenPencilEnvironmentTarget(stage: OpenPencilStage): OpenPencilEnvironmentTarget {
  return OPENPENCIL_ENVIRONMENT_TARGETS[stage]
}

export function getOpenPencilRuntimeRequirements(
  surface: OpenPencilRuntimeSurface,
  stage: OpenPencilStage
): OpenPencilRuntimeRequirement[] {
  return runtimeRequirementsBySource[surface].filter((r) => r.requiredIn.includes(stage))
}

export function getOpenPencilRuntimeSecretNames(surface: OpenPencilRuntimeSurface, stage: OpenPencilStage): string[] {
  return getOpenPencilRuntimeRequirements(surface, stage)
    .filter((r) => r.delivery === 'secret')
    .map((r) => r.name)
}

export function getOpenPencilRuntimeVariableNames(surface: OpenPencilRuntimeSurface, stage: OpenPencilStage): string[] {
  return getOpenPencilRuntimeRequirements(surface, stage)
    .filter((r) => r.delivery === 'variable')
    .map((r) => r.name)
}

export function validateOpenPencilRuntimeConfig(
  surface: OpenPencilRuntimeSurface,
  stage: OpenPencilStage,
  values: Record<string, string | null | undefined>
): OpenPencilRuntimeValidationResult {
  const required = getOpenPencilRuntimeRequirements(surface, stage)
  const missing = required.filter((r) => {
    const value = values[r.name]
    return typeof value !== 'string' || value.trim().length === 0
  })
  return {
    missing,
    present: required.filter((r) => !missing.some((m) => m.name === r.name)),
  }
}

export const LOCAL_OPENPENCIL_APP_URL = OPENPENCIL_ENVIRONMENT_TARGETS.local.appUrl
export const LOCAL_OPENPENCIL_API_URL = OPENPENCIL_ENVIRONMENT_TARGETS.local.apiBaseUrl

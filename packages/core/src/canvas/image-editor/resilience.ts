import { MEMORY_PROFILE_LIMITS, type MemoryProfile } from "#core/io/transactional/protocol";

import {
  createImageTilePlan,
  ImageTextureMemoryBudgetError,
  ImageTilePlanLimitError,
  type ImageTilePlan,
} from "./tiling";
import {
  ImageRenderContextLostError,
  UnsupportedImageBackendError,
  createRendererResilienceContract,
  type ImageRenderAdapter,
  type RendererResilienceContract,
} from "./types";

export class RetryPolicyError extends Error {
  readonly code = "E_IMAGE_RETRY_POLICY";
  readonly name = "RetryPolicyError";
}

export class RetryExhaustedError extends Error {
  readonly code = "E_IMAGE_RETRY_EXHAUSTED";
  readonly name = "RetryExhaustedError";
  readonly attempts: number;
  readonly cause: unknown;

  constructor(message: string, attempts: number, cause: unknown) {
    super(message);
    this.attempts = attempts;
    this.cause = cause;
  }
}

export interface RetryPolicy {
  /** Total attempts including the first, never a count of extra tries. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const IMAGE_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 25,
  maxDelayMs: 400,
};

export interface RetryAttemptFailure {
  readonly attempt: number;
  readonly error: unknown;
  readonly delayMs: number;
}

export interface RetryReport<T> {
  readonly value: T;
  readonly attempts: number;
  readonly failures: readonly RetryAttemptFailure[];
}

export interface RetryOptions {
  readonly policy?: RetryPolicy;
  readonly isRetryable?: (error: unknown) => boolean;
  /** Injected so retry timing stays deterministic in tests; defaults to a real timer. */
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly onRetry?: (failure: RetryAttemptFailure) => void;
}

export function validateRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new RetryPolicyError("retry policy requires at least one attempt");
  }
  if (!Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs < 0) {
    throw new RetryPolicyError("retry policy requires a non-negative base delay");
  }
  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs) {
    throw new RetryPolicyError("retry policy max delay must not be below the base delay");
  }
}

export function retryDelayMs(policy: RetryPolicy, attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RetryPolicyError("retry attempt must be a positive integer");
  }
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
}

/**
 * Transient renderer faults are retryable; a wrong backend or an impossible tile
 * plan is a caller defect and must fail loud on the first attempt.
 */
export function isRetryableImageError(error: unknown): boolean {
  if (error instanceof UnsupportedImageBackendError) return false;
  if (error instanceof ImageTilePlanLimitError) return false;
  return (
    error instanceof ImageRenderContextLostError ||
    error instanceof ImageTextureMemoryBudgetError
  );
}

export async function runWithRetry<T>(
  operation: (attempt: number) => T | Promise<T>,
  options: RetryOptions = {},
): Promise<RetryReport<T>> {
  const policy = options.policy ?? IMAGE_RETRY_POLICY;
  validateRetryPolicy(policy);
  const isRetryable = options.isRetryable ?? isRetryableImageError;
  const sleep = options.sleep ?? defaultSleep;
  const failures: RetryAttemptFailure[] = [];

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return { value: await operation(attempt), attempts: attempt, failures };
    } catch (error) {
      if (!isRetryable(error)) throw error;
      if (attempt === policy.maxAttempts) {
        throw new RetryExhaustedError(
          `image operation failed after ${attempt} attempts`,
          attempt,
          error,
        );
      }
      const failure = { attempt, error, delayMs: retryDelayMs(policy, attempt) };
      failures.push(failure);
      options.onRetry?.(failure);
      await sleep(failure.delayMs);
    }
  }
  throw new RetryPolicyError("retry loop exited without a result");
}

/** Low-memory mode divides the render-buffer budget rather than inventing a new limit table. */
const LOW_MEMORY_TEXTURE_DIVISOR = 4;

export interface ImageMemoryBudget {
  readonly profile: MemoryProfile;
  readonly lowMemory: boolean;
  readonly maxTextureBytes: number;
  readonly maxResidentBytes: number;
  readonly maxInputBytes: number;
}

export function resolveImageMemoryBudget(
  profile: MemoryProfile,
  lowMemory = false,
): ImageMemoryBudget {
  const limits = MEMORY_PROFILE_LIMITS[profile];
  return {
    profile,
    lowMemory,
    maxTextureBytes: lowMemory
      ? Math.floor(limits.maxRenderBufferBytes / LOW_MEMORY_TEXTURE_DIVISOR)
      : limits.maxRenderBufferBytes,
    maxResidentBytes: lowMemory
      ? Math.floor(limits.maxResidentBytes / LOW_MEMORY_TEXTURE_DIVISOR)
      : limits.maxResidentBytes,
    maxInputBytes: limits.maxInputBytes,
  };
}

export interface ProgressiveOpenStage {
  readonly index: number;
  readonly kind: "proxy" | "refine" | "full";
  readonly plan: ImageTilePlan;
  readonly interactive: boolean;
}

export interface ProgressiveOpenPlan {
  readonly budget: ImageMemoryBudget;
  readonly stages: readonly ProgressiveOpenStage[];
  /** True when the final stage renders at full source resolution. */
  readonly complete: boolean;
}

export interface ProgressiveOpenOptions {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly profile: MemoryProfile;
  readonly lowMemory?: boolean;
  readonly tileSize?: number;
  /** Longest edge of the first interactive paint. */
  readonly firstPaintMaxDimension?: number;
}

const DEFAULT_FIRST_PAINT_MAX_DIMENSION = 512;

/**
 * Stages an open so the first paint is a small proxy the user can interact with,
 * then refines toward full resolution while every stage stays inside the budget.
 */
export function createProgressiveOpenPlan(
  options: ProgressiveOpenOptions,
): ProgressiveOpenPlan {
  const budget = resolveImageMemoryBudget(options.profile, options.lowMemory ?? false);
  const longestEdge = Math.max(options.sourceWidth, options.sourceHeight);
  const firstPaint = Math.min(
    options.firstPaintMaxDimension ?? DEFAULT_FIRST_PAINT_MAX_DIMENSION,
    longestEdge,
  );
  const dimensions: number[] = [];
  for (let edge = firstPaint; edge < longestEdge; edge *= 2) dimensions.push(edge);
  dimensions.push(longestEdge);

  const stages: ProgressiveOpenStage[] = [];
  for (const proxyMaxDimension of dimensions) {
    const plan = tryTilePlan({
      sourceWidth: options.sourceWidth,
      sourceHeight: options.sourceHeight,
      proxyMaxDimension,
      maxTextureBytes: budget.maxTextureBytes,
      ...(options.tileSize === undefined ? {} : { tileSize: options.tileSize }),
    });
    // A stage that cannot fit the budget ends refinement; earlier stages stay valid.
    if (!plan) break;
    stages.push({
      index: stages.length,
      kind: stages.length === 0 ? "proxy" : plan.scale >= 1 ? "full" : "refine",
      plan,
      interactive: stages.length === 0,
    });
  }

  if (stages.length === 0) {
    throw new ImageTextureMemoryBudgetError(
      `no progressive open stage fits the ${budget.profile} texture budget of ${budget.maxTextureBytes} bytes`,
    );
  }
  return {
    budget,
    stages,
    complete: (stages[stages.length - 1]?.plan.scale ?? 0) >= 1,
  };
}

export interface ResilienceCycleReport {
  readonly cycles: number;
  /** A lost context that rendered anyway, or a restore that recreated nothing. */
  readonly silentFailures: number;
  readonly resourceGenerationStart: number;
  readonly resourceGenerationEnd: number;
  readonly contract: RendererResilienceContract;
}

/**
 * Drives real loss/restart cycles and derives the resilience contract from what
 * was observed. Nothing here reports SUPPORTED without exercising the path.
 */
export function observeContextLossCycles(
  adapter: ImageRenderAdapter,
  renderOnce: () => void,
  cycles: number,
): ResilienceCycleReport {
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new RangeError("context loss cycle count must be a positive integer");
  }
  const resourceGenerationStart = adapter.resourceGeneration;
  let silentFailures = 0;

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    adapter.loseContext();
    const generationWhileLost = adapter.resourceGeneration;
    try {
      renderOnce();
      silentFailures += 1;
    } catch (error) {
      if (!(error instanceof ImageRenderContextLostError)) throw error;
    }
    adapter.restore();
    if (adapter.resourceGeneration !== generationWhileLost + 1) silentFailures += 1;
    renderOnce();
  }

  const resourceGenerationEnd = adapter.resourceGeneration;
  const healthy = silentFailures === 0;
  return {
    cycles,
    silentFailures,
    resourceGenerationStart,
    resourceGenerationEnd,
    contract: createRendererResilienceContract({
      contextRestoration: healthy ? "SUPPORTED" : "UNSUPPORTED",
      resourceRecreation: healthy ? "SUPPORTED" : "UNSUPPORTED",
    }),
  };
}

function tryTilePlan(options: {
  sourceWidth: number;
  sourceHeight: number;
  proxyMaxDimension: number;
  maxTextureBytes: number;
  tileSize?: number;
}): ImageTilePlan | undefined {
  try {
    return createImageTilePlan(options);
  } catch (error) {
    if (error instanceof ImageTextureMemoryBudgetError) return undefined;
    throw error;
  }
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

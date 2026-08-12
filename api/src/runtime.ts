export type FireflyRuntimeEnv = {
  FIREFLY_API_ORIGIN?: string
  FIREFLY_AUTH_ORIGIN?: string
}

export type FireflyRuntimeReceipt = {
  runtimeId: string
  traceId: string
  billingAuthority: 'firefly'
  billingReference: string
}

export class FireflyRuntimeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'FireflyRuntimeError'
  }
}

type RuntimeStatus = {
  runtimeId: string | null
  state: string
  health: string
}

type RuntimeClaim = {
  ok: true
  runtimeId: string
}

type ChatResponse = {
  ok: true
  traceId: string
  response: string
}

type RuntimeTokenExchange = {
  token: string
}

export type FireflyRuntimeDependencies = {
  env: FireflyRuntimeEnv
  sessionToken: string
  fetch?: typeof fetch
}

function runtimeOrigin(env: FireflyRuntimeEnv): string {
  const value = env.FIREFLY_API_ORIGIN?.trim()
  if (!value) {
    throw new FireflyRuntimeError(
      500,
      'runtime-origin-missing',
      'Firefly runtime origin is not configured.'
    )
  }
  return value.replace(/\/+$/, '')
}

function authOrigin(env: FireflyRuntimeEnv): string {
  const value = env.FIREFLY_AUTH_ORIGIN?.trim()
  if (!value) {
    throw new FireflyRuntimeError(
      500,
      'auth-origin-missing',
      'Firefly auth origin is not configured.'
    )
  }
  return value.replace(/\/+$/, '')
}

async function fireflyRequest<T>(
  dependencies: FireflyRuntimeDependencies,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${dependencies.sessionToken}`)
  headers.set('Accept', 'application/json')
  if (init.body != null) headers.set('Content-Type', 'application/json')

  const response = await (dependencies.fetch ?? fetch)(
    `${runtimeOrigin(dependencies.env)}${path}`,
    {
      ...init,
      headers
    }
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      code?: string
      error?: string
      message?: string
    } | null
    throw new FireflyRuntimeError(
      response.status,
      body?.code ?? body?.error ?? 'firefly-runtime-failed',
      body?.message ?? `Firefly runtime request failed: ${response.status}`
    )
  }
  return (await response.json()) as T
}

async function exchangeRuntimeToken(
  dependencies: FireflyRuntimeDependencies
): Promise<FireflyRuntimeDependencies> {
  const response = await (dependencies.fetch ?? fetch)(
    `${authOrigin(dependencies.env)}/api/firefly-auth/exchange`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dependencies.sessionToken}`,
        Accept: 'application/json'
      }
    }
  )
  if (!response.ok) {
    throw new FireflyRuntimeError(
      response.status,
      'runtime-token-exchange-failed',
      `Firefly runtime token exchange failed: ${response.status}`
    )
  }
  const exchanged = (await response.json()) as RuntimeTokenExchange
  if (!exchanged.token) {
    throw new FireflyRuntimeError(
      502,
      'runtime-token-missing',
      'Firefly runtime token exchange returned no token.'
    )
  }
  return { ...dependencies, sessionToken: exchanged.token }
}

async function ensureRuntime(dependencies: FireflyRuntimeDependencies): Promise<string> {
  let status = await fireflyRequest<RuntimeStatus>(dependencies, '/runtime/status')
  if (!status.runtimeId) {
    const claim = await fireflyRequest<RuntimeClaim>(dependencies, '/runtime/claim', {
      method: 'POST'
    })
    if (!claim.runtimeId) {
      throw new FireflyRuntimeError(
        503,
        'runtime-identity-missing',
        'Firefly runtime claim returned no runtime identity.'
      )
    }
    status = await fireflyRequest<RuntimeStatus>(dependencies, '/runtime/status')
  }

  if (!status.runtimeId || status.health !== 'healthy') {
    throw new FireflyRuntimeError(
      503,
      'runtime-unhealthy',
      `Firefly runtime is not healthy (${status.state}/${status.health}).`
    )
  }
  return status.runtimeId
}

export async function sendFireflyRuntimeChat(
  dependencies: FireflyRuntimeDependencies,
  input: { message: string; chatSessionId?: string }
): Promise<{ text: string; receipt: FireflyRuntimeReceipt }> {
  const runtimeDependencies = await exchangeRuntimeToken(dependencies)
  const runtimeId = await ensureRuntime(runtimeDependencies)
  const response = await fireflyRequest<ChatResponse>(runtimeDependencies, '/chat/send', {
    method: 'POST',
    body: JSON.stringify({
      runtimeId,
      message: input.message,
      ...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {})
    })
  })
  if (!response.traceId) {
    throw new FireflyRuntimeError(
      502,
      'billing-reference-missing',
      'Firefly chat response returned no billing trace.'
    )
  }

  return {
    text: response.response,
    receipt: {
      runtimeId,
      traceId: response.traceId,
      billingAuthority: 'firefly',
      billingReference: response.traceId
    }
  }
}

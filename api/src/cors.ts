const STATIC_ALLOWED_ORIGINS = new Set([
  'https://design.elf.dance',
  'https://staging.design.elf.dance',
  'https://pencil.ch5.me',
  'https://app.openpencil.dev',
  'http://localhost:1420',
  'http://127.0.0.1:1420',
  'http://localhost:1421',
  'http://127.0.0.1:1421',
  'http://localhost:1422',
  'http://127.0.0.1:1422'
])

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*'
const LOCAL_APP_HOST = new RegExp(`^app\\.(${SLUG})\\.localhost$`)
const LOCAL_API_HOST = new RegExp(`^api\\.(${SLUG})\\.localhost$`)
const DEV_APP_HOST = new RegExp(`^app\\.(${SLUG})\\.(${SLUG})\\.dev\\.ch5\\.me$`)
const DEV_API_HOST = new RegExp(`^api\\.(${SLUG})\\.(${SLUG})\\.dev\\.ch5\\.me$`)

function parseCanonicalOrigin(origin: string): URL | undefined {
  try {
    const url = new URL(origin)
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return undefined
    }
    return url
  } catch {
    return undefined
  }
}

function parseCanonicalHost(host: string): URL | undefined {
  try {
    const url = new URL(`http://${host}`)
    if (
      url.host !== host ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return undefined
    }
    return url
  } catch {
    return undefined
  }
}

export function resolveAllowedOrigin(
  origin: string,
  requestHost: string | undefined
): string | undefined {
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return origin
  if (!requestHost) return undefined

  const originURL = parseCanonicalOrigin(origin)
  const requestURL = parseCanonicalHost(requestHost)
  if (
    !originURL ||
    !requestURL ||
    originURL.protocol !== 'http:' ||
    originURL.port !== '7300' ||
    requestURL.port !== '7300'
  ) {
    return undefined
  }

  const localApp = originURL.hostname.match(LOCAL_APP_HOST)
  const localAPI = requestURL.hostname.match(LOCAL_API_HOST)
  if (localApp && localAPI && localApp[1] === localAPI[1]) return origin

  const devApp = originURL.hostname.match(DEV_APP_HOST)
  const devAPI = requestURL.hostname.match(DEV_API_HOST)
  if (devApp && devAPI && devApp[1] === devAPI[1] && devApp[2] === devAPI[2]) {
    return origin
  }

  return undefined
}

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

const LOCAL_APP_HOST = /^app\.[a-z0-9]+(?:-[a-z0-9]+)*\.localhost$/
const DEV_APP_HOST = /^app\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*\.dev\.ch5\.me$/

export function resolveAllowedOrigin(origin: string): string | undefined {
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return origin

  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' || url.port !== '7300') return undefined
    if (!LOCAL_APP_HOST.test(url.hostname) && !DEV_APP_HOST.test(url.hostname)) return undefined
    return origin
  } catch {
    return undefined
  }
}

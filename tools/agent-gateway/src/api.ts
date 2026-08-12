import { app } from '#api/index'

const port = Number(process.env.PORT ?? 8787)
const namespace = process.env.PITCHFORK_DAEMON_NAMESPACE
const gatewayOrigin =
  process.env.OPENPENCIL_AGENT_GATEWAY_ORIGIN ??
  (namespace ? `http://agent-gateway.${namespace}.localhost:7300` : 'http://127.0.0.1:1435')

Bun.serve({
  port,
  hostname: '127.0.0.1',
  fetch: (request) =>
    app.fetch(request, {
      ALLOW_DEV_STUB_AUTH: '1',
      OPENPENCIL_AGENT_GATEWAY_ORIGIN: gatewayOrigin,
      OPENPENCIL_AGENT_GATEWAY_TOKEN: process.env.OPENPENCIL_AGENT_GATEWAY_TOKEN
    } as never)
})
console.log(`Local OpenPencil API listening on http://127.0.0.1:${port}`)

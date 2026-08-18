import { createLiteLlmExecutor } from './executor'
import { createAgentGateway } from './gateway'
import { createAgentCatalogSource } from './options'

const port = Number(process.env.PORT ?? 1435)
const gateway = createAgentGateway(
  createAgentCatalogSource(process.env),
  createLiteLlmExecutor(process.env)
)

Bun.serve({ port, hostname: '127.0.0.1', fetch: gateway.fetch })
console.log(`Local agent gateway listening on http://127.0.0.1:${port}`)

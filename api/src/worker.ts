import { WorkerEntrypoint } from 'cloudflare:workers'

import { assertAuthConfigured } from './auth'
import { app, type Env } from './index'

export { DocumentRoomDO } from './documents/room'

export default class OpenPencilApi extends WorkerEntrypoint<Env> {
  constructor(ctx: ExecutionContext, env: Env) {
    assertAuthConfigured(env)
    super(ctx, env)
  }

  fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request, this.env, this.ctx)
  }
}

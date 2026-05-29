/**
 * DocumentRoomDO — Durable Object stub for real-time document collaboration rooms.
 *
 * Will host Yjs CRDT state sync, awareness/cursor broadcasting, and snapshot coordination
 * between authenticated peers. Currently a registration stub aligned to .ch5/services.yaml.
 */

export class DocumentRoomDO implements DurableObject {
  private state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(_request: Request): Promise<Response> {
    // TODO: wire Yjs sync, awareness protocol, and snapshot coordination
    return new Response(JSON.stringify({ status: 'room-active', class: 'DocumentRoomDO' }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

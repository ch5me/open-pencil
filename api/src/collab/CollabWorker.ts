export class CollabClient {
  private ws: WebSocket | null = null
  private roomName: string
  private env: { DOCUMENT_ROOM: DurableObjectNamespace }
  private messageHandlers: Array<(data: ArrayBuffer | string) => void> = []
  private closeHandlers: Array<() => void> = []

  constructor(roomName: string, env: { DOCUMENT_ROOM: DurableObjectNamespace }) {
    this.roomName = roomName
    this.env = env
  }

  async connect(): Promise<void> {
    const id = this.env.DOCUMENT_ROOM.idFromName(this.roomName)
    const stub = this.env.DOCUMENT_ROOM.get(id)
    const url = `wss://${id}/${this.roomName}`
    this.ws = new WebSocket(url)
    this.ws.onmessage = (event) => {
      for (const handler of this.messageHandlers) {
        handler(event.data)
      }
    }
    this.ws.onclose = () => {
      for (const handler of this.closeHandlers) {
        handler()
      }
    }
  }

  send(data: ArrayBuffer | string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    }
  }

  close(): void {
    this.ws?.close()
  }

  onMessage(handler: (data: ArrayBuffer | string) => void): void {
    this.messageHandlers.push(handler)
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler)
  }
}
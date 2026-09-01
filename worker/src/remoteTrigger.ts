import { DurableObject } from 'cloudflare:workers';

export type RemoteTriggerAction = 'capture' | 'done';

/**
 * Single-instance relay: the phone holds one open (hibernatable) WebSocket
 * here while the camera screen is mounted; a POST from the Mac broadcasts
 * an action to it instantly. No persisted state — losing an in-flight
 * trigger on a rare DO restart just means one missed click.
 */
export class RemoteTriggerRoom extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer) {
    // The phone doesn't send anything; nothing to handle.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }

  broadcast(action: RemoteTriggerAction): void {
    const payload = JSON.stringify({ action });
    for (const ws of this.ctx.getWebSockets()) {
      ws.send(payload);
    }
  }
}

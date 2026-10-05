import type { Env } from './db';

/**
 * Central de tempo real do suporte (Durable Object com SQLite, grátis no plano gratuito).
 * Só repassa avisos ("há novidade na conversa X"): as mensagens ficam no D1 e o navegador
 * as busca de novo ao receber o aviso. Usa WebSockets com hibernação: sem ninguém falando,
 * o objeto dorme e não gasta cota. Cada conexão leva as etiquetas "admin" ou "u:<id da pessoa>".
 */
export class SupportHub {
  constructor(private state: DurableObjectState, _env: Env) {
    // ping/pong responde sem acordar o objeto.
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === '/notify' && req.method === 'POST') {
      const { thread, userId, toAdmin } = (await req.json()) as { thread: string; userId?: string; toAdmin?: boolean };
      const msg = JSON.stringify({ type: 'support', thread });
      const targets = new Set<WebSocket>();
      if (toAdmin) this.state.getWebSockets('admin').forEach((w) => targets.add(w));
      if (userId) this.state.getWebSockets(`u:${userId}`).forEach((w) => targets.add(w));
      for (const w of targets) {
        try {
          w.send(msg);
        } catch {
          /* conexão já caiu */
        }
      }
      return new Response(null, { status: 204 });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Esperado WebSocket', { status: 426 });
    // Quem chama é o Worker (já autenticou a pessoa e escreveu estes cabeçalhos).
    const userId = req.headers.get('x-scola-user');
    if (!userId) return new Response('Sem identificação', { status: 401 });
    const pair = new WebSocketPair();
    const tags = [`u:${userId}`, ...(req.headers.get('x-scola-admin') === '1' ? ['admin'] : [])];
    this.state.acceptWebSocket(pair[1], tags);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer) {
    /* o cliente não envia nada além do ping automático */
  }
}

/** Avisa quem precisa ver a novidade. Nunca derruba a gravação: tempo real é só um extra. */
export async function notifySupport(env: Env, ev: { thread: string; userId?: string; toAdmin?: boolean }) {
  try {
    const stub = env.SUPPORT_HUB.get(env.SUPPORT_HUB.idFromName('hub'));
    await stub.fetch('https://hub/notify', { method: 'POST', body: JSON.stringify(ev) });
  } catch (e) {
    console.error('hub: aviso não enviado', (e as Error)?.message);
  }
}

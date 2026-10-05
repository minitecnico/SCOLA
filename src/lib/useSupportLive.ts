import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

const KEYS = ['support-threads', 'support-thread', 'support-unread', 'support-admin', 'support-admin-thread', 'support-admin-unread'];

/**
 * Suporte em tempo real: mantém um WebSocket aberto com o servidor (Durable Object). Ao receber
 * "há novidade", o navegador atualiza as conversas na hora. Se a conexão cair, reconecta sozinho;
 * as telas continuam atualizando por consulta periódica como reserva.
 */
export function useSupportLive(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof WebSocket === 'undefined') return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let tries = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/support/ws`);
      ws.onopen = () => {
        tries = 0;
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 30_000);
      };
      ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        for (const key of KEYS) void qc.invalidateQueries({ queryKey: [key] });
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (stopped) return;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++));
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    // Voltou para a aba (celular dormiu etc.): atualiza tudo.
    const onVisible = () => document.visibilityState === 'visible' && KEYS.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(ping);
      document.removeEventListener('visibilitychange', onVisible);
      ws?.close();
    };
  }, [enabled, qc]);
}

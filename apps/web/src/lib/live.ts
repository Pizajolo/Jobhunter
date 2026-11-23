import { useEffect } from 'react';
import { WsMessageSchema } from '@jobhunter/shared';
import { queryClient } from './api';

/** Subscribe to engine invalidations so every screen stays a live view of the database. */
export function useLiveUpdates(): void {
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
      ws.onopen = () => {
        retry = 0;
      };
      ws.onmessage = (ev) => {
        let json: unknown;
        try {
          json = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        const parsed = WsMessageSchema.safeParse(json);
        if (!parsed.success) return;
        for (const key of parsed.data.keys) void queryClient.invalidateQueries({ queryKey: [key] });
      };
      ws.onclose = () => {
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, 500 * 2 ** retry);
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);
}

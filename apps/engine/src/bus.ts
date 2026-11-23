import { EventEmitter } from 'node:events';
import type { WsMessage } from '@jobhunter/shared';

/** In-process event bus. The WebSocket hub forwards `invalidate` messages to every connected UI. */
export class Bus {
  private readonly ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(100);
  }
  /** Tell UIs that data behind these query keys changed. */
  invalidate(...keys: string[]): void {
    this.ee.emit('ws', { type: 'invalidate', keys } satisfies WsMessage);
  }
  onWs(fn: (m: WsMessage) => void): () => void {
    this.ee.on('ws', fn);
    return () => this.ee.off('ws', fn);
  }
  emit<T>(event: string, payload: T): void {
    this.ee.emit(event, payload);
  }
  on<T>(event: string, fn: (payload: T) => void): () => void {
    this.ee.on(event, fn as (p: unknown) => void);
    return () => this.ee.off(event, fn as (p: unknown) => void);
  }
}

import type { AppContext } from './context.js';

type Service = { name: string; start(ctx: AppContext): Promise<void> | void; stop?(ctx: AppContext): Promise<void> | void };
const services: Service[] = [];

export function registerService(s: Service): void {
  if (!services.some((x) => x.name === s.name)) services.push(s);
}

export async function startServices(ctx: AppContext): Promise<void> {
  for (const s of services) {
    try {
      await s.start(ctx);
    } catch (err) {
      ctx.log.error({ err, service: s.name }, 'service failed to start');
    }
  }
}

export async function stopServices(ctx: AppContext): Promise<void> {
  for (const s of [...services].reverse()) await s.stop?.(ctx);
}

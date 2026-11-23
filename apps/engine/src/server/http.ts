import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Parse a request part with Zod; throws a 400 with the issues on failure. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, 'Invalid request', r.error.issues);
  return r.data;
}

export function notFound(what = 'Not found'): never {
  throw new HttpError(404, what);
}

export function sendError(reply: FastifyReply, err: HttpError): FastifyReply {
  return reply.status(err.status).send({ error: err.message, details: err.details });
}

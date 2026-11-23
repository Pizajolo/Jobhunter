import { z } from 'zod';

/**
 * Keywords the structured-output JSON Schema subset does not accept. Zod still enforces them
 * after the model answers, so dropping them here loses no safety.
 */
const UNSUPPORTED = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'propertyNames',
  '$schema',
  'default',
  'examples',
]);
const ALLOWED_FORMATS = new Set(['date-time', 'date', 'time', 'email', 'uri', 'uuid', 'duration', 'hostname', 'ipv4', 'ipv6']);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED.has(k)) continue;
    if (k === 'format' && typeof v === 'string' && !ALLOWED_FORMATS.has(v)) continue;
    if (k === 'minItems' && typeof v === 'number' && v > 1) {
      out[k] = 1;
      continue;
    }
    out[k] = clean(v);
  }
  if (out.type === 'object' || out.properties) {
    out.additionalProperties = false;
    if (out.properties && !out.required) out.required = [];
  }
  return out;
}

/** Zod schema → JSON Schema accepted by structured outputs (Messages API and Agent SDK). */
export function toModelJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' });
  return clean(json) as Record<string, unknown>;
}

/** Pull a JSON value out of free text (fallback for endpoints without structured outputs). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.search(/[[{]/u);
  if (start >= 0) {
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new Error('No JSON found in model output');
}

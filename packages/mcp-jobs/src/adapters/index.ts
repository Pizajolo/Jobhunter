import type { JobSource } from '../types.js';
import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';
import { ashby } from './ashby.js';
import { smartrecruiters } from './smartrecruiters.js';
import { workable } from './workable.js';
import { recruitee } from './recruitee.js';
import { personio } from './personio.js';
import { workday } from './workday.js';
import { generic } from './generic.js';
import { rss } from './rss.js';
import { arbeitnow } from './arbeitnow.js';

/** Adapter registry. To add a source, implement JobSource and add it here (see docs/ADDING_A_SOURCE.md). */
export const ADAPTERS: Record<string, JobSource> = Object.fromEntries(
  [greenhouse, lever, ashby, smartrecruiters, workable, recruitee, personio, workday, generic, rss, arbeitnow].map((a) => [a.kind, a]),
);

export { greenhouse, lever, ashby, smartrecruiters, workable, recruitee, personio, workday, generic, rss, arbeitnow };
export { parseWorkdayUrl } from './workday.js';
export { parseSalary, remoteFrom } from './util.js';

# Adding a job source

Every source (ATS, job board, feed) is a small adapter that implements one interface in `packages/mcp-jobs`. The scan pipeline handles everything else: polite fetching, normalisation, dedup, matching and the board.

## 1. Check the source's rules first

- Prefer an official public API or RSS feed over HTML.
- Read the site's terms and `robots.txt`. Jobhunter's fetcher enforces `robots.txt`, a per-domain rate limit (default one request every 5 s) and a daily page cap, but it cannot know about terms that forbid automated access. If they do, don't add the source.
- **Never add LinkedIn scraping or automation.** LinkedIn jobs enter only through job-alert emails (spec rule §2.3).

## 2. Implement `JobSource`

```ts
// packages/mcp-jobs/src/adapters/myboard.ts
import type { JobSource } from '../types.js';
import { htmlToText } from '../html.js';
import { isoDate, remoteFrom } from './util.js';

interface MyBoardJob { id: string; title: string; company: string; city: string; html: string; link: string; published: string }

export const myboard: JobSource = {
  kind: 'myboard',
  async list(config, ctx) {
    const data = await ctx.fetch.json<{ jobs: MyBoardJob[] }>(`https://api.myboard.example/jobs?q=${encodeURIComponent(String(config.options?.query ?? ''))}`);
    return data.jobs.map((j) => ({
      sourceJobId: j.id,               // stable id from the source (used for dedup)
      title: j.title,
      company: j.company,
      location: j.city,
      remote: remoteFrom(j.city, j.html),
      description: htmlToText(j.html),  // plain text
      url: j.link,                      // public posting URL
      applyUrl: j.link,
      postedAt: isoDate(j.published),
    }));
  },
};
```

Rules:

- **Always fetch through `ctx.fetch`** (`json()` or `text()`), never `fetch()` directly. That is what keeps the scan polite and cached.
- Return what the source says; don't invent fields. Missing values may be omitted (`location`, `salary`, `language`…).
- Keep detail-page fetching bounded (see `smartrecruiters.ts`, which fetches at most 40 detail pages per scan).
- If the source only offers HTML, use `ctx.extractor` like `generic.ts` instead of writing CSS selectors that break silently.

Register it in `packages/mcp-jobs/src/adapters/index.ts`:

```ts
export const ADAPTERS = Object.fromEntries([..., myboard].map((a) => [a.kind, a]));
```

If the source can be recognised from a URL, add a rule to `detect.ts` so "Add company" picks it up automatically.

## 3. Record fixtures and test

1. Put a recorded response with **fictional data** in `fixtures/http/myboard/` (copy the real response shape, replace every company, person and job).
2. Map it in `fixtures/http/manifest.json`: `"GET https://api.myboard.example/jobs?q=": "myboard/page1.json"`.
3. Add a case to `packages/mcp-jobs/test/adapters.test.ts`:

```ts
it('myboard', async () => {
  const { jobs } = await run({ kind: 'myboard', options: { query: '' } });
  expect(jobs[0]).toMatchObject({ title: '…', company: '…' });
});
```

Tests never touch the network: any request without a fixture fails.

## 4. Make it selectable in the UI (optional)

Board-type sources (not tied to one company) are added under **Settings → Job boards and feeds**. Add the new kind to the `kind` enum in `apps/engine/src/scan/routes.ts` (`POST /api/sources`), to the select in `apps/web/src/routes/settings/scanning.tsx`, and a label under `sources.<kind>` in every locale file in `apps/web/src/i18n/locales/`.

## 5. Checklist

- [ ] Uses an API/feed where one exists, respects the site's terms
- [ ] All requests go through `ctx.fetch`
- [ ] Bounded number of requests per scan
- [ ] Fixture with fictional data + test
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass

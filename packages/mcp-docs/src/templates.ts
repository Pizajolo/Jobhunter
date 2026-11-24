import type { CoverLetter, CvTemplate, Profile, TailoredCv } from '@jobhunter/shared';
import { labels } from './conventions.js';

export interface RenderOptions {
  template: CvTemplate;
  language: string;
  paper: 'A4' | 'Letter';
  photoDataUrl?: string | null;
  personalDetails?: boolean;
  /** Prefer fitting on one page (tighter spacing). */
  onePage?: boolean;
}

export const TEMPLATE_INFO: Record<CvTemplate, { name: string; description: string }> = {
  harvard: { name: 'Harvard', description: 'Harvard Business School style: one page, serif, education first, centred header.' },
  modern: { name: 'Modern', description: 'Clean single-column sans-serif with one accent colour.' },
  european: { name: 'European', description: 'Photo and personal details block, common in Switzerland and Germany.' },
  compact: { name: 'Compact', description: 'Dense one-page layout for long careers.' },
};

const esc = (s: string | undefined | null): string =>
  (s ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

const FONTS = {
  serif: "'EB Garamond', Garamond, Georgia, 'Times New Roman', 'Liberation Serif', 'DejaVu Serif', serif",
  sans: "Inter, 'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', 'DejaVu Sans', sans-serif",
};

function contactLine(p: Profile): string[] {
  const b = p.basics;
  return [
    [b.location?.city, b.location?.countryCode].filter(Boolean).join(', '),
    b.email,
    b.phone,
    b.url,
    ...b.profiles.map((x) => x.url),
  ].filter((x): x is string => !!x && x.trim() !== '');
}

function sectionOrder(cv: TailoredCv, template: CvTemplate): TailoredCv['sections'] {
  if (template !== 'harvard') return cv.sections;
  // HBS format: Education, Experience, then everything else under "Additional Information".
  const rank: Record<string, number> = { education: 0, experience: 1 };
  return [...cv.sections].sort((a, b) => (rank[a.kind] ?? 2) - (rank[b.kind] ?? 2));
}

function baseCss(o: RenderOptions, font: string, accent: string): string {
  const size = o.onePage || o.template === 'compact' ? 9.6 : 10.4;
  return `
  @page { size: ${o.paper}; margin: ${o.template === 'harvard' ? '14mm 16mm' : '14mm 15mm'}; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: ${font}; font-size: ${size}pt; line-height: 1.38; color: #16171b; }
  h1 { margin: 0; font-weight: 700; }
  h2 { font-size: ${size + 1.4}pt; margin: 12pt 0 5pt; color: ${accent}; break-after: avoid; }
  .item { margin: 0 0 7pt; break-inside: avoid; }
  .row { display: flex; justify-content: space-between; gap: 12pt; }
  .row .right { white-space: nowrap; text-align: right; }
  ul { margin: 2pt 0 0; padding-left: 13pt; }
  li { margin: 0 0 1.5pt; }
  .muted { color: #4b4f58; }
  .contact { margin-top: 3pt; }
  .summary { margin: 6pt 0 0; }
  a { color: inherit; text-decoration: none; }
  `;
}

function renderItems(section: TailoredCv['sections'][number], o: RenderOptions): string {
  const harvard = o.template === 'harvard';
  return section.items
    .map((it) => {
      const bullets = it.bullets.length ? `<ul>${it.bullets.map((b) => `<li>${esc(b.text)}</li>`).join('')}</ul>` : '';
      if (section.kind === 'skills' || section.kind === 'languages' || section.kind === 'additional' || section.kind === 'certificates') {
        const body = it.bullets.map((b) => esc(b.text)).join(harvard ? '; ' : ' · ');
        return `<div class="item"><strong>${esc(it.heading)}${body ? ':' : ''}</strong> ${body}</div>`;
      }
      if (harvard) {
        return `<div class="item">
          <div class="row"><strong>${esc(it.heading)}</strong><span class="right">${esc(it.location)}</span></div>
          ${it.subheading || it.dates ? `<div class="row"><em>${esc(it.subheading)}</em><span class="right">${esc(it.dates)}</span></div>` : ''}
          ${bullets}</div>`;
      }
      return `<div class="item">
        <div class="row"><span><strong>${esc(it.subheading || it.heading)}</strong>${it.subheading ? ` · ${esc(it.heading)}` : ''}</span><span class="right muted">${esc(it.dates)}</span></div>
        ${it.location ? `<div class="muted">${esc(it.location)}</div>` : ''}
        ${bullets}</div>`;
    })
    .join('');
}

/** CV as a self-contained HTML document (rendered to PDF with Chromium). Text only, no images of text. */
export function renderCvHtml(cv: TailoredCv, profile: Profile, o: RenderOptions): string {
  const L = labels(o.language);
  const b = profile.basics;
  const contact = contactLine(profile);
  const sections = sectionOrder(cv, o.template);
  const font = o.template === 'harvard' ? FONTS.serif : FONTS.sans;
  const accent = o.template === 'modern' ? '#1f3fb0' : o.template === 'european' ? '#22406b' : '#16171b';
  const personal =
    o.personalDetails && (b.dateOfBirth || b.nationality || profile.preferences.workAuthorization)
      ? `<div class="personal">${[
          b.dateOfBirth ? `${L.dateOfBirth}: ${esc(b.dateOfBirth)}` : '',
          b.nationality ? `${L.nationality}: ${esc(b.nationality)}` : '',
          profile.preferences.workAuthorization ? `${L.workAuthorization}: ${esc(profile.preferences.workAuthorization)}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}</div>`
      : '';
  const photo = o.photoDataUrl ? `<img class="photo" src="${o.photoDataUrl}" alt="${esc(b.name)}" />` : '';

  let css = baseCss(o, font, accent);
  let header: string;
  switch (o.template) {
    case 'harvard':
      css += `
        header { text-align: center; }
        h1 { font-size: 17pt; letter-spacing: 0.06em; text-transform: uppercase; }
        h2 { color: #16171b; text-transform: uppercase; letter-spacing: 0.08em; font-size: 10.5pt; border-bottom: 0.8pt solid #16171b; padding-bottom: 1.5pt; }
        .contact { font-size: 9.5pt; }`;
      header = `<header><h1>${esc(b.name)}</h1><div class="contact">${contact.map(esc).join(' • ')}</div>${personal}</header>`;
      break;
    case 'european':
      css += `
        header { display: flex; gap: 14pt; align-items: flex-start; border-bottom: 1.2pt solid ${accent}; padding-bottom: 8pt; }
        header .who { flex: 1; }
        h1 { font-size: 20pt; color: ${accent}; }
        .label { font-size: 11pt; color: #4b4f58; margin-top: 2pt; }
        .photo { width: 30mm; height: 38mm; object-fit: cover; border-radius: 2pt; }
        .personal { margin-top: 4pt; font-size: 9pt; color: #4b4f58; }
        h2 { border-bottom: 0.6pt solid #c9ced8; padding-bottom: 2pt; }`;
      header = `<header><div class="who"><h1>${esc(b.name)}</h1>${b.label ? `<div class="label">${esc(b.label)}</div>` : ''}<div class="contact muted">${contact.map(esc).join(' · ')}</div>${personal}</div>${photo}</header>`;
      break;
    case 'compact':
      css += `
        h1 { font-size: 15pt; }
        h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 8pt; }
        .item { margin-bottom: 4pt; }
        .photo { display: none; }`;
      header = `<header><h1>${esc(b.name)}${b.label ? ` <span class="muted" style="font-weight:400;font-size:11pt">· ${esc(b.label)}</span>` : ''}</h1><div class="contact muted">${contact.map(esc).join(' · ')}</div>${personal}</header>`;
      break;
    default:
      css += `
        header { display: flex; gap: 12pt; justify-content: space-between; align-items: flex-start; }
        h1 { font-size: 21pt; letter-spacing: -0.01em; }
        .label { font-size: 11.5pt; color: ${accent}; font-weight: 600; margin-top: 2pt; }
        .photo { width: 26mm; height: 32mm; object-fit: cover; border-radius: 3pt; }
        h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.07em; }
        .personal { margin-top: 3pt; font-size: 9pt; color: #4b4f58; }`;
      header = `<header><div><h1>${esc(b.name)}</h1>${b.label ? `<div class="label">${esc(b.label)}</div>` : ''}<div class="contact muted">${contact.map(esc).join(' · ')}</div>${personal}</div>${photo}</header>`;
  }

  const summary = cv.summary ? `<section><h2>${esc(L.summary)}</h2><p class="summary">${esc(cv.summary)}</p></section>` : '';
  const body = sections.map((s) => `<section><h2>${esc(s.title)}</h2>${renderItems(s, o)}</section>`).join('');
  return `<!doctype html><html lang="${esc(o.language)}"><head><meta charset="utf-8"><title>${esc(b.name)} — CV</title><style>${css}</style></head><body>${header}${o.template === 'harvard' ? '' : summary}${body}</body></html>`;
}

/** Cover letter HTML in the same visual family as the chosen CV template. */
export function renderLetterHtml(
  letter: CoverLetter,
  profile: Profile,
  job: { company: string; title: string; location?: string | null },
  o: RenderOptions & { date: Date },
): string {
  const L = labels(o.language);
  const b = profile.basics;
  const font = o.template === 'harvard' ? FONTS.serif : FONTS.sans;
  const css = `${baseCss(o, font, '#16171b')}
    body { font-size: 10.8pt; line-height: 1.5; }
    .sender { margin-bottom: 14pt; }
    .sender strong { font-size: 12pt; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 14pt; }
    .subject { font-weight: 700; margin: 0 0 12pt; }
    p { margin: 0 0 9pt; }
    .closing { margin-top: 14pt; }`;
  const date = new Intl.DateTimeFormat(o.language, { day: 'numeric', month: 'long', year: 'numeric' }).format(o.date);
  return `<!doctype html><html lang="${esc(o.language)}"><head><meta charset="utf-8"><title>${esc(b.name)} — ${esc(job.company)}</title><style>${css}</style></head><body>
    <div class="sender"><strong>${esc(b.name)}</strong><br>${contactLine(profile).map(esc).join(' · ')}</div>
    <div class="meta"><div>${esc(job.company)}${job.location ? `<br>${esc(job.location)}` : ''}</div><div>${esc(date)}</div></div>
    <p class="subject">${esc(L.subject!.replace('{{title}}', job.title))}</p>
    <p>${esc(letter.greeting)}</p>
    ${letter.paragraphs.map((p) => `<p>${esc(p.text)}</p>`).join('')}
    <p class="closing">${esc(letter.closing)}<br><br>${esc(b.name)}</p>
  </body></html>`;
}

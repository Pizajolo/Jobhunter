import { afterAll, describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import { CV_TEMPLATES, EMPTY_PROFILE, type Profile, type TailoredCv } from '@jobhunter/shared';
import { checkCitations, closeRenderer, htmlToPdf, renderCvHtml, renderLetterHtml, unsupportedNumbers } from '../src/index.js';

afterAll(() => closeRenderer());

const profile: Profile = {
  ...EMPTY_PROFILE,
  basics: { ...EMPTY_PROFILE.basics, name: 'Alex Example', label: 'Product Manager', email: 'alex@example.com', location: { city: 'Zurich', countryCode: 'CH' }, nationality: 'Swiss' },
  preferences: { workAuthorization: 'Swiss citizen' },
};

const cv: TailoredCv = {
  summary: 'Product manager with 8 years of experience building B2B data platforms.',
  summaryFactIds: ['f1'],
  sections: [
    {
      kind: 'experience',
      title: 'Experience',
      items: [
        { heading: 'Fictional Data AG', subheading: 'Senior Product Manager', location: 'Zurich', dates: '03/2021 – Present', bullets: [{ text: 'Led a team of 6 engineers to launch a data pipeline product used by 40 enterprise customers.', factIds: ['f2'] }] },
        { heading: 'Sample Analytics GmbH', subheading: 'Product Manager', location: 'Berlin', dates: '01/2017 – 02/2021', bullets: [{ text: 'Reduced customer onboarding time from 6 weeks to 2 weeks.', factIds: ['f3'] }] },
      ],
    },
    { kind: 'education', title: 'Education', items: [{ heading: 'Example Technical University', subheading: 'MSc Computer Science', dates: '2014 – 2016', bullets: [] }] },
    { kind: 'skills', title: 'Skills', items: [{ heading: 'Product', bullets: [{ text: 'Discovery', factIds: ['f4'] }, { text: 'Roadmapping', factIds: ['f4'] }] }] },
  ],
  gaps: [],
};

async function pdfText(pdf: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const r = await extractText(doc, { mergePages: true });
  return Array.isArray(r.text) ? r.text.join('\n') : r.text;
}

describe('CV rendering', () => {
  for (const template of CV_TEMPLATES) {
    it(`${template}: selectable text, standard headings, under 1 MB`, async () => {
      const html = renderCvHtml(cv, profile, { template, language: 'en', paper: template === 'harvard' ? 'Letter' : 'A4', personalDetails: template === 'european' });
      const r = await htmlToPdf(html, template === 'harvard' ? 'Letter' : 'A4');
      expect(r.bytes).toBeLessThan(1024 * 1024);
      const text = await pdfText(r.pdf);
      for (const s of ['Alex Example', 'Experience', 'Education', 'Fictional Data AG', 'Led a team of 6 engineers']) expect(text.toLowerCase()).toContain(s.toLowerCase());
      if (template === 'european') expect(text).toContain('Nationality');
      if (template === 'harvard') {
        expect(r.pages).toBe(1);
        expect(text.toLowerCase().indexOf('education')).toBeLessThan(text.toLowerCase().indexOf('experience'));
      }
    }, 60_000);
  }

  it('escapes HTML in content', () => {
    const html = renderCvHtml({ ...cv, summary: '<script>alert(1)</script>' }, profile, { template: 'modern', language: 'en', paper: 'A4' });
    expect(html).not.toContain('<script>alert');
  });

  it('renders a cover letter in German', async () => {
    const html = renderLetterHtml(
      { greeting: 'Sehr geehrte Damen und Herren', paragraphs: [{ text: 'Ich bewerbe mich als Produktmanager.', factIds: [] }], closing: 'Freundliche Grüsse', gaps: [] },
      profile,
      { company: 'Lumen Robotics', title: 'Senior Product Manager' },
      { template: 'modern', language: 'de', paper: 'A4', date: new Date('2026-11-24') },
    );
    const text = await pdfText((await htmlToPdf(html, 'A4')).pdf);
    expect(text).toContain('Bewerbung als Senior Product Manager');
    expect(text).toContain('24. November 2026');
  }, 60_000);
});

describe('truthfulness checks', () => {
  const facts = [
    { id: 'f2', text: 'At Fictional Data AG: Led a team of 6 engineers; 40 enterprise customers', source: 'cv' as const, confirmedAt: 'x' },
    { id: 'f3', text: 'Grew ARR from CHF 1.2M to CHF 3.5M', source: 'cv' as const, confirmedAt: 'x' },
  ];
  it('accepts claims backed by cited facts', () => {
    expect(checkCitations([{ text: 'Led 6 engineers serving 40 customers', factIds: ['f2'] }, { text: 'Grew ARR to CHF 3,5M', factIds: ['f3'] }], facts)).toEqual([]);
  });
  it('rejects unknown facts, uncited claims and invented numbers', () => {
    const p = checkCitations(
      [
        { text: 'Led 12 engineers', factIds: ['f2'] },
        { text: 'Expert in Kubernetes', factIds: [] },
        { text: 'Won an award', factIds: ['f99'] },
        { text: 'Dear hiring team', factIds: [], optional: true },
      ],
      facts,
    ).join('\n');
    expect(p).toMatch(/12/u);
    expect(p).toMatch(/Kubernetes/u);
    expect(p).toMatch(/f99/u);
    expect(p).not.toMatch(/Dear/u);
  });
  it('compares numbers without separators', () => {
    expect(unsupportedNumbers('CHF 120,000', ['CHF 120000'])).toEqual([]);
  });
});

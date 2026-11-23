import { describe, expect, it } from 'vitest';
import { canonicalUrl, diffValues, domainOf, normalizeCompany, normalizeTitle, registrableDomain, similarity } from '../src/index.js';

describe('text helpers', () => {
  it('normalizes company names', () => {
    expect(normalizeCompany('Lumen Robotics AG')).toBe('lumen robotics');
    expect(normalizeCompany('Zürich Versicherungs-Gesellschaft AG')).toBe('zurich versicherungs gesellschaft');
    expect(normalizeCompany('Foo & Bar, Inc.')).toBe('foo and bar');
  });
  it('normalizes titles', () => {
    expect(normalizeTitle('Sr. Product Manager (m/w/d) 80-100%')).toBe('senior product manager');
    expect(normalizeTitle('Senior Product Manager')).toBe('senior product manager');
  });
  it('computes similarity', () => {
    expect(similarity('senior product manager', 'senior product manager ai')).toBeGreaterThan(0.7);
    expect(similarity('data engineer', 'office manager')).toBeLessThan(0.3);
  });
  it('extracts domains', () => {
    expect(domainOf('no-reply@greenhouse.io')).toBe('greenhouse.io');
    expect(domainOf('"Lumen" <jobs@lumen-robotics.com>')).toBe('lumen-robotics.com');
    expect(domainOf('https://www.example.com/jobs')).toBe('example.com');
    expect(registrableDomain('jobs.boards.greenhouse.io')).toBe('greenhouse.io');
    expect(registrableDomain('careers.foo.com.mx')).toBe('foo.com.mx');
  });
  it('canonicalizes urls', () => {
    expect(canonicalUrl('https://Jobs.Lever.co/acme/123/?utm_source=x&lever-source=y#top')).toBe('https://jobs.lever.co/acme/123');
  });
  it('diffs values', () => {
    const d = diffValues({ roles: ['PM'], remotePolicy: 'any' }, { roles: ['PM', 'Head of Product'], remotePolicy: 'hybrid_ok' });
    expect(d).toEqual([
      { path: 'roles', op: 'add', after: 'Head of Product' },
      { path: 'remotePolicy', op: 'change', before: 'any', after: 'hybrid_ok' },
    ]);
  });
});

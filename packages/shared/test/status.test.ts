import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES, canTransition, columnForStatus } from '../src/index.js';

describe('application status machine', () => {
  it('lets the user move anywhere', () => {
    for (const a of APPLICATION_STATUSES) for (const b of APPLICATION_STATUSES) if (a !== b) expect(canTransition(a, b, 'user')).toBe(true);
  });
  it('restricts the agent', () => {
    expect(canTransition('found', 'shortlisted', 'agent')).toBe(true);
    expect(canTransition('ready', 'applied', 'agent')).toBe(true);
    expect(canTransition('found', 'applied', 'agent')).toBe(false);
    expect(canTransition('applied', 'rejected', 'agent')).toBe(false);
  });
  it('lets email move applications forward but never backward', () => {
    expect(canTransition('applied', 'rejected', 'email')).toBe(true);
    expect(canTransition('applied', 'interview', 'email')).toBe(true);
    expect(canTransition('no_response', 'interview', 'email')).toBe(true);
    expect(canTransition('rejected', 'applied', 'email')).toBe(false);
    expect(canTransition('offer', 'applied', 'email')).toBe(false);
    expect(canTransition('withdrawn', 'interview', 'email')).toBe(false);
  });
  it('only the system sets no_response, only from applied', () => {
    expect(canTransition('applied', 'no_response', 'system')).toBe(true);
    expect(canTransition('interview', 'no_response', 'system')).toBe(false);
    expect(canTransition('applied', 'no_response', 'email')).toBe(false);
  });
  it('maps statuses to board columns', () => {
    expect(columnForStatus('drafting')).toBe('shortlisted');
    expect(columnForStatus('assessment')).toBe('interview');
    expect(columnForStatus('no_response')).toBe('closed');
    expect(columnForStatus('dismissed')).toBeNull();
  });
});

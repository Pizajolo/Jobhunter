import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsSchema, modelForTask, effectiveExclusions, estimateCostUsd } from '../src/index.js';

describe('settings defaults (spec §8)', () => {
  it('matches the spec defaults', () => {
    expect(DEFAULT_SETTINGS.language).toBe('en');
    expect(DEFAULT_SETTINGS.applicationLanguage).toBe('posting');
    expect(DEFAULT_SETTINGS.scan.time).toBe('07:00');
    expect(DEFAULT_SETTINGS.matchThresholdShow).toBe(60);
    expect(DEFAULT_SETTINGS.matchThresholdAutoShortlist).toBeNull();
    expect(DEFAULT_SETTINGS.discovery).toEqual({ enabled: true, frequency: 'weekly', autoAdd: false });
    expect(DEFAULT_SETTINGS.autoApply.level).toBe('prepare');
    expect(DEFAULT_SETTINGS.autoApply.minScore).toBe(85);
    expect(DEFAULT_SETTINGS.autoApply.dailyCap).toBe(5);
    expect(DEFAULT_SETTINGS.autoApply.excludedDomains).toEqual(['linkedin.com']);
    expect(DEFAULT_SETTINGS.noResponseAfterDays).toBe(21);
    expect(DEFAULT_SETTINGS.emailReviewConfidence).toBe(0.8);
    expect(DEFAULT_SETTINGS.monthlyBudgetUsd).toBeNull();
    expect(DEFAULT_SETTINGS.voice).toBe('off');
    expect(DEFAULT_SETTINGS.auth.mode).toBe('subscription');
  });

  it('rejects invalid values', () => {
    expect(SettingsSchema.safeParse({ applicationLanguage: 'klingon' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ scan: { time: '25:00' } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ applicationLanguage: 'fixed:de' }).success).toBe(true);
  });

  it('routes tasks to tier models with per-task overrides', () => {
    expect(modelForTask(DEFAULT_SETTINGS, 'email_classify')).toBe('claude-haiku-5-5');
    expect(modelForTask(DEFAULT_SETTINGS, 'cover_letter')).toBe('claude-opus-5-5');
    expect(modelForTask(DEFAULT_SETTINGS, 'form_fill')).toBe('claude-sonnet-5-5');
    const s = SettingsSchema.parse({ modelRouting: { email_classify: 'my-model' } });
    expect(modelForTask(s, 'email_classify')).toBe('my-model');
  });

  it('always excludes linkedin from auto-apply', () => {
    const s = SettingsSchema.parse({ autoApply: { excludedDomains: [] } });
    expect(effectiveExclusions(s)).toContain('linkedin.com');
  });

  it('estimates cost', () => {
    const c = estimateCostUsd(DEFAULT_SETTINGS.prices, 'claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 100_000 });
    expect(c).toBeCloseTo(3);
    expect(estimateCostUsd(DEFAULT_SETTINGS.prices, 'unknown', { inputTokens: 5, outputTokens: 5 })).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  blockingErrors,
  failureLine,
  formatCheck,
  latestSequence,
  submitBody,
  unackedWarnings,
} from '../src/lib/app-submit.js';
import type { SubmissionCheck } from '../src/lib/app-api.js';

const check = (overrides: Partial<SubmissionCheck> = {}): SubmissionCheck => ({
  key: 'listing',
  level: 'error',
  ok: true,
  detail: null,
  at: '2026-09-30T00:00:00Z',
  ...overrides,
});

const FORM = {
  testInstructions: 'Install on the demo store, open the dashboard page.',
  screencastUrl: 'https://example.com/demo.mp4',
  contactEmail: 'dev@example.com',
  emergencyEmail: 'ops@example.com',
  acknowledgedWarnings: [] as string[],
  attestationRequired: false,
};

describe('latestSequence (submit/withdraw default)', () => {
  it('takes the newest sequence and null when nothing is deployed', () => {
    expect(latestSequence([{ sequence: 1 }, { sequence: 3 }, { sequence: 2 }])).toBe(3);
    expect(latestSequence([])).toBeNull();
  });
});

describe('blockingErrors / unackedWarnings (checklist gates)', () => {
  it('blocks on failed error checks only', () => {
    const checks = [
      check({ key: 'listing', level: 'error', ok: false }),
      check({ key: 'tested', level: 'error', ok: true }),
      check({ key: 'embedded_frame', level: 'warning', ok: false }),
    ];
    expect(blockingErrors(checks).map((row) => row.key)).toEqual(['listing']);
    expect(unackedWarnings(checks, [])).toHaveLength(1);
    expect(unackedWarnings(checks, ['embedded_frame'])).toHaveLength(0);
  });
});

describe('formatCheck (one row per probe)', () => {
  it('marks ok rows and appends failing detail bounded', () => {
    expect(formatCheck(check())).toBe('✓ listing [error]');
    expect(formatCheck(check({ key: 'tested', ok: false, detail: { missing: ['demo'] } }))).toBe(
      '✗ tested [error] — {"missing":["demo"]}',
    );
    expect(formatCheck(check({ ok: false, detail: 'x'.repeat(400) }))).toMatch(/…$/);
  });
});

describe('submitBody (form validation mirrors the request rules)', () => {
  it('builds the body, dropping an empty phone and adding attestation when required', () => {
    expect(submitBody(FORM)).toEqual({
      test_instructions: FORM.testInstructions,
      screencast_url: FORM.screencastUrl,
      contact_email: FORM.contactEmail,
      emergency_contact: { email: FORM.emergencyEmail },
      acknowledged_warnings: [],
    });
    expect(
      submitBody({ ...FORM, emergencyPhone: '+2348000000000', attestationRequired: true, attestationItems: ['a', 'b'] }),
    ).toMatchObject({
      emergency_contact: { email: 'ops@example.com', phone: '+2348000000000' },
      attestation: { items: ['a', 'b'] },
    });
  });

  it('rejects missing instructions, long instructions, non-https screencasts and bad emails', () => {
    expect(() => submitBody({ ...FORM, testInstructions: '  ' })).toThrow('test-store credentials only');
    expect(() => submitBody({ ...FORM, testInstructions: 'x'.repeat(5001) })).toThrow('at most 5000');
    expect(() => submitBody({ ...FORM, screencastUrl: 'http://example.com/v.mp4' })).toThrow('https URL');
    expect(() => submitBody({ ...FORM, contactEmail: 'not-an-email' })).toThrow('contact email');
    expect(() => submitBody({ ...FORM, emergencyEmail: 'not-an-email' })).toThrow('emergency contact email');
    expect(() => submitBody({ ...FORM, emergencyPhone: 'x'.repeat(41) })).toThrow('at most 40');
  });

  it('demands agreed clauses when attestation is required', () => {
    expect(() => submitBody({ ...FORM, attestationRequired: true })).toThrow('agree to every clause');
    expect(() => submitBody({ ...FORM, attestationRequired: true, attestationItems: [] })).toThrow('agree to every clause');
  });
});

describe('failureLine (per-key refusal wording)', () => {
  it('words every evaluate() reason', () => {
    expect(failureLine('listing', 'error_failed')).toBe('listing: check failed');
    expect(failureLine('embedded_frame', 'warning_unacknowledged')).toBe('embedded_frame: warning not acknowledged');
    expect(failureLine('tested', 'stale')).toBe('tested: checks went stale — run `queek app submit` again to re-probe');
  });
});

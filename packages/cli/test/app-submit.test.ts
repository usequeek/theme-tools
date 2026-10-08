import { describe, expect, it } from 'vitest';
import {
  blockingErrors,
  failureLine,
  formatCheck,
  latestSequence,
  submitBody,
  unackedWarnings,
  wordSubmitFailure,
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

describe('formatCheck (server sentences, never detail JSON)', () => {
  it('prints label + message with ✓/✗/! marks', () => {
    expect(formatCheck(check({ label: 'Store listing', message: 'Name and icon look good.' }))).toBe(
      '✓ Store listing — Name and icon look good.',
    );
    expect(formatCheck(check({ key: 'listing', level: 'error', ok: false, label: 'Store listing', message: 'No description.' }))).toBe(
      '✗ Store listing — No description.',
    );
    expect(
      formatCheck(check({ key: 'embedded_frame', level: 'warning', ok: false, label: 'Embedded frame', message: 'Framing is off.' })),
    ).toBe('! Embedded frame — Framing is off.');
  });

  it('falls back to the key and nothing else on older servers', () => {
    expect(formatCheck(check())).toBe('✓ listing');
    expect(formatCheck(check({ key: 'tested', level: 'error', ok: false, detail: { missing: ['demo'] } }))).toBe('✗ tested');
    expect(formatCheck(check({ key: 'embedded_frame', level: 'warning', ok: false }))).toBe('! embedded_frame');
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

describe('wordSubmitFailure (thrown submit failures, worded)', () => {
  const base = { status: 409, message: 'Failed.', failures: [] as Array<{ key: string; reason: string }>, data: {} as Record<string, unknown> };
  it('no-ops an already-submitted version', () => {
    expect(wordSubmitFailure({ ...base, errorType: 'already_submitted' })).toEqual({ already: true });
  });
  it('matches the real lowercase idempotency codes', () => {
    expect(wordSubmitFailure({ ...base, errorCode: 'idempotency_key_reuse' })).toMatchObject({
      already: false,
      message: expect.stringContaining('fresh key'),
      exit: 1,
    });
    expect(wordSubmitFailure({ ...base, errorCode: 'idempotency_key_in_progress' })).toMatchObject({
      already: false,
      message: expect.stringContaining('still running'),
      exit: 1,
    });
  });
  it('words the stale-terms gate before the generic path (exact CLI copy)', () => {
    const worded = wordSubmitFailure({
      ...base,
      errorType: 'terms_update_required',
      message: 'The developer terms were updated — accept the current revision before submitting.',
      data: { terms_version: '1.2', terms_url: 'https://usequeek.com/developers/terms' },
    });
    expect(worded).toEqual({
      already: false,
      message:
        'Queek updated its Developer Terms (v1.2). Review and accept them in the dashboard — Developers → the banner at the top — then run `queek app submit` again. Terms: https://usequeek.com/developers/terms',
      exit: 1,
    });
  });
  it('lists per-key invalid_submission failures and names the 5/day throttle', () => {
    expect(
      wordSubmitFailure({ ...base, status: 422, errorType: 'invalid_submission', failures: [{ key: 'listing', reason: 'error_failed' }] }),
    ).toMatchObject({ already: false, message: expect.stringContaining('listing: check failed'), exit: 1 });
    expect(wordSubmitFailure({ ...base, status: 429, message: 'Too many.' })).toMatchObject({
      already: false,
      message: expect.stringContaining('5/day'),
      exit: 1,
    });
  });
});

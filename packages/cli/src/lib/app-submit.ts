import type { ApiFailure, AppVersion, SubmissionCheck, SubmitBody } from './app-api.js';

/**
 * Pure submit plumbing for `queek app submit` (tested in
 * app-submit.test.ts): the command owns prompts/flags/network, this module
 * owns every decision.
 */

/** The newest sequence, or null when nothing is deployed yet. */
export function latestSequence(versions: Array<{ sequence: number }>): number | null {
  if (versions.length === 0) return null;
  return Math.max(...versions.map((row) => row.sequence));
}

/** Error-level failed checks: these block before anything is asked. */
export function blockingErrors(checks: SubmissionCheck[]): SubmissionCheck[] {
  return checks.filter((check) => check.level === 'error' && !check.ok);
}

/** Warning-level failed checks the caller has not acknowledged yet. */
export function unackedWarnings(checks: SubmissionCheck[], acknowledged: string[]): SubmissionCheck[] {
  return checks.filter((check) => check.level === 'warning' && !check.ok && !acknowledged.includes(check.key));
}

/**
 * One checklist row in the server's own words: `✓/✗/! {label} — {message}`
 * (✗ a failing error, ! a failing warning). Detail JSON is never printed —
 * the sentences are built from it server-side. An older server that sends
 * neither falls back to the key and nothing else.
 */
export function formatCheck(check: SubmissionCheck): string {
  const mark = check.ok ? '✓' : check.level === 'warning' ? '!' : '✗';
  const label = check.label && check.label !== '' ? check.label : check.key;
  const message = typeof check.message === 'string' && check.message !== '' ? check.message : '';
  return message === '' ? `${mark} ${label}` : `${mark} ${label} — ${message}`;
}

/** The display label for prompts (server sentence, else the key). */
export function checkLabel(check: SubmissionCheck): string {
  return check.label && check.label !== '' ? check.label : check.key;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SubmitForm {
  testInstructions: string;
  screencastUrl: string;
  contactEmail: string;
  emergencyEmail: string;
  emergencyPhone?: string;
  acknowledgedWarnings: string[];
  /** Agreed attestation item keys — required non-empty when attestationRequired. */
  attestationItems?: string[];
  attestationRequired: boolean;
}

/**
 * Validate the submit form into the POST body (exit 2 upstream on throw).
 * Lengths and URLs follow the server's rules; the help behind test instructions
 * is test-store credentials only, never production credentials.
 */
export function submitBody(form: SubmitForm): SubmitBody {
  const instructions = form.testInstructions.trim();
  if (instructions === '') throw new Error('Test instructions are required (--test-instructions-file): how a reviewer exercises the app on a test store, with test-store credentials only — never production credentials.');
  if (instructions.length > 5000) throw new Error(`Test instructions run ${instructions.length} chars — the server takes at most 5000.`);
  if (!/^https:\/\//i.test(form.screencastUrl) || form.screencastUrl.length > 2048) {
    throw new Error('A screencast URL is required (--screencast-url): an https URL of at most 2048 chars.');
  }
  if (!EMAIL_RE.test(form.contactEmail) || form.contactEmail.length > 255) {
    throw new Error('A contact email is required (--contact-email): a valid address of at most 255 chars.');
  }
  if (!EMAIL_RE.test(form.emergencyEmail) || form.emergencyEmail.length > 255) {
    throw new Error('An emergency contact email is required (--emergency-email): a valid address of at most 255 chars.');
  }
  if (form.emergencyPhone !== undefined && form.emergencyPhone !== '' && form.emergencyPhone.length > 40) {
    throw new Error('The emergency phone takes at most 40 chars.');
  }
  const body: SubmitBody = {
    test_instructions: instructions,
    screencast_url: form.screencastUrl,
    contact_email: form.contactEmail,
    emergency_contact: {
      email: form.emergencyEmail,
      ...(form.emergencyPhone !== undefined && form.emergencyPhone !== '' ? { phone: form.emergencyPhone } : {}),
    },
    acknowledged_warnings: form.acknowledgedWarnings,
  };
  if (form.attestationRequired) {
    if (!form.attestationItems || form.attestationItems.length === 0) {
      throw new Error('This version needs attestation: agree to every clause the checklist shows (--attest in CI).');
    }
    body.attestation = { items: form.attestationItems };
  }
  return body;
}

/** One per-key refusal, worded (evaluate() reasons). */
export function failureLine(key: string, reason: string): string {
  if (reason === 'error_failed') return `${key}: check failed`;
  if (reason === 'warning_unacknowledged') return `${key}: warning not acknowledged`;
  if (reason === 'stale') return `${key}: checks went stale — run \`queek app submit\` again to re-probe`;
  return `${key}: ${reason}`;
}

/**
 * How a thrown submit failure reads. `already` is the 409 `already_submitted`
 * (the review slot is taken — the caller names who holds it); the rest are
 * fatal with clear messages.
 */
export function wordSubmitFailure(failure: ApiFailure): { already: true } | { already: false; message: string; exit: number } {
  if (failure.errorType === 'already_submitted') return { already: true };
  if (failure.errorType === 'terms_update_required') {
    const version = typeof failure.data.terms_version === 'string' ? failure.data.terms_version : 'current';
    const url = typeof failure.data.terms_url === 'string' ? failure.data.terms_url : '';
    const terms = url === '' ? '' : ` Terms: ${url}`;
    return {
      already: false,
      message: `Queek updated its Developer Terms (v${version}). Review and accept them in the dashboard — Developers → the banner at the top — then run \`queek app submit\` again.${terms}`,
      exit: 1,
    };
  }
  if (failure.errorCode === 'idempotency_key_reuse') {
    return { already: false, message: 'That Idempotency-Key was already used with a different body — retry with a fresh key (re-run the command).', exit: 1 };
  }
  if (failure.errorCode === 'idempotency_key_in_progress') {
    return { already: false, message: 'Another submit with this key is still running — wait a minute before retrying.', exit: 1 };
  }
  if (failure.errorType === 'invalid_submission' && failure.failures.length > 0) {
    return { already: false, message: `Submission refused:\n${failure.failures.map((row) => `  ${failureLine(row.key, row.reason)}`).join('\n')}`, exit: 1 };
  }
  if (failure.status === 429) {
    return { already: false, message: 'Submit rate limited (5/day) — try again tomorrow.', exit: 1 };
  }
  return { already: false, message: failure.message, exit: 1 };
}

/** A version blocking a submit: it sits in review already. */
export interface BlockingVersion {
  version: string;
  sequence: number;
}

/**
 * Why a submit did not happen (the `--json` `reason`):
 * - `already_in_review`: the target itself is in review — nothing to do;
 * - `other_version_in_review`: another version holds the one review slot.
 */
export type NotSubmittedReason = 'already_in_review' | 'other_version_in_review';

export interface ReviewSlot {
  reason: NotSubmittedReason;
  blocking: BlockingVersion[];
}

/**
 * Who holds the app's one review slot, before anything is submitted (the
 * server answers 409 `already_submitted` for both cases, and that refusal
 * still spends the 5/day submit budget). Null when the slot is free.
 */
export function reviewSlotTaken(versions: Array<Pick<AppVersion, 'version' | 'sequence' | 'review_status'>>, sequence: number): ReviewSlot | null {
  // Only a version that could be submitted competes for the slot; anything else (a public version, an unknown
  // sequence) gets the server's own refusal instead.
  const target = versions.find((row) => row.sequence === sequence);
  if (!target || !['development', 'rejected', 'in_review'].includes(target.review_status)) return null;
  const inReview = versions.filter((row) => row.review_status === 'in_review');
  if (inReview.some((row) => row.sequence === sequence)) {
    return { reason: 'already_in_review', blocking: [] };
  }
  const blocking = inReview
    .map((row) => ({ version: row.version, sequence: row.sequence }))
    .sort((a, b) => b.sequence - a.sequence);
  return blocking.length > 0 ? { reason: 'other_version_in_review', blocking } : null;
}

/** The sentence for a taken slot, naming each blocking version and the way out. */
export function reviewSlotLine(app: string, version: string, sequence: number, slot: ReviewSlot): string {
  if (slot.reason === 'already_in_review') {
    return `Not submitted: v${version} (sequence ${sequence}) is already in review — nothing to do.`;
  }
  // The server refused (409) but no version is in review by the time the list is read again: a decision landed in between.
  if (slot.blocking.length === 0) {
    return `Not submitted: Queek answered that a version of '${app}' is already in review, but none is now — run the same command again.`;
  }
  const names = slot.blocking.map((row) => `v${row.version} (sequence ${row.sequence})`).join(', ');
  const verb = slot.blocking.length === 1 ? 'is' : 'are';
  const withdraw = slot.blocking.map((row) => `queek app withdraw ${app} --sequence ${row.sequence} --yes`).join(' && ');
  return `Not submitted: ${names} ${verb} already in review, and an app has one version in review at a time. Withdraw it first (${withdraw}), or wait for the decision.`;
}

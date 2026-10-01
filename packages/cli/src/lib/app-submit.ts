import type { ApiFailure, SubmissionCheck, SubmitBody } from './app-api.js';

/**
 * Pure submit plumbing for `queek app submit` (tested in
 * app-submit.test.ts): the command owns prompts/flags/network, this module
 * owns every decision. Server shapes mirror SubmitAppVersionRequest.php and
 * SubmissionCheckService.php evaluate().
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
 * Lengths/URLs mirror the request rules; the help behind test instructions
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

/** How a thrown submit failure reads: already-submitted is a no-op, the rest are fatal with clear messages. */
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

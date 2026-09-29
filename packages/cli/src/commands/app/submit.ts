import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import * as p from '@clack/prompts';
import { apiFailureOf, LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { blockingErrors, checkLabel, formatCheck, latestSequence, submitBody, unackedWarnings, wordSubmitFailure } from '../../lib/app-submit.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppSubmit extends BaseCommand {
  static override summary = 'Submit a version for review, with checklist and attestation.';

  static override description = `Runs the readiness checklist (GET vendor/developer/apps/{app}/versions/{sequence}/submission), prints every check, then collects the submit form and POSTs it with an Idempotency-Key (fresh per run, reused on retry). Error-level failed checks block before anything is asked; warnings need explicit acknowledgement (prompted per warning, or --acknowledge); when the checklist requires attestation, every server-provided clause is shown and all must be agreed (--attest in CI — clause text is never hardcoded). Test instructions take test-store credentials only, never production credentials. --sequence defaults to the latest deployed version. In CI, QUEEK_APP_AUTOMATION_TOKEN authenticates with no login.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %> hello',
    '<%= config.bin %> <%= command.id %> hello --sequence 3',
    '<%= config.bin %> <%= command.id %> hello --test-instructions-file ./review-notes.md --screencast-url https://example.com/demo --contact-email dev@example.com --emergency-email ops@example.com --attest',
  ];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
  };

  static override flags = {
    ...appFlags,
    sequence: Flags.integer({ summary: 'The version sequence to submit (default: latest deployed).', min: 1 }),
    'test-instructions-file': Flags.string({ summary: 'File with reviewer instructions (test-store credentials only, never production).' }),
    'screencast-url': Flags.string({ summary: 'An https screencast URL (max 2048 chars).' }),
    'contact-email': Flags.string({ summary: 'Reviewer contact email.' }),
    'emergency-email': Flags.string({ summary: 'Emergency contact email.' }),
    'emergency-phone': Flags.string({ summary: 'Emergency contact phone (optional, max 40 chars).' }),
    acknowledge: Flags.string({ summary: 'Warning keys to acknowledge (repeatable, comma-separated).', multiple: true }),
    attest: Flags.boolean({ summary: 'Agree to every attestation clause (non-interactive).', default: false }),
  };

  async run(): Promise<{ app: string; version: string; sequence: number }> {
    const { args, flags } = await this.parse(AppSubmit);
    this.setVerbose(flags.verbose as boolean | undefined);
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));

    const sequence = await this.resolveSequence(api, args.app, flags.sequence);
    const checklist = await api.submission(args.app, sequence).catch((error: Error) => this.error(error.message, { exit: 1 }));
    this.log(`Submission checklist for ${args.app} v${checklist.version} (sequence ${checklist.sequence}, ${checklist.review_status}):`);
    for (const check of checklist.checks) this.log(`  ${formatCheck(check)}`);

    const errors = blockingErrors(checklist.checks);
    if (errors.length > 0) {
      for (const check of errors) this.logToStderr(`Blocked: ${formatCheck(check)}`);
      this.error(`${errors.length} checklist check(s) failed — fix them, then run \`queek app submit\` again.`, { exit: 1 });
    }

    let acknowledged = (flags.acknowledge ?? []).flatMap((entry) => entry.split(',')).map((key) => key.trim()).filter((key) => key !== '');
    let remaining = unackedWarnings(checklist.checks, acknowledged);
    if (remaining.length > 0) {
      if (!interactive) {
        this.error(
          `Unacknowledged warnings: ${remaining.map((check) => check.key).join(', ')}. Pass --acknowledge <key,...> (only after verifying each one).`,
          { exit: 2 },
        );
      }
      for (const check of remaining) {
        const label = checkLabel(check);
        const prompt = check.message ? `Submit without '${label}'? ${check.message}` : `Submit without '${label}'?`;
        const ok = this.answer<boolean>(await p.confirm({ message: prompt }));
        if (ok) acknowledged = [...acknowledged, check.key];
      }
      remaining = unackedWarnings(checklist.checks, acknowledged);
      if (remaining.length > 0) {
        this.error(`Warnings left unacknowledged: ${remaining.map((check) => check.key).join(', ')} — the reviewer refuses the submit.`, { exit: 1 });
      }
    }

    const attestationRequired = checklist.attestation?.required === true;
    const clauses = checklist.attestation?.items ?? [];
    let attested: string[] | undefined;
    if (attestationRequired) {
      if (clauses.length === 0) {
        this.error('Queek asked for data-protection confirmations but sent none — try again in a minute. If it keeps happening, contact developer support.', { exit: 1 });
      }
      this.log('This version needs attestation — every clause, agreed:');
      for (const clause of clauses) this.log(`  [${clause.key}] ${clause.text}`);
      const agreed = flags.attest || (interactive && this.answer<boolean>(await p.confirm({ message: `Agree to all ${clauses.length} clauses?` })));
      if (!agreed) {
        this.error('Attestation declined — pass --attest in CI or agree interactively.', { exit: 2 });
      }
      attested = clauses.map((clause) => clause.key);
    }

    const form = await this.collectForm(flags, interactive);
    let body;
    try {
      body = submitBody({ ...form, acknowledgedWarnings: acknowledged, attestationItems: attested, attestationRequired });
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    const idempotencyKey = randomUUID();
    const submitted = await api
      .submitVersion(args.app, sequence, body, idempotencyKey)
      .then((ok) => ({ ...ok, fresh: true }))
      .catch((error: Error) => this.submitError(error, checklist.version, sequence));
    if (!submitted.fresh) return { app: args.app, version: submitted.version, sequence: submitted.sequence };
    this.log(`Submitted v${submitted.version} — review usually within 3 business days.`);
    return { app: args.app, version: submitted.version, sequence: submitted.sequence };
  }

  private answer<T>(value: T | symbol): T {
    if (p.isCancel(value)) this.error('Cancelled.', { exit: 130 });
    return value as T;
  }

  private async resolveSequence(api: { appVersions: (app: string) => Promise<{ versions: Array<{ sequence: number }> }> }, app: string, wanted: number | undefined): Promise<number> {
    if (wanted !== undefined) return wanted;
    const { versions } = await api.appVersions(app).catch((error: Error) => this.error(error.message, { exit: 1 }));
    const latest = latestSequence(versions);
    if (latest === null) this.error(`'${app}' has no versions yet — \`queek app deploy\` cuts the first one.`, { exit: 1 });
    return latest;
  }

  private async collectForm(
    flags: { 'test-instructions-file'?: string; 'screencast-url'?: string; 'contact-email'?: string; 'emergency-email'?: string; 'emergency-phone'?: string },
    interactive: boolean,
  ): Promise<{ testInstructions: string; screencastUrl: string; contactEmail: string; emergencyEmail: string; emergencyPhone?: string }> {
    const need = async (label: string, flag: string | undefined, prompt: string): Promise<string> => {
      if (flag !== undefined && flag !== '') return flag;
      if (!interactive) this.error(`Missing ${label} — pass the corresponding flag (see --help).`, { exit: 2 });
      const value = this.answer<string>(await p.text({ message: prompt }));
      if (value.trim() === '') this.error(`Missing ${label} — pass the corresponding flag (see --help).`, { exit: 2 });
      return value;
    };
    const instructionsFile = flags['test-instructions-file'];
    let testInstructions: string;
    if (instructionsFile !== undefined) {
      try {
        testInstructions = readFileSync(instructionsFile, 'utf8');
      } catch (error) {
        this.error(`Cannot read ${instructionsFile}: ${(error as Error).message}`, { exit: 2 });
      }
    } else {
      testInstructions = await need(
        'test instructions',
        undefined,
        'Reviewer instructions (how to exercise the app on a TEST store — test-store credentials only, never production)?',
      );
    }
    return {
      testInstructions,
      screencastUrl: await need('screencast URL', flags['screencast-url'], 'Screencast URL (https)?'),
      contactEmail: await need('contact email', flags['contact-email'], 'Reviewer contact email?'),
      emergencyEmail: await need('emergency email', flags['emergency-email'], 'Emergency contact email?'),
      ...(flags['emergency-phone'] !== undefined ? { emergencyPhone: flags['emergency-phone'] } : {}),
    };
  }

  private submitError(error: Error, version: string, sequence: number): { version: string; sequence: number; fresh: boolean } {
    const failure = apiFailureOf(error);
    if (!failure) this.error(error.message, { exit: 1 });
    const worded = wordSubmitFailure(failure);
    if (worded.already) {
      this.log('That version was already submitted for review — nothing to do.');
      return { version, sequence, fresh: false };
    }
    this.error(worded.message, { exit: worded.exit });
  }
}

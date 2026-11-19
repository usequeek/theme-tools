import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { apiFailureOf, cleanText, errorText, LoginNeededError, type ReviewThreadEntry } from '../../../lib/app-api.js';
import { appFlags, appSession } from '../../../lib/app-command.js';
import { latestSequence } from '../../../lib/app-submit.js';
import { BaseCommand } from '../../../lib/base-command.js';

/** The server's cap on one reply (ReplyAppVersionRequest). */
const MAX_REPLY = 5000;

/** The thread as terminal lines: `queek:` or `you:`, oldest first, a reviewer's answer under the message it answers. */
export function threadLines(thread: ReviewThreadEntry[]): string[] {
  return thread.flatMap((entry) => [
    `  ${entry.from === 'developer' ? 'you' : 'queek'}: ${cleanText(entry.body ?? '')}`,
    ...(entry.answer ? [`  queek: ${cleanText(entry.answer)}`] : []),
  ]);
}

/** The reply text from --message or --file, trimmed and within the server's cap. */
export function replyText(message: string | undefined, file: string | undefined, read: (path: string) => string = (path) => readFileSync(path, 'utf8')): string {
  if ((message === undefined) === (file === undefined)) throw new Error('Pass the reply as --message "…" or --file <path> (one of them).');
  const text = (message ?? read(file as string)).trim();
  if (text === '') throw new Error('The reply is empty.');
  if (text.length > MAX_REPLY) throw new Error(`The reply is ${text.length} characters — the review thread takes at most ${MAX_REPLY}.`);
  return text;
}

export default class AppReviewReply extends BaseCommand {
  static override summary = "Reply to the reviewer on a version's review thread.";

  static override description = `POSTs vendor/developer/apps/{app}/versions/{sequence}/thread with an Idempotency-Key, then prints the thread. The review team opens the thread with their decision: until a reviewer has written, the server refuses the reply. --sequence defaults to the latest version. The reviewer's note also shows in \`queek app versions list\`.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %> hello --message "Fixed: the settings page now loads on the dev store."',
    '<%= config.bin %> <%= command.id %> hello --sequence 21 --file ./reply.md',
  ];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
  };

  static override flags = {
    ...appFlags,
    sequence: Flags.integer({ summary: 'The version sequence whose review you answer (default: latest).', min: 1 }),
    message: Flags.string({ char: 'm', summary: 'The reply (max 5000 chars).' }),
    file: Flags.string({ summary: 'Read the reply from a file instead.' }),
  };

  async run(): Promise<{ app: string; sequence: number; reply_id: string; thread: ReviewThreadEntry[] }> {
    const { args, flags } = await this.parse(AppReviewReply);
    this.setVerbose(flags.verbose as boolean | undefined);
    let body: string;
    try {
      body = replyText(flags.message, flags.file);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(errorText(error), { exit: error instanceof LoginNeededError ? 2 : 1 }));

    let sequence = flags.sequence;
    if (sequence === undefined) {
      const { versions } = await api.appVersions(args.app).catch((error: Error) => this.error(errorText(error), { exit: 1 }));
      const latest = latestSequence(versions);
      if (latest === null) this.error(`'${args.app}' has no versions yet — there is no review to answer.`, { exit: 1 });
      sequence = latest;
    }
    const replied = await api.replyToReview(args.app, sequence, body, randomUUID()).catch((error: Error) => {
      const failure = apiFailureOf(error);
      if (failure?.errorType === 'invalid_thread_reply') {
        this.error(`${failure.message} (sequence ${sequence} of '${args.app}' — \`queek app versions list ${args.app}\` shows each version's review status and note.)`, { exit: 1 });
      }
      this.error(errorText(error), { exit: 1 });
    });
    this.log(`Replied on the review of sequence ${sequence}. The thread:`);
    for (const line of threadLines(replied.thread)) this.log(line);
    return { app: args.app, sequence, reply_id: replied.replyId, thread: replied.thread };
  }
}

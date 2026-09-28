import { Flags } from '@oclif/core';
import { resolveVocabulary, type BusinessVocabularyData, type VocabularySource } from '@usequeek/theme-check';

export interface CommandVocabulary {
  data: BusinessVocabularyData;
  source: VocabularySource;
}

/**
 * The vocabulary flags every command takes: `--vocabulary <file>` pins a
 * copy, `--offline` uses the bundled snapshot, and the default is the live
 * copy through the resolver (cache, then bundled, with a notice on fallback).
 * The notice goes to `onNotice` (stderr on the commands) so `--format json`
 * stays one parseable object on stdout — and is printed once per command.
 */
export async function resolveCommandVocabulary(
  flags: { vocabulary?: string; offline?: boolean },
  onNotice: (line: string) => void,
): Promise<CommandVocabulary> {
  const resolved = await resolveVocabulary({
    mode: flags.offline ? 'offline' : 'live',
    file: flags.vocabulary,
  });
  if (resolved.notice) onNotice(resolved.notice);
  return { data: resolved.vocabulary, source: resolved.source };
}

/** The two flags, spread into a command's `static flags`. */
export const vocabularyFlags = {
  vocabulary: Flags.string({ summary: 'A pinned vocabulary file (default: the live copy).' }),
  offline: Flags.boolean({ summary: 'Use the bundled vocabulary snapshot; no network.', default: false }),
};

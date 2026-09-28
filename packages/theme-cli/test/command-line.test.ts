import { describe, expect, it } from 'vitest';
import { commandLine } from '../src/lib/command-line.js';

describe('commandLine', () => {
  it('names the theme topic through the queek bin', () => {
    for (const name of ['check', 'dev', 'init', 'package', 'screenshot']) {
      expect(commandLine({ bin: 'queek' }, name)).toBe(`queek theme ${name}`);
    }
  });

  it('names the alias bin everywhere else', () => {
    for (const name of ['check', 'dev', 'init', 'package', 'screenshot']) {
      expect(commandLine({ bin: 'queek-theme' }, name)).toBe(`queek-theme ${name}`);
    }
  });
});

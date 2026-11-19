import { describe, expect, it } from 'vitest';
import { iconContentType } from '../src/commands/app/icon.js';
import { replyText, threadLines } from '../src/commands/app/review/reply.js';
import { versionLines } from '../src/commands/app/versions/list.js';
import { devStoreLines } from '../src/commands/dev-store/shared.js';

describe('versions list rows', () => {
  it('marks the serving version and puts the review note, cleaned, under its row', () => {
    expect(versionLines([
      { version: '1.1.22', sequence: 22, review_status: 'development', review_note: 'Withdrawn by the developer.\n‮odd', current: false },
      { version: '1.1.0', sequence: 12, review_status: 'public', review_note: null, current: true },
    ])).toEqual([
      '  1.1.22 (sequence 22, development)',
      '    Note: Withdrawn by the developer. odd',
      '* 1.1.0 (sequence 12, public)',
    ]);
  });
});

describe('review reply', () => {
  it('takes --message or --file, exactly one, trimmed and within 5000 characters', () => {
    expect(replyText('  Fixed.  ', undefined)).toBe('Fixed.');
    expect(replyText(undefined, 'reply.md', () => 'From a file\n')).toBe('From a file');
    expect(() => replyText(undefined, undefined)).toThrow('one of them');
    expect(() => replyText('a', 'reply.md', () => 'b')).toThrow('one of them');
    expect(() => replyText('   ', undefined)).toThrow('The reply is empty.');
    expect(() => replyText('x'.repeat(5001), undefined)).toThrow('at most 5000');
  });

  it('prints the thread as you/queek lines, a reviewer answer under the message it answers', () => {
    expect(threadLines([
      { from: 'queek', body: 'The settings page does not load.', answer: null, createdAt: null },
      { from: 'developer', body: 'Fixed in 1.1.22.', answer: 'Thanks, re-testing.', createdAt: null },
    ])).toEqual(['  queek: The settings page does not load.', '  you: Fixed in 1.1.22.', '  queek: Thanks, re-testing.']);
  });
});

describe('app icon', () => {
  it('sends the type its extension names, octet-stream otherwise (the server explains the refusal)', () => {
    expect(iconContentType('icon.PNG')).toBe('image/png');
    expect(iconContentType('a/b/icon.jpeg')).toBe('image/jpeg');
    expect(iconContentType('icon.webp')).toBe('image/webp');
    expect(iconContentType('icon.svg')).toBe('application/octet-stream');
  });
});

describe('dev-store list rows', () => {
  it('prints p_id, name, slug, test data and storefront — never a password', () => {
    const store = { id: 1, p_id: 1259, name: 'Queek demo', slug: 'queek-demo', storefront_url: 'https://queek-demo.queek.app', admin_url: null, test_data_status: 'done', created_at: null, storefront_password: 'secret' };
    const lines = devStoreLines([store]);
    expect(lines).toEqual(['1259  Queek demo (queek-demo) · test data: done · https://queek-demo.queek.app']);
    expect(lines.join('\n')).not.toContain('secret');
    expect(devStoreLines([])[0]).toContain('queek dev-store create');
  });
});

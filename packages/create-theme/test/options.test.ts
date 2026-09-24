import { describe, expect, it } from 'vitest';
import { UsageError, equivalentCommand, resolveAnswers, type Flags } from '../src/options.js';

const flags = (overrides: Partial<Flags> = {}): Flags => ({ install: false, git: false, yes: true, dryRun: false, force: false, ...overrides });

describe('resolveAnswers without a terminal', () => {
  it('builds the answers from flags alone', async () => {
    const answers = await resolveAnswers(flags({ dir: 'mo', name: 'Mọ́ Laundry', templates: 'foods,laundry', primary: 'laundry', tags: 'minimal', pages: 'faq', ai: 'gemini' }), null);
    expect(answers).toMatchObject({ slug: 'mo-laundry', categories: ['laundry', 'foods'], pages: ['faq'], ai: ['gemini'] });
    expect(answers.templates.map((t) => t.id)).toEqual(['default', 'foods']);
  });

  it('defaults the name to the folder, pages to contact and faq, AI to every assistant', async () => {
    const answers = await resolveAnswers(flags({ dir: 'my-theme', templates: 'laundry', tags: 'minimal' }), null);
    expect(answers).toMatchObject({ name: 'my-theme', pages: ['contact', 'faq'], ai: ['claude', 'gemini'] });
  });

  it('names the flag a missing answer needs', async () => {
    await expect(resolveAnswers(flags({ dir: 'x-theme', tags: 'minimal' }), null)).rejects.toThrow(/--templates is required/);
    await expect(resolveAnswers(flags({ dir: 'x-theme', templates: 'laundry' }), null)).rejects.toThrow(/--tags is required/);
  });

  it('suggests the nearest value for an unknown one', async () => {
    const error = await resolveAnswers(flags({ dir: 'x-theme', templates: 'jewellery', tags: 'minimal' }), null).catch((e) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect(error.message).toBe('Unknown business "jewellery" in --templates — did you mean "jewelry"?');
  });

  it("refuses a category that is not a business category, and a Queek theme's slug", async () => {
    await expect(resolveAnswers(flags({ dir: 'x-theme', templates: 'laundry', tags: 'minimal', categories: 'jewelry' }), null)).rejects.toThrow(/Unknown category "jewelry"/);
    await expect(resolveAnswers(flags({ dir: 'medley', templates: 'laundry', tags: 'minimal' }), null)).rejects.toThrow(/one of Queek's own themes/);
  });

  it('reads --pages none and --no-ai', async () => {
    const answers = await resolveAnswers(flags({ dir: 'x-theme', templates: 'laundry', tags: 'minimal', pages: 'none', noAi: true }), null);
    expect(answers).toMatchObject({ pages: [], ai: false });
  });

  it('--pages none must be the only value', async () => {
    const answers = await resolveAnswers(flags({ dir: 'x-theme', templates: 'laundry', tags: 'minimal', pages: 'none' }), null);
    expect(answers.pages).toEqual([]);
    await expect(resolveAnswers(flags({ dir: 'x-theme', templates: 'laundry', tags: 'minimal', pages: 'none,faq' }), null)).rejects.toThrow(/--pages none cannot be combined/);
  });

  it('--categories cannot be empty', async () => {
    await expect(resolveAnswers(flags({ dir: 'x-theme', templates: 'laundry', tags: 'minimal', categories: '' }), null)).rejects.toThrow(/at least one business category/);
  });
});

describe('equivalentCommand', () => {
  it('puts npm flags after --, and not for the others', async () => {
    const answers = await resolveAnswers(flags({ dir: 'mo', name: 'Mo', templates: 'laundry', tags: 'minimal' }), null);
    expect(equivalentCommand('npm', 'mo', answers)).toBe("npm create @usequeek/theme@latest mo -- --name 'Mo' --templates laundry --primary laundry --categories laundry --tags minimal --pages contact,faq --ai claude,gemini");
    expect(equivalentCommand('pnpm', 'mo', answers)).toMatch(/^pnpm create @usequeek\/theme mo --name/);
  });

  it('quotes dir when it contains special characters', async () => {
    const answers = await resolveAnswers(flags({ dir: 'New Theme', name: 'New', templates: 'laundry', tags: 'minimal' }), null);
    expect(equivalentCommand('npm', 'New Theme', answers)).toMatch(/^npm create @usequeek\/theme@latest 'New Theme' -- /);
  });
});

import { describe, expect, it } from 'vitest';
import { UsageError, equivalentCommand, resolveAnswers, type Flags, type Prompter } from '../src/options.js';
import type { Assistant, OptionalPage } from '../src/setup.js';

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

  it('keeps each value once, in the order first given', async () => {
    const answers = await resolveAnswers(flags({ dir: 'x-theme', templates: 'laundry,foods,laundry', categories: 'foods,laundry,foods', tags: 'minimal,minimal', pages: 'faq,contact,faq', ai: 'gemini,gemini' }), null);
    expect(answers.tags).toEqual(['minimal']);
    expect(answers.categories).toEqual(['foods', 'laundry']);
    expect(answers.pages).toEqual(['faq', 'contact']);
    expect(answers.templates.map((t) => t.key)).toEqual(['laundry', 'foods']);
    expect(answers.ai).toEqual(['gemini']);
  });

  it('--categories cannot be empty', async () => {
    await expect(resolveAnswers(flags({ dir: 'x-theme', templates: 'laundry', tags: 'minimal', categories: '' }), null)).rejects.toThrow(/at least one business category/);
  });
});

interface Script { name?: string; templates?: string[]; primary?: string; categories?: string[]; tags?: string[]; pages?: OptionalPage[]; ai?: Assistant[] }

/** A terminal with scripted answers. Records each question asked, and the checks the questions were given. */
function scripted(script: Script) {
  const asked: string[] = [];
  const checks: { name?: (name: string) => string | undefined; tags?: (tags: string[]) => string | undefined } = {};
  const reply = <T>(question: string, value: T | undefined): Promise<T> => {
    asked.push(question);
    if (value === undefined) throw new Error(`asked "${question}", which has no scripted answer`);
    return Promise.resolve(value);
  };
  const prompter: Prompter = {
    name: (_initial, problem) => { checks.name = problem; return reply('name', script.name); },
    templates: () => reply('templates', script.templates),
    primary: () => reply('primary', script.primary),
    categories: () => reply('categories', script.categories),
    tags: (problem) => { checks.tags = problem; return reply('tags', script.tags); },
    pages: () => reply('pages', script.pages),
    ai: () => reply('ai', script.ai),
  };
  return { prompter, asked, checks };
}

describe('resolveAnswers in a terminal', () => {
  const everything: Script = { name: 'Mọ́ Laundry', templates: ['foods', 'laundry'], primary: 'laundry', categories: ['laundry'], tags: ['minimal', 'bold'], pages: ['faq'], ai: ['gemini'] };

  it('asks for every answer no flag gives, in order', async () => {
    const { prompter, asked } = scripted(everything);
    const answers = await resolveAnswers({ install: false, git: false, yes: false, dryRun: false, force: false }, prompter);
    expect(asked).toEqual(['name', 'templates', 'primary', 'categories', 'tags', 'pages', 'ai']);
    expect(answers).toMatchObject({ name: 'Mọ́ Laundry', categories: ['laundry'], tags: ['minimal', 'bold'], pages: ['faq'], ai: ['gemini'] });
    expect(answers.templates.map((t) => [t.id, t.key])).toEqual([['default', 'laundry'], ['foods', 'foods']]);
  });

  it('asks nothing a flag answers', async () => {
    const { prompter, asked } = scripted({});
    const answers = await resolveAnswers(flags({ yes: false, name: 'Mo', templates: 'foods,laundry', primary: 'laundry', categories: 'laundry', tags: 'minimal', pages: 'faq', ai: 'claude' }), prompter);
    expect(asked).toEqual([]);
    expect(answers).toMatchObject({ slug: 'mo', tags: ['minimal'], pages: ['faq'], ai: ['claude'] });
  });

  it('derives the slug and prefix from the answered name', async () => {
    const answers = await resolveAnswers({ install: false, git: false, yes: false, dryRun: false, force: false }, scripted(everything).prompter);
    expect(answers).toMatchObject({ slug: 'mo-laundry', prefix: 'ml' });
  });

  it('the name question refuses a name whose slug cannot be used, so no later answer is lost', async () => {
    const { prompter, checks } = scripted(everything);
    await resolveAnswers({ install: false, git: false, yes: false, dryRun: false, force: false }, prompter);
    expect(checks.name?.('Nova')).toBe('"nova" is one of Queek\'s own themes. Choose another name.');
    expect(checks.name?.('鮨店')).toMatch(/must be 2 to 31 characters/);
    expect(checks.name?.('x')).toBe('At least 2 characters.');
    expect(checks.name?.('My Shop')).toBeUndefined();
  });

  it('the tags question asks again until 1 to 6 are picked, naming no flag', async () => {
    const { prompter, checks } = scripted(everything);
    await resolveAnswers({ install: false, git: false, yes: false, dryRun: false, force: false }, prompter);
    expect(checks.tags?.([])).toBe('Pick 1 to 6 tags.');
    expect(checks.tags?.(['light', 'dark', 'warm', 'cool', 'bold', 'modern', 'classic'])).toBe('Pick 1 to 6 tags.');
    expect(checks.tags?.(['minimal'])).toBeUndefined();
  });

  it('checks every flag before the first question', async () => {
    const { prompter, asked } = scripted(everything);
    await expect(resolveAnswers(flags({ yes: false, pages: 'about' }), prompter)).rejects.toThrow(/Unknown page "about"/);
    await expect(resolveAnswers(flags({ yes: false, ai: 'copilot' }), prompter)).rejects.toThrow(/Unknown assistant "copilot"/);
    expect(asked).toEqual([]);
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

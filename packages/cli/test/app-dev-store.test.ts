import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, DeveloperApi, type DevStore, type FetchImpl } from '../src/lib/app-api.js';
import { infoLines } from '../src/commands/app/info.js';
import { readyLines } from '../src/commands/app/dev.js';
import {
  createNewDevStore,
  DevStoreError,
  forgetSavedStore,
  readSavedStore,
  saveStore,
  selectDevStore,
  type DevStorePrompts,
  type DevStoreRequest,
} from '../src/lib/app-dev-store.js';

const store = (p_id: number, name: string, slug = name.toLowerCase().replace(/\s+/g, '-')): DevStore => ({
  id: p_id * 10,
  p_id,
  name,
  slug,
  storefront_url: null,
  admin_url: null,
  created_at: null,
});
const A = store(1205, 'Alpha dev');
const B = store(1184, 'Beta dev');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakes(stores: DevStore[], created: Partial<DevStore> & { storefront_password?: string } = {}) {
  const api = {
    devStores: vi.fn(async () => ({ data: stores })),
    createDevStore: vi.fn(async (name: string, _testData: boolean, _key: string, slug?: string) => ({
      ...store(2001, name, slug),
      ...created,
    })),
  };
  const prompts: DevStorePrompts = {
    confirmCreate: vi.fn(async () => true),
    choose: vi.fn(async () => 'new' as const),
    askName: vi.fn(async (initial: string) => `${initial} 2`),
  };
  const lines: string[] = [];
  return { api, prompts, lines, log: (line: string) => lines.push(line) };
}

const request = (extra: Partial<DevStoreRequest> = {}): DevStoreRequest => ({ appName: 'Hello', create: false, interactive: false, ...extra });

describe('selectDevStore', () => {
  it('auto-selects the only dev store, silently', async () => {
    const f = fakes([A]);
    const picked = await selectDevStore(f.api, request(), f.prompts, f.log);
    expect(picked).toEqual({ store: A, created: false });
    expect(f.prompts.choose).not.toHaveBeenCalled();
    expect(f.api.createDevStore).not.toHaveBeenCalled();
    expect(f.lines).toEqual([]);
  });

  it('with several stores on a terminal: prompts a choice and returns the picked one', async () => {
    const f = fakes([A, B]);
    vi.mocked(f.prompts.choose).mockResolvedValueOnce(1184);
    const picked = await selectDevStore(f.api, request({ interactive: true }), f.prompts, f.log);
    expect(picked.store).toEqual(B);
    expect(f.prompts.choose).toHaveBeenCalledWith([A, B], true);
  });

  it("the choice menu's 'create a new dev store' asks a name and creates", async () => {
    const f = fakes([A, B]);
    const picked = await selectDevStore(f.api, request({ interactive: true, storeSlug: 'my-new' }), f.prompts, f.log);
    expect(f.prompts.askName).toHaveBeenCalledWith('Hello dev');
    expect(f.api.createDevStore).toHaveBeenCalledWith('Hello dev 2', true, expect.any(String), 'my-new');
    expect(picked).toMatchObject({ created: true, store: { p_id: 2001, name: 'Hello dev 2' } });
  });

  it('with several stores and no terminal and no --store: fails listing them and naming the flag', async () => {
    const f = fakes([A, B]);
    const error = await selectDevStore(f.api, request(), f.prompts, f.log).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DevStoreError);
    expect((error as DevStoreError).exit).toBe(2);
    expect((error as Error).message).toContain('You own 2 dev stores');
    expect((error as Error).message).toContain('--store <p_id|slug|name> (for example --store 1205)');
    expect((error as Error).message).toContain('1205 (Alpha dev), 1184 (Beta dev)');
    expect((error as Error).message).toContain('--create-dev-store');
    expect(f.prompts.choose).not.toHaveBeenCalled();
  });

  it('--create-dev-store creates a NEW store even when others exist, without asking', async () => {
    const f = fakes([A, B]);
    const picked = await selectDevStore(f.api, request({ create: true, storeName: 'Checkout tests', storeSlug: 'checkout-tests' }), f.prompts, f.log);
    expect(f.api.createDevStore).toHaveBeenCalledWith('Checkout tests', true, expect.any(String), 'checkout-tests');
    expect(picked).toMatchObject({ created: true, store: { name: 'Checkout tests' } });
    expect(f.prompts.choose).not.toHaveBeenCalled();
    expect(f.prompts.confirmCreate).not.toHaveBeenCalled();
  });

  it('--create-dev-store names the store "<app name> dev" by default', async () => {
    const f = fakes([A]);
    await selectDevStore(f.api, request({ create: true }), f.prompts, f.log);
    expect(f.api.createDevStore).toHaveBeenCalledWith('Hello dev', true, expect.any(String), undefined);
  });

  it('--create-dev-store with --store is refused: one or the other', async () => {
    const f = fakes([A]);
    const error = await selectDevStore(f.api, request({ create: true, wanted: '1205' }), f.prompts, f.log).catch((e: unknown) => e);
    expect((error as DevStoreError).exit).toBe(2);
    expect(f.api.createDevStore).not.toHaveBeenCalled();
  });

  it('--store matches a p_id, a slug or a name', async () => {
    for (const wanted of ['1184', 'beta-dev', 'Beta dev']) {
      const f = fakes([A, B]);
      expect((await selectDevStore(f.api, request({ wanted }), f.prompts, f.log)).store).toEqual(B);
    }
  });

  it('--store that is not a dev store of yours reads as wrong-kind, listing yours', async () => {
    const f = fakes([A]);
    const error = await selectDevStore(f.api, request({ wanted: '999' }), f.prompts, f.log).catch((e: unknown) => e);
    expect((error as Error).message).toContain("Could not find dev store '999'. Yours: 1205 (Alpha dev).");
    expect((error as Error).message).toContain('Ensure the store is a dev store');
    expect((error as DevStoreError).exit).toBe(2);
  });

  it('with no dev store: asks on a terminal, creates on yes, refuses without a terminal', async () => {
    const yes = fakes([]);
    expect(await selectDevStore(yes.api, request({ interactive: true }), yes.prompts, yes.log)).toMatchObject({ created: true });
    expect(yes.prompts.confirmCreate).toHaveBeenCalledWith('Hello dev');

    const no = fakes([]);
    vi.mocked(no.prompts.confirmCreate).mockResolvedValueOnce(false);
    await expect(selectDevStore(no.api, request({ interactive: true }), no.prompts, no.log)).rejects.toThrow('No dev stores');
    expect(no.api.createDevStore).not.toHaveBeenCalled();

    const ci = fakes([]);
    const error = await selectDevStore(ci.api, request(), ci.prompts, ci.log).catch((e: unknown) => e);
    expect((error as Error).message).toContain('--create-dev-store');
    expect(ci.prompts.confirmCreate).not.toHaveBeenCalled();
  });

  it('reuses the store picked last time while it still exists, else falls back to the normal rules', async () => {
    const remembered = fakes([A, B]);
    expect((await selectDevStore(remembered.api, request({ saved: 1184 }), remembered.prompts, remembered.log)).store).toEqual(B);
    expect(remembered.prompts.choose).not.toHaveBeenCalled();

    const gone = fakes([A, B]);
    await expect(selectDevStore(gone.api, request({ saved: 4242 }), gone.prompts, gone.log)).rejects.toThrow('You own 2 dev stores');
  });

  it('--store and --create-dev-store beat the remembered store', async () => {
    const f = fakes([A, B]);
    expect((await selectDevStore(f.api, request({ saved: 1184, wanted: '1205' }), f.prompts, f.log)).store).toEqual(A);
    expect((await selectDevStore(f.api, request({ saved: 1184, create: true }), f.prompts, f.log)).created).toBe(true);
  });

  it('a failed list stops with the API message', async () => {
    const f = fakes([A]);
    f.api.devStores.mockRejectedValueOnce(new ApiError('Cannot reach https://api.test: offline', 0, null));
    const error = await selectDevStore(f.api, request(), f.prompts, f.log).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DevStoreError);
    expect((error as DevStoreError).exit).toBe(1);
  });
});

describe('createNewDevStore (refusals and the one-time password)', () => {
  it('refuses clearly when the plan or limit says no, with the way out', async () => {
    const f = fakes([]);
    f.api.createDevStore.mockRejectedValueOnce(
      new ApiError('You have reached your dev store limit.', 422, { error_type: 'dev_store_limit_reached', message: 'You have reached your dev store limit.' }),
    );
    const error = await createNewDevStore(f.api, 'X', undefined, f.log).catch((e: unknown) => e);
    expect((error as Error).message).toContain('Could not create a dev store: You have reached your dev store limit.');
    expect((error as Error).message).toContain('Delete one you no longer need');
    expect((error as Error).message).toContain('--store');
    expect(f.lines).toEqual([]);
  });

  it('every refusal carries the request id on its own line', async () => {
    for (const failure of [
      new ApiError('You have reached your dev store limit.', 422, { error_type: 'dev_store_limit_reached' }, 'req_limit'),
      new ApiError("That store slug is taken. 'a-2' is free.", 422, { error_type: 'slug_taken' }, 'req_slug'),
      new ApiError('Something broke.', 500, null, 'req_boom'),
    ]) {
      const f = fakes([]);
      f.api.createDevStore.mockRejectedValueOnce(failure);
      const error = (await createNewDevStore(f.api, 'X', undefined, f.log).catch((e: unknown) => e)) as Error;
      expect(error.message.split('\n').at(-1)).toBe(`Request id: ${failure.requestId}`);
    }
  });

  it('a failed store list carries the request id too', async () => {
    const f = fakes([A]);
    f.api.devStores.mockRejectedValueOnce(new ApiError('Server error', 500, null, 'req_list'));
    const error = (await selectDevStore(f.api, request(), f.prompts, f.log).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('Server error\nRequest id: req_list');
  });

  it('treats a 403 plan refusal the same way', async () => {
    const f = fakes([]);
    f.api.createDevStore.mockRejectedValueOnce(new ApiError('Your plan does not include dev stores.', 403, null));
    await expect(createNewDevStore(f.api, 'X', undefined, f.log)).rejects.toThrow('Your plan does not include dev stores.');
  });

  it('a taken slug repeats the server suggestion and names the flag', async () => {
    const f = fakes([]);
    f.api.createDevStore.mockRejectedValueOnce(new ApiError("That store slug is taken. 'a-dev-2' is free.", 422, { error_type: 'slug_taken' }));
    const error = await createNewDevStore(f.api, 'A', 'a-dev', f.log).catch((e: unknown) => e);
    expect((error as Error).message).toContain("'a-dev-2' is free.");
    expect((error as Error).message).toContain('--dev-store-address');
    expect((error as DevStoreError).exit).toBe(2);
  });

  it('prints the storefront password once, labelled, and strips it from the returned store', async () => {
    const f = fakes([], { storefront_password: 'pw-once-123' });
    const created = await createNewDevStore(f.api, 'Hello dev', undefined, f.log);
    expect(f.lines.filter((line) => line.includes('pw-once-123'))).toHaveLength(1);
    expect(f.lines.join('\n')).toContain('shown only now, save it');
    expect('storefront_password' in created).toBe(false);
  });
});

describe('the saved selection (.queek/dev.json)', () => {
  const stage = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-store-'));
    dirs.push(dir);
    return dir;
  };

  it('round-trips, forgets, and reads a missing or broken file as none', () => {
    const dir = stage();
    expect(readSavedStore(dir)).toBeNull();
    saveStore(dir, 1205);
    expect(readSavedStore(dir)).toBe(1205);
    expect(forgetSavedStore(dir)).toBe(true);
    expect(readSavedStore(dir)).toBeNull();
    expect(forgetSavedStore(dir)).toBe(false);
    writeFileSync(join(dir, 'dev.json'), '{nope');
    expect(readSavedStore(dir)).toBeNull();
    writeFileSync(join(dir, 'dev.json'), '{"store":"12"}');
    expect(readSavedStore(dir)).toBeNull();
  });
});

describe('storefront password hygiene (shown once at creation, never again)', () => {
  const PASSWORD = 'pw-secret-9f3a';
  const row = { ...store(2001, 'Hello dev'), storefront_password: PASSWORD };
  const apiFor = (): DeveloperApi => {
    const fetchImpl: FetchImpl = async (url, init) => {
      const post = init?.method === 'POST';
      const body = post ? { status: 'success', message: 'created', data: row } : { status: 'success', message: 'ok', data: { data: [row], meta: { total: 1 } } };
      void url;
      return new Response(JSON.stringify(body), { status: post ? 201 : 200, headers: { 'content-type': 'application/json' } });
    };
    return new DeveloperApi('https://api.test', { fetchImpl, getAuth: async () => ({ token: 't', kind: 'user' as const }) });
  };
  const everythingPrinted = (picked: DevStore, lines: string[]): string =>
    [...lines, ...readyLines('https://t.example.com', 'https://dash/open?store=2001&app=hello', picked, 'app_1'), ...infoLines({ file: 'queek.app.toml', name: 'Hello', slug: 'hello', appId: 'app_1', scopes: [], store: picked.name, user: 'developer session' }), JSON.stringify(picked)].join('\n');

  it('a creation run prints the password exactly once and the ready block and info never do', async () => {
    const lines: string[] = [];
    const { store: picked, created } = await selectDevStore(apiFor(), request({ create: true }), fakes([]).prompts, (line) => lines.push(line));
    expect(created).toBe(true);
    expect(everythingPrinted(picked, lines).split(PASSWORD)).toHaveLength(2);
    expect(lines.filter((line) => line.includes(PASSWORD))).toHaveLength(1);
    expect(lines.find((line) => line.includes(PASSWORD))).toContain('shown only now');
  });

  it('later runs (the server still lists the password) print it nowhere: not in logs, ready block, info or the store object', async () => {
    for (const extra of [{}, { wanted: '2001' }, { saved: 2001 }]) {
      const lines: string[] = [];
      const { store: picked, created } = await selectDevStore(apiFor(), request(extra), fakes([]).prompts, (line) => lines.push(line));
      expect(created).toBe(false);
      expect(everythingPrinted(picked, lines)).not.toContain(PASSWORD);
    }
  });

  it('the choice menu path on a run that selects an existing store prints no password either', async () => {
    const lines: string[] = [];
    const prompts = fakes([]).prompts;
    const { store: picked } = await selectDevStore(apiFor(), request({ interactive: true }), prompts, (line) => lines.push(line));
    expect(everythingPrinted(picked, lines)).not.toContain(PASSWORD);
  });
});

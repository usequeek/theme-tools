import { describe, expect, it, vi } from 'vitest';
import { cleanDevInstall } from '../src/commands/app/dev/clean.js';
import { ApiError, DeveloperApi, type DevStore, type FetchImpl } from '../src/lib/app-api.js';
import { DevStoreError, selectDevStore, type DevStorePrompts } from '../src/lib/app-dev-store.js';

const STORE = { p_id: 1205, name: 'Alpha dev' };
const row = (p_id: number, name: string): DevStore => ({ id: p_id, p_id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), storefront_url: null, admin_url: null, created_at: null });

describe('cleanDevInstall', () => {
  it('removes the install and prints what was removed', async () => {
    const api = { removeDevInstall: vi.fn(async () => undefined) };
    const lines: string[] = [];
    expect(await cleanDevInstall(api, 'hello', STORE, (line) => lines.push(line))).toBe(true);
    expect(api.removeDevInstall).toHaveBeenCalledWith('hello', 1205);
    expect(lines[0]).toBe("Removed the dev install of 'hello' from dev store 'Alpha dev' (1205).");
    expect(lines.join('\n')).toContain('not touched');
  });

  it('a store with no install is a clean no-op, not an error', async () => {
    const api = { removeDevInstall: vi.fn(async () => { throw new ApiError('Dev install not found', 404, { message: 'Dev install not found' }); }) };
    const lines: string[] = [];
    expect(await cleanDevInstall(api, 'hello', STORE, (line) => lines.push(line))).toBe(false);
    expect(lines).toEqual(["Nothing to remove: 'hello' has no dev install on dev store 'Alpha dev' (1205)."]);
  });

  it('an API without the removal route says so and points at the store admin', async () => {
    for (const failure of [new ApiError('The route api/v1/biz/vendor/developer/apps/hello/dev-installs/1205 could not be found.', 404, null), new ApiError('Method not allowed', 405, null)]) {
      const api = { removeDevInstall: vi.fn(async () => { throw failure; }) };
      await expect(cleanDevInstall(api, 'hello', STORE, () => {})).rejects.toThrow("cannot remove a dev install yet — uninstall 'hello' from the admin of dev store 'Alpha dev'");
    }
  });

  it('any other failure surfaces untouched', async () => {
    const failure = new ApiError('Server error', 500, null);
    const api = { removeDevInstall: vi.fn(async () => { throw failure; }) };
    await expect(cleanDevInstall(api, 'hello', STORE, () => {})).rejects.toBe(failure);
  });
});

describe('DeveloperApi.removeDevInstall', () => {
  it('sends DELETE /apps/{app}/dev-installs/{store p_id} with the bearer', async () => {
    const calls: Array<{ url: string; method?: string; auth?: string }> = [];
    const fetchImpl: FetchImpl = async (url, init) => {
      calls.push({ url, method: init?.method, auth: (init?.headers as Record<string, string>).authorization });
      return new Response(JSON.stringify({ status: 'success', message: 'ok', data: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: async () => ({ token: 'tok', kind: 'user' as const }) });
    await api.removeDevInstall('hello', 1205);
    expect(calls).toEqual([{ url: 'https://api.test/api/v1/biz/vendor/developer/apps/hello/dev-installs/1205', method: 'DELETE', auth: 'Bearer tok' }]);
  });
});

describe('selecting a store for clean (never creates one)', () => {
  const prompts = (): DevStorePrompts => ({
    confirmCreate: vi.fn(async () => true),
    choose: vi.fn(async () => 1205),
    askName: vi.fn(async () => 'x'),
  });
  const api = (stores: DevStore[]) => ({ devStores: vi.fn(async () => ({ data: stores })), createDevStore: vi.fn() });

  it('with no dev store: errors, never offers to create', async () => {
    const f = api([]);
    const p = prompts();
    const error = await selectDevStore(f, { appName: 'Hello', create: false, interactive: true, allowCreate: false }, p, () => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DevStoreError);
    expect(p.confirmCreate).not.toHaveBeenCalled();
    expect(f.createDevStore).not.toHaveBeenCalled();
  });

  it('with several: the menu has no create option and the CI error does not mention --create-dev-store', async () => {
    const stores = [row(1205, 'Alpha dev'), row(1184, 'Beta dev')];
    const p = prompts();
    await selectDevStore(api(stores), { appName: 'Hello', create: false, interactive: true, allowCreate: false }, p, () => {});
    expect(p.choose).toHaveBeenCalledWith(stores, false);
    const error = await selectDevStore(api(stores), { appName: 'Hello', create: false, interactive: false, allowCreate: false }, p, () => {}).catch((e: unknown) => e);
    expect((error as Error).message).toContain('--store');
    expect((error as Error).message).not.toContain('--create-dev-store');
  });
});

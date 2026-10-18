import { describe, expect, it, vi } from 'vitest';
import { createDevDeployer, isFrozenVersionRefusal, latestDevelopmentVersion } from '../src/commands/app/dev.js';
import { ApiError, type AppVersion, type DeployResult, type DeveloperApi, type ReviewRequired } from '../src/lib/app-api.js';
import type { AppManifest } from '../src/lib/app-manifest.js';

const MANIFEST = { slug: 'hello', name: 'Hello', scopes: [], install_url: 'https://hello.example.com/install', uninstall_url: 'https://hello.example.com/uninstall' } as AppManifest;

const row = (sequence: number, review_status: string, current = false): AppVersion => ({
  version: `1.0.${sequence}`,
  sequence,
  review_status,
  changelog: null,
  current,
  created_at: null,
});

const deployed = (version: string, review_status = 'development'): DeployResult => ({
  p_id: 'app_1',
  slug: 'hello',
  name: 'Hello',
  version,
  sequence: Number(version.split('.')[2]),
  review_status,
  status: 'created',
  unchanged: false,
});

function fakeApi(versions: AppVersion[], deploy: (...args: unknown[]) => Promise<DeployResult | ReviewRequired>) {
  const appVersions = vi.fn(async () => ({ versions }));
  const deployFn = vi.fn(deploy);
  return { api: { appVersions, deploy: deployFn } as unknown as Pick<DeveloperApi, 'deploy' | 'appVersions'>, appVersions, deploy: deployFn };
}

describe('latestDevelopmentVersion', () => {
  it('names the newest version only when it is a development build, whatever the list order', () => {
    expect(latestDevelopmentVersion([row(1, 'live', true), row(3, 'development'), row(2, 'rejected')])).toBe('1.0.3');
    expect(latestDevelopmentVersion([row(3, 'live', true), row(4, 'in_review')])).toBeNull();
    expect(latestDevelopmentVersion([row(2, 'development'), row(3, 'live', true)])).toBeNull();
    expect(latestDevelopmentVersion([row(3, 'rejected')])).toBeNull();
    // A development app's newest version is also its current one: still updated in place.
    expect(latestDevelopmentVersion([row(3, 'development', true)])).toBe('1.0.3');
    expect(latestDevelopmentVersion([])).toBeNull();
  });
});

describe('createDevDeployer (dev updates the latest development version in place)', () => {
  it('with no versions yet deploys unnamed, then updates what that deploy created in place', async () => {
    const { api, deploy, appVersions } = fakeApi([], async () => deployed('1.0.1'));
    const dev = createDevDeployer(api, () => {});
    await dev(MANIFEST);
    expect(deploy).toHaveBeenLastCalledWith(MANIFEST);
    await dev(MANIFEST);
    expect(deploy).toHaveBeenLastCalledWith(MANIFEST, { version: '1.0.1' });
    expect(appVersions).toHaveBeenCalledTimes(1);
  });

  it('a latest development version is deployed by name so the server updates it in place', async () => {
    const { api, deploy } = fakeApi([row(2, 'live', true), row(3, 'development')], async () => deployed('1.0.3'));
    await createDevDeployer(api, () => {})(MANIFEST);
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(deploy).toHaveBeenCalledWith(MANIFEST, { version: '1.0.3' });
  });

  it('a latest released version deploys unnamed (the server mints the next patch)', async () => {
    const { api, deploy } = fakeApi([row(1, 'development'), row(2, 'live', true)], async () => deployed('1.0.3'));
    await createDevDeployer(api, () => {})(MANIFEST);
    expect(deploy).toHaveBeenCalledWith(MANIFEST);
  });

  it('a latest version in review deploys unnamed', async () => {
    const { api, deploy } = fakeApi([row(1, 'live', true), row(2, 'in_review')], async () => deployed('1.0.3'));
    await createDevDeployer(api, () => {})(MANIFEST);
    expect(deploy).toHaveBeenCalledWith(MANIFEST);
  });

  it('a latest rejected version deploys unnamed', async () => {
    const { api, deploy } = fakeApi([row(1, 'live', true), row(2, 'rejected')], async () => deployed('1.0.3'));
    await createDevDeployer(api, () => {})(MANIFEST);
    expect(deploy).toHaveBeenCalledWith(MANIFEST);
  });

  it('an explicit manifest version wins and the versions list is never read', async () => {
    const { api, deploy, appVersions } = fakeApi([row(3, 'development')], async () => deployed('2.0.0'));
    const manifest = { ...MANIFEST, version: '2.0.0' } as AppManifest;
    await createDevDeployer(api, () => {})(manifest);
    expect(deploy).toHaveBeenCalledWith(manifest, { version: '2.0.0' });
    expect(appVersions).not.toHaveBeenCalled();
  });

  it('a frozen refusal falls back to one unnamed deploy, says so once, and carries on from the new version', async () => {
    let calls = 0;
    const { api, deploy } = fakeApi([row(3, 'development')], async (_manifest, options) => {
      calls += 1;
      if ((options as { version?: string } | undefined)?.version === '1.0.3') {
        throw new ApiError('Version 1.0.3 is under review and frozen.', 409, { error_type: 'version_frozen' });
      }
      return deployed('1.0.4');
    });
    const lines: string[] = [];
    const dev = createDevDeployer(api, (line) => lines.push(line));
    const first = await dev(MANIFEST);
    expect(first).toMatchObject({ version: '1.0.4' });
    expect(deploy).toHaveBeenNthCalledWith(1, MANIFEST, { version: '1.0.3' });
    expect(deploy).toHaveBeenNthCalledWith(2, MANIFEST);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('v1.0.3');
    await dev(MANIFEST);
    expect(deploy).toHaveBeenLastCalledWith(MANIFEST, { version: '1.0.4' });
    expect(calls).toBe(3);
    expect(lines).toHaveLength(1);
  });

  it('any other refusal of a named deploy rethrows untouched', async () => {
    const failure = new ApiError('Server error', 500, null);
    const { api, deploy } = fakeApi([row(3, 'development')], async () => {
      throw failure;
    });
    await expect(createDevDeployer(api, () => {})(MANIFEST)).rejects.toBe(failure);
    expect(deploy).toHaveBeenCalledTimes(1);
  });

  it('toml-save cycles reuse the last deploy result: one versions read per run', async () => {
    const { api, deploy, appVersions } = fakeApi([row(1, 'development')], async () => deployed('1.0.1'));
    const dev = createDevDeployer(api, () => {});
    await dev(MANIFEST);
    await dev(MANIFEST);
    await dev(MANIFEST);
    expect(appVersions).toHaveBeenCalledTimes(1);
    expect(deploy).toHaveBeenCalledTimes(3);
    for (const call of deploy.mock.calls) expect(call[1]).toEqual({ version: '1.0.1' });
  });

  it('a deploy that comes back released or gated is not edited in place next time', async () => {
    const results: Array<DeployResult | ReviewRequired> = [
      deployed('1.0.2', 'live'),
      { status: 'review_required', version: '1.0.3', sequence: 3, submission_url: null },
      deployed('1.0.4'),
    ];
    const { api, deploy } = fakeApi([row(1, 'development')], async () => results.shift() as DeployResult);
    const dev = createDevDeployer(api, () => {});
    await dev(MANIFEST);
    await dev(MANIFEST);
    await dev(MANIFEST);
    expect(deploy).toHaveBeenNthCalledWith(1, MANIFEST, { version: '1.0.1' });
    expect(deploy).toHaveBeenNthCalledWith(2, MANIFEST);
    expect(deploy).toHaveBeenNthCalledWith(3, MANIFEST);
  });
});

describe('isFrozenVersionRefusal', () => {
  it('reads the server wording and error codes, never an unrelated failure', () => {
    expect(isFrozenVersionRefusal(new ApiError('This version is under review.', 409, null))).toBe(true);
    expect(isFrozenVersionRefusal(new ApiError('Refused', 409, { error_type: 'version_frozen' }))).toBe(true);
    expect(isFrozenVersionRefusal(new ApiError('Validation failed', 422, null))).toBe(false);
    expect(isFrozenVersionRefusal(new Error('network down'))).toBe(false);
  });
});

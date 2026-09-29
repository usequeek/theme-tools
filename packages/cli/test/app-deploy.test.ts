import { afterEach, describe, expect, it } from 'vitest';
import { printSecretToStdout } from '../src/commands/app/deploy.js';

const savedTty = process.stdout.isTTY;
const savedToken = process.env.QUEEK_APP_AUTOMATION_TOKEN;

afterEach(() => {
  Object.defineProperty(process.stdout, 'isTTY', { value: savedTty, configurable: true });
  if (savedToken === undefined) delete process.env.QUEEK_APP_AUTOMATION_TOKEN;
  else process.env.QUEEK_APP_AUTOMATION_TOKEN = savedToken;
});

describe('deploy secret disclosure (shown-once never lands in CI logs)', () => {
  it('prints the secret only on an interactive terminal without an automation token', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    delete process.env.QUEEK_APP_AUTOMATION_TOKEN;
    expect(printSecretToStdout()).toBe(true);

    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    expect(printSecretToStdout()).toBe(false);

    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.env.QUEEK_APP_AUTOMATION_TOKEN = 'auto';
    expect(printSecretToStdout()).toBe(false);
  });
});

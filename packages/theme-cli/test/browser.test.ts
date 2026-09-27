import { describe, expect, it, vi } from 'vitest';
import { launchBrowser, type BrowserCandidate } from '../src/lib/browser.js';
import type { Browser } from 'playwright-core';

const NO_BROWSER = 'No browser found. Install Google Chrome, run `npx playwright install chromium`, or set QUEEK_THEME_BROWSER to a Chromium-based browser\'s path.';

function failing(name: string): BrowserCandidate {
  return { name, launch: () => Promise.reject(new Error(`${name} missing`)) };
}

describe('launchBrowser', () => {
  it('takes the first candidate that launches', async () => {
    const browser = { close: () => Promise.resolve() } as unknown as Browser;
    const skipped = vi.fn(() => Promise.reject(new Error('chrome missing')));
    const used = vi.fn(() => Promise.resolve(browser));
    const unreached = vi.fn(() => Promise.resolve(browser));
    const found = await launchBrowser([
      { name: 'QUEEK_THEME_BROWSER', launch: skipped },
      { name: 'chrome', launch: used },
      { name: 'msedge', launch: unreached },
    ]);
    expect(found).toBe(browser);
    expect(skipped).toHaveBeenCalledOnce();
    expect(used).toHaveBeenCalledOnce();
    expect(unreached).not.toHaveBeenCalled();
  });

  it('throws the exact no-browser error when every candidate fails', async () => {
    const error = await launchBrowser([failing('a'), failing('b')]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(NO_BROWSER);
    expect((error as Error & { code?: string }).code).toBe('NO_BROWSER');
  });
});

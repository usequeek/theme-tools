import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

/** One way to get a browser, tried in order until one launches. */
export interface BrowserCandidate {
  name: string;
  launch: () => Promise<Browser>;
}

/**
 * Where the screenshot browser comes from, first that works:
 * `QUEEK_THEME_BROWSER` (a Chromium-based executable), Google Chrome,
 * Microsoft Edge, then Playwright's own chromium (needs
 * `npx playwright install chromium` once). `playwright-core` is the
 * dependency on purpose — unlike `playwright` it downloads no browser on
 * install.
 */
export function browserCandidates(): BrowserCandidate[] {
  const candidates: BrowserCandidate[] = [];
  const executable = process.env.QUEEK_THEME_BROWSER;
  if (executable) candidates.push({ name: 'QUEEK_THEME_BROWSER', launch: () => chromium.launch({ executablePath: executable }) });
  candidates.push({ name: 'chrome', launch: () => chromium.launch({ channel: 'chrome' }) });
  candidates.push({ name: 'msedge', launch: () => chromium.launch({ channel: 'msedge' }) });
  candidates.push({ name: 'chromium', launch: () => chromium.launch() });
  return candidates;
}

/**
 * Launch the first candidate that works. The order is injectable so tests
 * can pass fakes without a browser installed.
 */
export async function launchBrowser(candidates: BrowserCandidate[] = browserCandidates()): Promise<Browser> {
  for (const candidate of candidates) {
    try {
      return await candidate.launch();
    } catch {
      // The next candidate may still work.
    }
  }
  throw Object.assign(
    new Error('No browser found. Install Google Chrome, run `npx playwright install chromium`, or set QUEEK_THEME_BROWSER to a Chromium-based browser\'s path.'),
    { code: 'NO_BROWSER' },
  );
}

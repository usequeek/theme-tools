import { spawn } from 'node:child_process';

/**
 * Open a URL in the person's browser (`queek login`'s OAuth approve step).
 * Uses the platform opener — no extra dependency, no headless guessing.
 */
export function openUrl(url: string): void {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const child = spawn(opener, [url], { detached: true, stdio: 'ignore' });
  child.unref();
}

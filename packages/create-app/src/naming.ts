/** `My App & Co.` → `my-app-co`: what the backend slug rule accepts, `^[a-z0-9][a-z0-9-]{1,63}$`. */
export function slugify(name: string): string {
  const slug = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, 64).replace(/-+$/, '');
}

/** Why a slug cannot be used, or null. */
export function slugProblem(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) {
    return `"${slug}" must be 2 to 64 characters: lower-case letters, digits or hyphens.`;
  }
  return null;
}

/** C0 controls and DEL: rejected in display names (TOML/JS strings forbid raw newlines). */
function hasControlChar(value: string): boolean {
  return [...value].some((ch) => {
    const code = ch.codePointAt(0) as number;
    return code <= 0x1f || code === 0x7f;
  });
}

/** Longest display name the scaffold supports (single line, fits titles and TOML). */
export const MAX_DISPLAY_NAME_LENGTH = 80;

/**
 * Why a display name cannot be used, or null. THE one place display names
 * are validated: `--name`, the prompt, and the sweep all call this.
 * Single-line names only — a newline would inject keys into TOML and break
 * markup — and no `{`, which opens an expression in the admin page markup.
 * `"` and `\` stay allowed: they are escaped per destination by the sweep.
 */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'The display name must not be empty.';
  if (Array.from(trimmed).length > MAX_DISPLAY_NAME_LENGTH) {
    return `The display name must be 1 to ${MAX_DISPLAY_NAME_LENGTH} characters, not ${Array.from(trimmed).length}.`;
  }
  if (hasControlChar(trimmed)) {
    return 'The display name must be a single line without control characters (no newlines or tabs).';
  }
  if (trimmed.includes('{')) {
    return 'The display name must not contain `{` (it breaks the admin page markup).';
  }
  return null;
}

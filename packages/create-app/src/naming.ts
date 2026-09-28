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

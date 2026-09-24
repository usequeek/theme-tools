/**
 * Image references inside a theme's `demo.json`.
 *
 * Three consumers must never disagree about what counts as an image: the
 * rehost command (what to upload and rewrite), `/api/theme-registry` (what to
 * publish as `variant_images`, and what to refuse to serve), and the CI
 * assertion that keeps foreign art out of the tree. They all read from here.
 *
 * Collection walks VALUES, not field names — 26 references in
 * `themes/default/demo.json` are bare elements of `products[].media.gallery`
 * with no field name at all. But a value walk alone over-collects: `url`
 * carries section art (342 of them) AND social links
 * (`https://instagram.com/theglowedit`), so every value is classified rather
 * than assumed to be an image.
 */

/** Hosts Queek serves its own media from. `R2_URL` extends this when set. */
const OWNED_IMAGE_HOSTS = new Set(['media.usequeek.com']);

/** The prefix rehosted theme art lives under, inside an owned host. */
export const THEME_ASSET_PREFIX = 'theme-assets/';

const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|avif|gif)$/i;

/** Image CDNs that serve extensionless URLs (Unsplash: `/photo-1441986…?w=`). */
const IMAGE_HOSTS = new Set([
  'images.unsplash.com',
  'plus.unsplash.com',
  'source.unsplash.com',
  'res.cloudinary.com',
  'cdn.shopify.com',
  'images.pexels.com',
]);

/** Hosts a demo links TO. Never fetched, never rewritten, never gated. */
const LINK_HOSTS = new Set([
  'instagram.com', 'www.instagram.com',
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com',
  'facebook.com', 'www.facebook.com',
  'tiktok.com', 'www.tiktok.com',
  'pinterest.com', 'www.pinterest.com',
  'linkedin.com', 'www.linkedin.com',
  'threads.net', 'www.threads.net',
  'snapchat.com', 't.me',
  'wa.me', 'api.whatsapp.com',
  'youtube.com', 'www.youtube.com', 'youtu.be',
  'vimeo.com', 'player.vimeo.com',
  'maps.google.com', 'maps.app.goo.gl', 'goo.gl',
]);

export type RefKind = 'image' | 'link' | 'unknown';

export interface DemoRef {
  value: string;
  kind: RefKind;
}

function ownedHosts(): Set<string> {
  const hosts = new Set(OWNED_IMAGE_HOSTS);
  const configured = process.env.R2_URL;
  if (configured) {
    try {
      hosts.add(new URL(configured).hostname.toLowerCase());
    } catch {
      // A malformed R2_URL is the rehost command's problem, not the gate's.
    }
  }
  return hosts;
}

/**
 * `null` for anything that is not a reference at all — prose, ids, markdown.
 * `unknown` is deliberate and load-bearing: a URL on a host we have not
 * classified is reported rather than silently treated as copy, so a new CDN
 * cannot slip past the rehost command unnoticed.
 */
export function classifyRef(value: unknown): RefKind | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (LINK_HOSTS.has(host)) return 'link';
    if (IMAGE_HOSTS.has(host) || IMAGE_EXTENSION.test(url.pathname)) return 'image';
    return 'unknown';
  }

  // A local file a theme builder dropped in the folder. Requires an extension,
  // so prose containing a slash is never mistaken for a path.
  if (/^\.{0,2}\//.test(trimmed) || /^[\w.-]+\//.test(trimmed)) {
    return IMAGE_EXTENSION.test(trimmed.split(/[?#]/)[0]) ? 'image' : null;
  }

  return null;
}

/** Every classified reference in `node`, in document order, duplicates kept. */
export function collectRefs(node: unknown): DemoRef[] {
  const found: DemoRef[] = [];

  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      const kind = classifyRef(value);
      if (kind) found.push({ value: value.trim(), kind });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };

  walk(node);
  return found;
}

/** Image references in document order. Duplicates kept — order is the contract. */
export function collectImageRefs(node: unknown): string[] {
  return collectRefs(node).filter((ref) => ref.kind === 'image').map((ref) => ref.value);
}

/** URLs on hosts we cannot classify. The rehost command warns on these. */
export function collectUnknownRefs(node: unknown): string[] {
  return [...new Set(collectRefs(node).filter((ref) => ref.kind === 'unknown').map((ref) => ref.value))];
}

/** True for an image already served from a Queek host under `theme-assets/`. */
export function isOwnedImageRef(ref: string): boolean {
  try {
    const url = new URL(ref);
    return ownedHosts().has(url.hostname.toLowerCase())
      && url.pathname.replace(/^\//, '').startsWith(THEME_ASSET_PREFIX);
  } catch {
    return false;
  }
}

/**
 * Image references that must not ship: a foreign host, or a local file that
 * exists only in a contributor's checkout.
 */
export function foreignImageRefs(node: unknown): string[] {
  return [...new Set(collectImageRefs(node).filter((ref) => !isOwnedImageRef(ref)))];
}

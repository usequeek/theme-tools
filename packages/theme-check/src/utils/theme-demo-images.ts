/**
 * Image references inside a theme's `demo.json`.
 *
 * Every consumer must agree on what counts as an image: the rehost step
 * (what to upload and rewrite), the registry (what to publish as
 * `variant_images`, and what to refuse to serve), and the check that keeps
 * foreign art out of a theme. They all read from here.
 *
 * Collection walks values with their field names — some references are bare
 * elements of `products[].media.gallery` with no field name at all, while
 * `url` carries section art AND social links
 * (`https://instagram.com/theglowedit`). Every value is classified rather
 * than assumed to be an image, and an extensionless remote URL counts as an
 * image only inside an image field on a host outside Queek's own media.
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

/**
 * A key holds image content when any of its words names one. Words split on
 * `_`, `-` and camelCase boundaries, matched case-insensitively, so
 * `hero_image`, `heroImage` and `product-photos` all match while `imagery`
 * (no exact word) does not.
 */
const IMAGE_FIELD_WORDS = new Set([
  'image', 'images', 'img',
  'photo', 'photos', 'picture',
  'thumbnail', 'thumb',
  'banner', 'avatar', 'cover', 'poster',
  'gallery', 'logo', 'favicon',
]);

function keyWords(key: string): string[] {
  return key
    .split(/[_-]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .map((word) => word.toLowerCase());
}

function isImageFieldKey(key: string): boolean {
  return keyWords(key).some((word) => IMAGE_FIELD_WORDS.has(word));
}

function isUrlOrSrcKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return lowered === 'url' || lowered === 'src';
}

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
 *
 * `inImageField` marks a value sitting in an image field (see `collectRefs`).
 * There, an extensionless remote URL on a host outside Queek's own media
 * reads as an image: without a field-name signal there is no telling art
 * from copy, but inside one the value was put there to be shown.
 */
export function classifyRef(value: unknown, inImageField = false): RefKind | null {
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
    if (inImageField && !ownedHosts().has(host)) return 'image';
    return 'unknown';
  }

  // A local file a theme builder dropped in the folder. Requires an extension,
  // so prose containing a slash is never mistaken for a path.
  if (/^\.{0,2}\//.test(trimmed) || /^[\w.-]+\//.test(trimmed)) {
    return IMAGE_EXTENSION.test(trimmed.split(/[?#]/)[0]) ? 'image' : null;
  }

  return null;
}

/**
 * Every classified reference in `node`, in document order, duplicates kept.
 *
 * The walk carries whether the value sits in an image field. An object entry
 * sets the flag from its own key, except `url`/`src`, which take it from the
 * key of the object (or array) holding them — `images: [{ url: … }]` counts,
 * a bare `url` does not. Arrays pass the flag through to their elements.
 */
export function collectRefs(node: unknown): DemoRef[] {
  const found: DemoRef[] = [];

  const walk = (value: unknown, inImageField: boolean, parentKey?: string): void => {
    if (typeof value === 'string') {
      const kind = classifyRef(value, inImageField);
      if (kind) found.push({ value: value.trim(), kind });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, inImageField, parentKey);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const childFlag = isUrlOrSrcKey(key)
          ? (parentKey !== undefined && isImageFieldKey(parentKey))
          : isImageFieldKey(key);
        walk(child, childFlag, key);
      }
    }
  };

  walk(node, false, undefined);
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

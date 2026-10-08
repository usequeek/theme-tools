import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyRef,
  collectImageRefs,
  collectRefs,
  collectUnknownRefs,
  foreignImageRefs,
} from '../src/utils/theme-demo-images.js';

/**
 * Extensionless remote URLs in image fields read as images, so the
 * foreign-art rule reports them like extension-bearing ones. Outside an
 * image field the classification is unchanged.
 */

const NEUTRAL = 'https://images.example.com/abc123';
const OWNED = 'https://media.usequeek.com/theme-assets/x/abc123';
const LINK = 'https://www.instagram.com/someone';

describe('classifyRef image-field rule', () => {
  let savedR2: string | undefined;
  let hadR2: boolean;

  beforeEach(() => {
    hadR2 = Object.hasOwn(process.env, 'R2_URL');
    savedR2 = process.env.R2_URL;
    delete process.env.R2_URL;
  });

  afterEach(() => {
    if (hadR2) process.env.R2_URL = savedR2;
    else delete process.env.R2_URL;
  });

  it('reads an extensionless foreign URL as an image inside an image field', () => {
    expect(classifyRef(NEUTRAL, true)).toBe('image');
  });

  it('keeps an extensionless foreign URL unknown outside an image field', () => {
    expect(classifyRef(NEUTRAL)).toBe('unknown');
    expect(classifyRef(NEUTRAL, false)).toBe('unknown');
  });

  it('keeps extension and known-host behaviour unchanged in both modes', () => {
    expect(classifyRef('https://images.example.com/a.jpg')).toBe('image');
    expect(classifyRef('https://images.example.com/a.jpg', true)).toBe('image');
    expect(classifyRef('https://images.unsplash.com/photo-123?w=80')).toBe('image');
    expect(classifyRef('https://images.unsplash.com/photo-123?w=80', true)).toBe('image');
    expect(classifyRef('https://www.instagram.com/someone')).toBe('link');
    expect(classifyRef('https://www.instagram.com/someone', true)).toBe('link');
  });

  it('keeps a Queek-hosted extensionless URL unknown even in an image field', () => {
    expect(classifyRef(OWNED, true)).toBe('unknown');
    expect(classifyRef(OWNED)).toBe('unknown');
  });

  it('keeps a link host a link even in an image field', () => {
    expect(classifyRef(LINK, true)).toBe('link');
  });
});

describe('collectRefs image-field context', () => {
  it('flags values under image keys, including camelCase, snake_case and kebab-case words', () => {
    expect(collectRefs({ image: NEUTRAL })[0]).toMatchObject({ value: NEUTRAL, kind: 'image' });
    expect(collectRefs({ heroImage: NEUTRAL })[0]).toMatchObject({ value: NEUTRAL, kind: 'image' });
    expect(collectRefs({ hero_image: NEUTRAL })[0]).toMatchObject({ value: NEUTRAL, kind: 'image' });
    expect(collectRefs({ 'product-photos': NEUTRAL })[0]).toMatchObject({ value: NEUTRAL, kind: 'image' });
  });

  it('leaves non-image keys unknown, even when they contain an image word as a substring', () => {
    expect(collectRefs({ video: NEUTRAL })[0]).toMatchObject({ value: NEUTRAL, kind: 'unknown' });
    expect(collectRefs({ cta_url: NEUTRAL })[0]).toMatchObject({ value: NEUTRAL, kind: 'unknown' });
    expect(collectRefs({ imagery: NEUTRAL })[0]).toMatchObject({ value: NEUTRAL, kind: 'unknown' });
  });

  it('treats arrays as transparent', () => {
    expect(collectRefs({ gallery: [NEUTRAL] })[0]).toMatchObject({ value: NEUTRAL, kind: 'image' });
    expect(collectRefs({ video: [NEUTRAL] })[0]).toMatchObject({ value: NEUTRAL, kind: 'unknown' });
  });

  it('reads url/src from the key holding their object', () => {
    expect(collectRefs({ images: [{ url: NEUTRAL }] })[0]).toMatchObject({ value: NEUTRAL, kind: 'image' });
    expect(collectRefs({ video: [{ url: NEUTRAL }] })[0]).toMatchObject({ value: NEUTRAL, kind: 'unknown' });
    expect(collectRefs({ url: NEUTRAL })[0]).toMatchObject({ value: NEUTRAL, kind: 'unknown' });
  });

  it('keeps document order and duplicates for images, and dedupes unknown refs', () => {
    const node = { image: NEUTRAL, gallery: [NEUTRAL], video: NEUTRAL };
    expect(collectImageRefs(node)).toEqual([NEUTRAL, NEUTRAL]);
    expect(collectUnknownRefs(node)).toEqual([NEUTRAL]);
  });
});

describe('foreignImageRefs with extensionless art', () => {
  it('lists extensionless foreign URLs from image fields', () => {
    expect(foreignImageRefs({ image: NEUTRAL })).toEqual([NEUTRAL]);
    expect(foreignImageRefs({ gallery: [NEUTRAL] })).toEqual([NEUTRAL]);
    expect(foreignImageRefs({ images: [{ url: NEUTRAL }] })).toEqual([NEUTRAL]);
  });

  it('ignores extensionless URLs outside image fields and Queek-hosted art', () => {
    expect(foreignImageRefs({ video: NEUTRAL })).toEqual([]);
    expect(foreignImageRefs({ cta_url: NEUTRAL })).toEqual([]);
    expect(foreignImageRefs({ image: OWNED })).toEqual([]);
  });
});

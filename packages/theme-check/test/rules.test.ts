import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUSINESS_KEYS, businessRoot, isBusinessKey, vocabularyViewOf } from '../src/utils/business-vocabulary.js';
import { demoStoresRule, fontsSelfHostedRule, frameworkImport, placeholderContentRule, sdkBoundaryRule, vendorFactsRule, templateBusinessRule, templateCopyRule, templateDescriptionRule, templateDesignsRule, templatePagesRule, templateVersionsRule, compositionVariantsRule } from '../src/rules/static.js';
import { copyViolations, manifestViolations } from '../src/utils/template-copy.js';
import { checkTheme } from '../src/run.js';
import type { DeclaredDemo, DemoStore, ThemeContext } from '../src/types.js';

/**
 * The template rules against hand-built contexts — each shown firing on the
 * fault it exists for, not only staying quiet on a healthy theme.
 */

function context(parts: Partial<Pick<ThemeContext, 'demos' | 'declaredDemos' | 'defaultDescription' | 'defaultFor' | 'themeDescription' | 'pageBased' | 'manifest' | 'themeConfig'>>): ThemeContext {
  const demos: DemoStore[] = parts.demos ?? [{ id: 'default', file: 'demo.json', data: { pages: {} } }];
  const declaredDemos = parts.declaredDemos ?? [];
  return {
    env: { root: 'theme/', docs: 'https://example.test/THEME.md', vocabulary: 'the vocabulary', scaffold: 'npm create @usequeek/theme', preview: (id) => `http://localhost:7833/${id}`, capture: (id) => id === 'default' ? 'npx queek theme screenshot' : `npx queek theme screenshot ${id}`, submission: false },
    slug: 'x',
    dir: '/nowhere/theme',
    retired: false,
    demo: demos[0]?.data ?? null,
    demos,
    themeConfig: parts.themeConfig ?? { default_demo: { for: parts.defaultFor ?? undefined, description: parts.defaultDescription ?? undefined }, demos: declaredDemos },
    declaredDemos,
    defaultDescription: parts.defaultDescription ?? null,
    defaultFor: parts.defaultFor ?? null,
    themeDescription: parts.themeDescription ?? null,
    manifest: parts.manifest ?? { slug: 'x', variants: {} },
    pageBased: parts.pageBased ?? true,
    file: (path) => `/nowhere/theme/${path}`,
    exists: () => false,
    read: () => null,
  };
}

describe('business vocabulary', () => {
  it('holds the service slugs and every catalogue root and branch, nothing else', () => {
    expect(isBusinessKey('foods')).toBe(true);
    expect(isBusinessKey('wigs-extensions-hair-accessories')).toBe(true);
    expect(isBusinessKey('jewellery')).toBe(false);
    expect(BUSINESS_KEYS.size).toBeGreaterThan(70);
    expect(businessRoot('shoes')).toBe('fashion');
  });

  it('holds jewelry (under bags-accessories) and the subcategory depth, spelled as the categories are', () => {
    expect(isBusinessKey('jewelry')).toBe(true);
    expect(isBusinessKey('android-phones')).toBe(true);
    expect(isBusinessKey('beverages')).toBe(false);
    expect(isBusinessKey('coffee')).toBe(false);
    expect(businessRoot('jewelry')).toBe('fashion');
  });
});

describe('theme/template-business order (R2.7)', () => {
  it('rejects a named business category behind a catalogue key; passes general and niche', async () => {
    const found = await templateBusinessRule.run(context({
      defaultFor: ['makeup', 'beauty-cosmetics'],
      declaredDemos: [{ id: 'hair', label: 'Hair', for: ['wigs-extensions-hair-accessories'] }, { id: 'food', label: 'Food', for: ['foods'] }],
    }));
    expect(found.map((f) => f.found)).toEqual(['template "default" names the business category "beauty-cosmetics" but leads with "makeup"']);
  });
});

describe('theme/template-copy', () => {
  const variants = {
    content: [
      { id: 'steps', fields: { heading: { type: 'string' }, items: { type: 'object[]', of: { title: { type: 'string' }, text: { type: 'text' } } } } },
      { id: 'testimonials', fields: { items: { type: 'object[]', of: { quote: { type: 'text' }, author: { type: 'string' } } } } },
    ],
  };
  const store = (sections: unknown[]): DemoStore => ({ id: 'food', file: 'demos/food.json', data: { profile: { name: 'Ata Kitchen' }, pages: { home: { content: sections } } } });

  it('rejects copy naming the store, a place, a naira amount or a promise', async () => {
    const found = await templateCopyRule.run(context({
      manifest: { slug: 'x', variants } as unknown as ThemeContext['manifest'],
      demos: [store([{ type: 'content', variant: 'steps', data: { heading: 'How Ata Kitchen cooks', items: [{ title: 'Grill', text: 'Free delivery in Yaba over ₦5,000.' }] } }])],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].where).toBe('theme/demos/food.json → pages.home.content[0] (content.steps)');
    expect(found[0].found).toContain('names the store ("Ata Kitchen")');
    expect(found[0].found).toContain('names a place (Yaba); states a naira amount; makes a promise ("Free delivery")');
  });

  it('passes generic copy and leaves testimonials alone', async () => {
    const found = await templateCopyRule.run(context({
      manifest: { slug: 'x', variants } as unknown as ThemeContext['manifest'],
      demos: [store([
        { type: 'content', variant: 'steps', data: { heading: 'How our kitchen cooks', items: [{ title: 'Grill', text: 'Over open fire.' }] } },
        { type: 'content', variant: 'testimonials', data: { items: [{ quote: 'Best suya in Yaba', author: 'Tolu' }] } },
      ])],
    }));
    expect(found).toEqual([]);
    expect(copyViolations('Sourdough fermented for 36 hours', null)).toEqual([]);
    expect(copyViolations('Cooked over open flame since 2014', null)).toEqual(['dates the store ("since 2014")']);
    expect(copyViolations('Email hello@zuri.ng to see what we hold.', null)).toEqual(['gives the store’s contact details ("hello@zuri.ng")']);
  });

  it('flags offer words — half-price, a bare sale, discount and coupon — but not wholesale, salesperson or for sale by the kilo', () => {
    for (const text of [
      'Half-Price Luxury', 'Half price Friday', 'Shop the sale', 'The clearance sale is on', 'Sale ends Sunday midnight',
      'Free shipping on orders over ₦200,000', 'Free delivery on orders over ₦15,000',
      'Bring the jar back for a refill at a discount', 'Clip the coupon below',
      'Complimentary delivery on every order', 'Free samples with every order', 'Free styling on every unit',
      'Made to measure in ten days', 'New drop every Friday, 7pm', 'Easy returns, always', 'One inbox, answered fast',
    ]) {
      expect(copyViolations(text, null), text).not.toEqual([]);
    }
    for (const text of [
      'Wholesale bags on request', 'Ask our salesperson for help', 'Beans sold for sale by the kilo',
      'Free-range eggs', 'Hands-free cooking', 'Ready to wear',
      'Always in season: tomatoes and peppers', 'Open the box on Friday', 'Tape measures and rulers',
    ]) {
      // BE30b: a named service ("Made to measure", "Alterations…") is a claim even without a window.
      expect(copyViolations(text, null), text).toEqual([]);
    }
  });

  it('rejects claims only the vendor can make — certifications, testing, free-from, diet and faith, eco, medical', () => {
    for (const text of [
      'Cruelty-Free || Paraben-Free || Dermatologist-Tested',
      'Cruelty-Free', 'Paraben-Free', 'Dermatologist-Tested',
      'certified by Leaping Bunny', 'Recyclable glass', '100% natural', 'Halal',
      'Gluten-free and sugar-free bakes', 'clinically proven', 'cures acne',
      'Fragrance-free', 'left unscented', 'ethically made',
    ]) {
      expect(copyViolations(text, null), text).not.toEqual([]);
      expect(copyViolations(text, null)[0], text).toMatch(/^claim only the vendor can make: "/);
    }
  });

  it('does not mistake ordinary words for claims', () => {
    for (const text of [
      'Sweet treats', 'manicure', 'Organise your wardrobe',
      'Cured in-house', 'high heels',
      'Every skin type welcome', 'Glass bottles you can refill',
      'scented candles', 'made to order',
    ]) {
      expect(copyViolations(text, null), text).toEqual([]);
    }
  });

  it('rejects schedules only the vendor can keep — response and delivery windows, weekday drops, daily freshness, 24/7', () => {
    for (const text of [
      'Delivery within the hour', 'We answer within the hour', 'We reply within the hour',
      'Same day', 'Next-day', 'Overnight delivery',
      'New shirts land every Friday', 'New In Every Friday', 'Fresh drops on Fridays',
      'Cooked fresh every morning', 'Market-fresh every morning', 'Cooked fresh daily',
      'Chapman and zobo are mixed every morning',
      'Coals lit every evening', 'Restocked every week', 'Baked daily', '24/7 Support',
    ]) {
      expect(copyViolations(text, null), text).toEqual(
        expect.arrayContaining([expect.stringMatching(/^promises a schedule: "/)]),
      );
    }
  });

  it('does not mistake usage advice or product purpose for a schedule', () => {
    for (const text of [
      'SPF every morning, rain or shine', 'Finish with SPF, every morning.',
      'Sunscreen as the last step of every morning',
      'Two drops every morning', 'Made to be worn every day',
      'Hoops, studs and chains made for daily wear',
      'The aisles you shop every week',
      'Vitamin C and hyaluronic serums for daily routines', 'The daily ritual',
      'Deep curls that return after every wash', 'Two burners for daily cooking',
      'Why SPF Every Day Matters',
      'Open the box on Friday', 'Sunday best',
    ]) {
      expect(copyViolations(text, null), text).toEqual([]);
    }
  });

  it('counts same-day and next-day only about delivery, dispatch or pickup — never twice', () => {
    expect(copyViolations('Bread baked the next day tastes better toasted', null)).toEqual([]);
    expect(copyViolations('Sealed the same day', null)).toEqual([]);
    for (const text of ['same-day delivery', 'next day dispatch', 'Delivered the same day', 'Same day', 'Next-day']) {
      expect(copyViolations(text, null), text).toHaveLength(1);
    }
    expect(copyViolations('Ships the same day', null)).toHaveLength(1);
    expect(copyViolations('Ships the same day', null)).toEqual([expect.stringMatching(/^makes a promise/)]);
  });

  // Ported from the storefront's tests/theme-templates.test.ts describe('template copy'):
  // its review of 24/9/26 ran these through the gate, and a pattern change
  // that breaks either list must fail here instead of in the storefront.
  it('finds places, naira amounts and promises; not the craft', () => {
    expect(copyViolations('Hot across Surulere and VI', null)).toEqual(['names places (VI, Surulere)']);
    expect(copyViolations('Free delivery over ₦25,000', null)).toEqual(['states a naira amount', 'makes a promise ("Free delivery")']);
    expect(copyViolations('Orders over N5,000 ship', null)).toEqual(['states a naira amount']);
    expect(copyViolations('Lagos orders arrive in 1–2 days', null)).toEqual(['names a place (Lagos)', 'makes a promise ("arrive in 1–2 days")']);
    for (const promise of ['Ships the same day', '30-day returns', 'Freshness Guaranteed', 'Delivery in 45 min', 'Resized free within 30 days']) {
      expect(copyViolations(promise, null), promise).toHaveLength(1);
    }
    for (const history of ['Cooked over open flame since 2014', 'We started in 2019 with one table', 'Est. 2016']) {
      expect(copyViolations(history, null), history).toEqual([expect.stringMatching(/^dates the store/)]);
    }
    expect(copyViolations('Email hello@zurijewellery.ng to see what we hold.', null)).toEqual(['gives the store’s contact details ("hello@zurijewellery.ng")']);
    expect(copyViolations('**Phone:** +234 800 100 2000', null)).toEqual(['gives the store’s contact details ("+234 800 100 2000")']);
    // Process, fabric, seasons and adjectives are not places, promises or history.
    expect(copyViolations('Spring / Summer 2026', null)).toEqual([]);
    for (const fine of ['Sourdough fermented for 36 hours', 'Ankara prints, cut to order', 'Nigerian kitchen classics', 'across the island', '2 minutes · 4 questions']) {
      expect(copyViolations(fine, 'Bloom Bakehouse'), fine).toEqual([]);
    }
  });

  // The review of 24/9/26 ran these through the gate: each list is what it must catch
  // and what it must leave alone. A pattern change that breaks either fails here.
  it.each([
    'Save 20% with code RAINS20', 'code ADAORA10 takes 10% off', 'Up to 25% off duos and trios',
    'Half-Price Luxury', 'Half price Friday', 'Shop the sale', 'The clearance sale is on', 'Sale ends Sunday midnight',
    'Free shipping on orders over ₦200,000', 'Free delivery on orders over ₦15,000',
    'Bring the jar back for a refill at a discount', 'Clip the coupon below',
    'Six years, two stores', 'Established in 2016', 'In 2014 we opened the kitchen',
    'Open daily from 11am', 'Doors open 11am to 10pm', 'Open early, from 6 AM', 'Weekdays 12–3pm',
    'Delivered in 2 hours', 'Ships in 24 hours', '24-hour delivery', '30-minute delivery', '1–2 day delivery',
    'Free doorstep delivery', 'We reply within a day',
    'Orders over N5000 ship', '5,000 naira minimum',
    'Call +234-803-123-4567', 'Call 0803 1234 567', 'wa.me/2348031234567',
    'Computer Village prices', 'Made in China',
    'Complimentary delivery on every order', 'Free samples with every order', 'Free styling on every unit',
    'Made to measure in ten days', 'New drop every Friday, 7pm', 'Easy returns, always', 'One inbox, answered fast',
  ])('flags %s', (text) => {
    expect(copyViolations(text, null)).not.toEqual([]);
  });

  it.each([
    'Cold brewed for 12–24 hours', 'Marinated 24-48 hours', 'Best eaten within 3 days', 'Noodles ready in 3 minutes',
    'Bread baked the next day tastes better toasted', 'Sealed the same day', 'Collection VI', 'New York cheesecake',
    'Dubai chocolate bar', 'London Dry gin', 'The Florence midi dress', 'Opened the 2026 season with linen',
    'Glow before *8am*', 'Trace your feet after 6pm', 'UK size 8',
    'Wholesale bags on request', 'Ask our salesperson for help', 'Beans sold for sale by the kilo',
    'Free-range eggs', 'Hands-free cooking', 'Ready to wear', 'Always in season: tomatoes and peppers',
    'Open the box on Friday', 'Tape measures and rulers',
  ])('leaves %s alone', (text) => {
    // BE30b: a named service ("Made to measure", "Alterations…") is a claim even without a window.
    expect(copyViolations(text, null)).toEqual([]);
  });

  it('leaves schedules in testimonials and reviews alone', async () => {
    const found = await templateCopyRule.run(context({
      manifest: { slug: 'x', variants } as unknown as ThemeContext['manifest'],
      demos: [store([
        { type: 'content', variant: 'testimonials', data: { items: [{ quote: 'Arrived same-day, repackaged beautifully', author: 'Tolu' }] } },
        { type: 'content', variant: 'steps', data: { heading: 'Fresh bread', items: [{ title: 'Morning', text: 'Baked daily at dawn.' }] } },
      ])],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].where).toBe('theme/demos/food.json → pages.home.content[1] (content.steps)');
    expect(found[0].found).toContain('promises a schedule: "Baked daily"');
    expect(found[0].fix).toContain('Name the section, not when the store does things');
  });

  it('reads a manifest’s purposes and field notes as template copy', async () => {
    const manifest = {
      slug: 'x',
      variants: {
        content: [
          {
            id: 'hero',
            purpose: 'A headline and sub line',
            fields: {
              sticker: 'string (words around the turning sticker, e.g. "Cruelty free")',
              tagline: 'string (short line, e.g. "New in")',
            },
          },
          {
            id: 'badges',
            purpose: 'A line icon, a serif title and one line each — materials, certification, a service.',
            fields: { title: { type: 'string', note: 'The badge title.' } },
          },
          {
            id: 'offer',
            purpose: 'A strip inviting shoppers to "save 15% today"',
            fields: {},
          },
        ],
        header: [
          {
            id: 'bar',
            purpose: 'A slim bar above the nav',
            fields: { text: { type: 'string', note: 'One line, e.g. "Same-day dispatch on every order".' } },
          },
        ],
        footer: [
          { id: 'columns', purpose: 'Link columns and the copyright bar', fields: { heading: 'string' } },
        ],
      },
    } as unknown as ThemeContext['manifest'];
    const found = await templateCopyRule.run(context({ manifest }));
    const where = found.map((f) => f.where);
    expect(where).toEqual([
      'theme/manifest.ts → content/hero → fields.sticker',
      'theme/manifest.ts → content/badges → purpose',
      'theme/manifest.ts → content/offer → purpose',
      'theme/manifest.ts → header/bar → fields.text',
    ]);
    expect(found[0].found).toContain('manifest example:');
    expect(found[0].found).toContain('claim only the vendor can make: "Cruelty free"');
    expect(found[1].found).toContain('claim only the vendor can make: "certification"');
    expect(found[2].found).toContain('states an offer ("save 15%")');
    expect(found[3].found).toContain('makes a promise ("Same-day dispatch")');
    expect(found[3].found).not.toContain('promises a schedule');
    for (const f of found) {
      expect(f.rule).toBe('theme/template-copy');
      expect(f.severity).toBe('reject');
      expect(f.fix).toContain('Name the section, not when the store does things');
    }
  });

  it('lets manifest prose describe the section; offers and promises count only in quoted examples', async () => {
    const prose = {
      slug: 'x',
      variants: {
        content: [
          { id: 'grid', purpose: 'Four cards across with the price and the strike-through on sale.', fields: {} },
          { id: 'badges', purpose: 'Icons in a row: delivery, returns, a guarantee, how it is made.', fields: {} },
          { id: 'code', purpose: 'A strip', fields: { code: { type: 'string', note: 'A discount code shown as a chip.' } } },
        ],
      },
    } as unknown as ThemeContext['manifest'];
    expect(await templateCopyRule.run(context({ manifest: prose }))).toEqual([]);
    const quoted = {
      slug: 'x',
      variants: {
        content: [
          { id: 'grid', purpose: 'Four cards across, e.g. "Sale ends Sunday".', fields: {} },
          { id: 'badges', purpose: 'Icons in a row, e.g. "Free delivery and a lifetime guarantee".', fields: {} },
          { id: 'code', purpose: 'A strip', fields: { code: { type: 'string', note: 'The chip, e.g. "20% off the set".' } } },
        ],
      },
    } as unknown as ThemeContext['manifest'];
    const found = await templateCopyRule.run(context({ manifest: quoted }));
    expect(found.map((f) => f.where)).toEqual([
      'theme/manifest.ts → content/grid → purpose',
      'theme/manifest.ts → content/badges → purpose',
      'theme/manifest.ts → content/code → fields.code',
    ]);
    expect(found[0].found).toContain('states an offer ("Sale")');
    expect(found[1].found).toContain('makes a promise ("Free delivery")');
    expect(found[2].found).toContain('states an offer ("20% off")');
  });

  it('flags claims and schedules anywhere in manifest text', () => {
    expect(manifestViolations('A line icon, a title and one line each — materials, certification, a service.')).toEqual([
      'claim only the vendor can make: "certification"',
    ]);
    expect(manifestViolations('Shelves restocked every week.')).toEqual([
      'promises a schedule: "restocked every week"',
    ]);
    // each finding once, even when the example repeats the prose
    expect(manifestViolations('Certified picks, e.g. "certified picks".')).toEqual([
      'claim only the vendor can make: "Certified"',
    ]);
  });

  it('names manifest findings under env.root, theme-relative', async () => {
    const manifest = {
      slug: 'x',
      variants: { content: [{ id: 'hero', purpose: 'Badges, certification and more', fields: {} }] },
    } as unknown as ThemeContext['manifest'];
    const ctx = context({ manifest });
    ctx.env.root = 'themes/carat/';
    const found = await templateCopyRule.run(ctx);
    expect(found).toHaveLength(1);
    expect(found[0].where).toBe('themes/carat/manifest.ts → content/hero → purpose');
    expect(found[0].where?.startsWith(`${ctx.env.root}manifest.ts →`)).toBe(true);
  });

  it('leaves claims in testimonials and reviews alone', async () => {
    const found = await templateCopyRule.run(context({
      manifest: { slug: 'x', variants } as unknown as ThemeContext['manifest'],
      demos: [store([
        { type: 'content', variant: 'testimonials', data: { items: [{ quote: 'Truly cruelty-free, my skin loves it', author: 'Tolu' }] } },
        { type: 'content', variant: 'steps', data: { heading: 'Our routine', items: [{ title: 'Cleanse', text: 'Cruelty-free, always.' }] } },
      ])],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].where).toBe('theme/demos/food.json → pages.home.content[1] (content.steps)');
    expect(found[0].found).toContain('claim only the vendor can make: "Cruelty-free"');
    expect(found[0].fix).toContain('Say what the section is, not what the product is certified or free from');
  });

  it('rejects the header announcement like section copy, whether the bar is enabled or not', async () => {
    const announced = (text: string, enabled: boolean): DemoStore => ({
      id: 'food', file: 'demos/food.json',
      data: { profile: { name: 'Ata Kitchen' }, config: { header: { announcement: { enabled, text } } }, pages: { home: { content: [] } } },
    });
    const withManifest = (demos: DemoStore[]): Parameters<typeof templateCopyRule.run>[0] =>
      context({ manifest: { slug: 'x', variants } as unknown as ThemeContext['manifest'], demos });
    const enabled = await templateCopyRule.run(withManifest([announced('Free shipping on orders over ₦5,000', true)]));
    expect(enabled).toHaveLength(1);
    expect(enabled[0].where).toBe('theme/demos/food.json → config.header.announcement.text');
    expect(enabled[0].found).toContain('states a naira amount');
    const disabled = await templateCopyRule.run(withManifest([announced('Free shipping on orders over ₦5,000', false)]));
    expect(disabled).toHaveLength(1);
    expect(disabled[0].where).toBe('theme/demos/food.json → config.header.announcement.text');
    expect(await templateCopyRule.run(withManifest([announced('New arrivals are in', true)]))).toEqual([]);
  });

  it('rejects production claims — how the store makes things (BE30)', () => {
    for (const text of [
      'Every jar is filled by hand in our studio',
      'Made in small batches', 'Small-batch roasting',
      'We test every shade on deep skin first', 'Tested on real skin',
      'Hand-poured candles', 'Hand-stitched leather',
      'Sewn in our own workshop', 'Blended in our lab',
    ]) {
      expect(copyViolations(text, null), text).toEqual(
        expect.arrayContaining([expect.stringMatching(/^claim only the vendor can make: "/)]),
      );
    }
    expect(copyViolations('Handmade in Lagos', null)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^claim only the vendor can make: "/)]),
    );
    expect(copyViolations('Baked in our kitchen every morning', null)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^claim only the vendor can make: "/)]),
    );
  });

  it('does not mistake products and use for production claims (BE30)', () => {
    for (const text of [
      'Hand cream and body lotion', 'Handbags and wallets', 'Second-hand phones', 'Hands-free cooking',
      'Studio lighting kits', 'Kitchen tools and pans', 'Lab coats and scrubs', 'Workshop tools',
      'Our kitchen classics',
    ]) {
      expect(copyViolations(text, null), text).toEqual([]);
    }
  });

  it('rejects turnarounds — how fast the store promises things (BE30)', () => {
    for (const text of [
      'One fitting, ten days', 'Ready in 3 days',
      'Made to order in two weeks',
      'Alterations take five days', 'Two-week turnaround',
    ]) {
      expect(copyViolations(text, null), text).toEqual(
        expect.arrayContaining([expect.stringMatching(/^promises a schedule: "/)]),
      );
    }
    // already reported through the promise category: flagged, never twice
    for (const text of ['Delivered within 2–4 working days', 'Dispatched in 48 hours']) {
      expect(copyViolations(text, null), text).toHaveLength(1);
    }
  });

  it('does not mistake process durations and product facts for turnarounds (BE30)', () => {
    for (const text of [
      'Sourdough fermented for 36 hours', 'Dry-aged for 28 days', 'Aged 30 days in oak',
      'Steeped for two weeks', 'Marinated for 24 hours', 'The 30-day skin plan',
      'A week of looks',
    ]) {
      expect(copyViolations(text, null), text).toEqual([]);
    }
  });

  it('rejects named services — bookings, consultations, bespoke, made to measure, fittings, alterations, in-house making (BE30b)', () => {
    for (const text of [
      'Book a fitting', 'Book a *fitting*',
      'Book an appointment', 'Book An *Appointment*', 'Sunday by appointment',
      'Open for walk-ins and appointments', 'Private appointments to try the capsule',
      'Book a facial', 'Book a consult', 'Book a custom unit',
      'Start a consultation', 'Request a wardrobe consultation', 'Fit consultation',
      'Explore bespoke', 'Bespoke Orders',
      'Made to measure', 'Made-to-measure in-house', 'Cut to measure', 'to measure and off the rail',
      'Every bridal and aso-ebi order gets two fittings at our atelier', 'First fitting',
      'Sizing, orders, alterations — ask anything', 'Alterations on every trouser',
      'Ask us which alterations suit each piece',
      'Fitted in-house', 'Cut *in-house*', 'Blended in-house, bottled in small runs',
      'Dew, bottled *in-house*', 'our in-house team', 'cut and styled in-house by our stylists',
      'Real wax prints tailored in-house',
      // wider than the audit's own lines: other articles, one adjective, bare bespoke, made in-house
      'Book your fitting', 'Book an install', 'Try pieces on, or book a bespoke consultation',
      'After something *Bespoke*?', 'Made in-house', 'Every jacket gets two fittings',
      // emphasis asterisks inside a phrase: every pattern reads the words without them
      'Built by *hand*',
    ]) {
      expect(copyViolations(text, null), text).toEqual(
        expect.arrayContaining([expect.stringMatching(/^claim only the vendor can make: "/)]),
      );
    }
    // free or on-the-house services read through the promise, which already owns "free alterations"
    for (const text of ['Off the peg, altered free', 'Every trouser is hemmed free']) {
      expect(copyViolations(text, null), text).toEqual(
        expect.arrayContaining([expect.stringMatching(/^makes a promise/)]),
      );
    }
  });

  it('rejects restock days and working-day turnarounds (BE30b)', () => {
    for (const text of [
      'New sets added weekly', 'Restocked every Friday', 'Retros return *Friday*',
      'Ten working days, pressed and bagged', 'Units made to your head size in 5 working days',
      'Feasts need two hours notice',
    ]) {
      expect(copyViolations(text, null), text).toEqual(
        expect.arrayContaining([expect.stringMatching(/^promises a schedule: "/)]),
      );
    }
  });

  it('does not mistake hardware, products, verbs and ordinary words for services (BE30b)', () => {
    for (const text of [
      'Solid brass fittings', 'Light fittings and fixtures', 'Pipe fittings and valves',
      'Fitted sheets and pillowcases', 'A close-fitting knit',
      'How to measure your size', 'Tape measures and rulers', 'Measuring cups and spoons',
      'Consult the size guide', 'Consult a pharmacist before use',
      'Appointment diaries and planners', 'Houseplants and pots', 'Home and house goods',
      'Hemming tape and sewing kits',
      'Friday night outfits', 'Weekend bags', 'Deep curls that return after every wash',
      'Book club picks', 'Books and stationery', 'Book a *table*',
      'Ready to wear',
    ]) {
      expect(copyViolations(text, null), text).toEqual([]);
    }
  });

  it('reports an on-the-house fitting once, and a measured turnaround once (BE30b)', () => {
    expect(copyViolations('A fitting, *on the house*', null)).toHaveLength(1);
    expect(copyViolations('Made to measure in ten days', null)).toHaveLength(1);
  });
});

describe('theme/template-description', () => {
  it('rejects a missing description, one over 300 characters, and the scaffold placeholder', async () => {
    const found = await templateDescriptionRule.run(context({
      defaultDescription: null,
      declaredDemos: [
        { id: 'long', label: 'L', for: ['foods'], description: 'x'.repeat(301) },
        { id: 'stub', label: 'S', for: ['foods'], description: 'Replace before publishing. Any shop.' },
      ],
    }));
    expect(found.map((f) => f.found)).toEqual([
      'template "default" has no description',
      'template "long" description is 301 chars (max 300)',
      'template "stub" description is still the scaffold\'s placeholder',
    ]);
    expect(found[0].where).toBe('theme/theme.config.ts → default_demo.description');
    expect(found[0].docs).toBe('https://example.test/THEME.md#templates');
  });
});

describe('theme/template-business', () => {
  it('rejects a primary without a business, and keys outside the vocabulary', async () => {
    expect((await templateBusinessRule.run(context({ defaultFor: null }))).map((f) => f.found)).toEqual(['the primary template names no business']);
    const found = await templateBusinessRule.run(context({ defaultFor: ['skincare', 'jewellery'] }));
    expect(found.map((f) => f.found)).toEqual(['template "default" is for "jewellery", not in the business vocabulary']);
    expect(found[0].fix).toContain('the vocabulary');
  });
});

const home = (...slots: string[]) => ({ pages: { home: { content: slots.map((slot) => ({ type: slot.split('/')[0], variant: slot.split('/')[1] })) } } });

describe('theme/template-versions', () => {
  it("rejects two designs with the same home, and no longer reads an id's -2 (R2.8: theme/template-designs groups)", async () => {
    const found = await templateVersionsRule.run(context({
      demos: [
        { id: 'default', file: 'demo.json', data: home('gallery/slider', 'products/grid') },
        { id: 'food', file: 'demos/food.json', data: home('gallery/slider', 'products/menu') },
        { id: 'food-2', file: 'demos/food-2.json', data: home('gallery/slider', 'products/grid') },
      ],
      declaredDemos: [{ id: 'food', template: 'food', label: 'F', for: ['foods'] }, { id: 'food-2', template: 'food', label: 'F2', for: ['foods'] }],
    }));
    expect(found.map((f) => f.found)).toEqual([
      'design "food-2" has the same home sections, in the same order, as "default"',
    ]);
  });
});

/* ── R2.8: theme → template → design ─────────────────────────────────── */

type Design = Record<string, unknown>;
/** Medley-shaped (contract R2.8): a main template and a two-design Food template. */
const MAIN: Design = { template: 'beauty', label: 'Skincare & make-up', design_label: 'Photo collage', for: ['beauty-cosmetics', 'makeup'] };
const FOOD: Design = { id: 'food', template: 'food', label: 'Restaurant & kitchen', design_label: 'Dining room', for: ['foods'] };
const FOOD_2: Design = { id: 'food-2', template: 'food', design_label: 'Neighbourhood buka' };

/** A context declaring these designs, each with its own store on disk named `names[id]` (default "Ata Kitchen"). */
function declaring(main: Design, demos: Design[], names: Record<string, string> = {}): ThemeContext {
  const store = (id: string, file: string): DemoStore => ({ id, file, data: { profile: { name: names[id] ?? 'Ata Kitchen' } } });
  return context({
    themeConfig: { name: 'Medley', default_demo: main, demos },
    declaredDemos: demos as unknown as DeclaredDemo[],
    defaultFor: main.for ?? null,
    demos: [store('default', 'demo.json'), ...demos.map((demo) => store(String(demo.id), `demos/${String(demo.id)}.json`))],
  });
}
const designFindings = async (main: Design, demos: Design[], names?: Record<string, string>): Promise<string[]> =>
  (await templateDesignsRule.run(declaring(main, demos, names))).map((f) => f.found);
const without = (design: Design, key: string): Design => Object.fromEntries(Object.entries(design).filter(([name]) => name !== key));

describe('theme/template-designs', () => {
  it('passes a medley-shaped theme, whose later design leaves out label and for', async () => {
    expect(await designFindings(MAIN, [FOOD, FOOD_2])).toEqual([]);
  });

  it("passes a later design that repeats its template's label and for unchanged (Queek's themes today)", async () => {
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, label: FOOD.label, for: FOOD.for }])).toEqual([]);
  });

  it('passes a one-design template without a design_label', async () => {
    expect(await designFindings(without(MAIN, 'design_label'), [{ id: 'hair', template: 'hair', label: 'Wigs & hair', for: ['wigs-extensions-hair-accessories'] }])).toEqual([]);
  });

  it('rejects a main template with no key', async () => {
    const found = await templateDesignsRule.run(declaring(without(MAIN, 'template'), [FOOD, FOOD_2]));
    expect(found.map((f) => f.found)).toEqual(['the main template has no key (default_demo.template)']);
    expect(found[0]).toMatchObject({ rule: 'theme/template-designs', severity: 'reject', where: 'theme/theme.config.ts → default_demo.template', docs: 'https://example.test/THEME.md#templates' });
  });

  it('rejects a design that names no template', async () => {
    const found = await templateDesignsRule.run(declaring(MAIN, [without(FOOD, 'template'), FOOD_2]));
    expect(found.map((f) => f.found)).toEqual(['design "food" names no template']);
    expect(found[0].where).toBe('theme/theme.config.ts → demos[food].template');
  });

  it('rejects a template key that is not a slug, or is "default"', async () => {
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, template: 'Food' }])).toEqual(['template key "Food" is not a slug']);
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, template: 'default' }])).toEqual(['template key "default" is reserved']);
    expect(await designFindings({ ...MAIN, template: 'default' }, [FOOD, FOOD_2])).toEqual(['template key "default" is reserved']);
  });

  it('rejects a main template key that is also a design id: keys and ids share one namespace', async () => {
    const main = { ...MAIN, template: 'clothes', label: 'Clothing & menswear', for: ['fashion'] };
    expect(await designFindings(main, [{ id: 'clothes', template: 'clothes', design_label: 'Tailoring house' }])).toEqual([
      'the main template\'s key "clothes" is also a design id',
    ]);
  });

  it('rejects a template with no design 1 (no design whose id is its key)', async () => {
    expect(await designFindings(MAIN, [FOOD_2])).toEqual(['template "food" has no design 1 (a design whose id is "food")']);
  });

  it("rejects a later design for another business than its template's", async () => {
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, for: ['groceries'] }])).toEqual([
      'design "food-2" is for ["groceries"], its template "food" for ["foods"]',
    ]);
  });

  it('rejects a later design that relabels its template (a legacy composite label)', async () => {
    const found = await templateDesignsRule.run(declaring(MAIN, [FOOD, { ...FOOD_2, label: 'Restaurant & kitchen — neighbourhood buka' }]));
    expect(found.map((f) => f.found)).toEqual([
      'design "food-2" relabels its template ("Restaurant & kitchen — neighbourhood buka"); a design is named by design_label',
    ]);
    expect(found[0].where).toBe('theme/theme.config.ts → demos[food-2].label');
  });

  it('rejects a design of a 2+ design template with no design_label', async () => {
    expect(await designFindings(MAIN, [FOOD, without(FOOD_2, 'design_label')])).toEqual(['design "food-2" has no design_label (template "food" has 2 designs)']);
  });

  it('rejects two designs of a template with one design_label', async () => {
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, design_label: 'Dining room' }])).toEqual([
      'designs "food" and "food-2" share the design_label "Dining room"',
    ]);
  });

  it('rejects a design_label that is not true of any store (R2.6 copy rules)', async () => {
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, design_label: 'Lekki kitchen' }])).toEqual(['design "food-2" design_label: names a place (Lekki)']);
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, design_label: "Mama Tee's buka" }], { 'food-2': "Mama Tee's" })).toEqual([
      'design "food-2" design_label: names the store ("Mama Tee\'s")',
    ]);
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, design_label: '₦5,000 trays' }])).toEqual(['design "food-2" design_label: states a naira amount']);
  });

  it('rejects a 4th design of one template (R2.2 allows three)', async () => {
    const third: Design = { id: 'food-3', template: 'food', design_label: 'Grill house' };
    const found = await templateDesignsRule.run(declaring(MAIN, [FOOD, FOOD_2, third, { id: 'food-4', template: 'food', design_label: 'Night market' }]));
    expect(found.map((f) => f.found)).toEqual(['template "food" has 4 designs; a template has at most 3']);
    expect(found[0].where).toBe('theme/theme.config.ts → demos[food-4].template');
    expect(await designFindings(MAIN, [FOOD, FOOD_2, third])).toEqual([]);
  });

  it('exempts a retired theme', async () => {
    expect(await templateDesignsRule.run({ ...declaring(without(MAIN, 'template'), [FOOD_2]), retired: true })).toEqual([]);
  });
});

describe('theme/demo-stores (R2.8)', () => {
  it("asks label and for of a template's design 1 only; a later design inherits them", async () => {
    const found = await demoStoresRule.run(declaring(MAIN, [without(FOOD, 'label'), FOOD_2]));
    expect(found.map((f) => f.found)).toEqual(['demos[] "food" has no label']);
  });

  it('shows the whole declaration, template included, for an undeclared file', async () => {
    const ctx = declaring(MAIN, [FOOD]);
    const found = await demoStoresRule.run({ ...ctx, demos: [...ctx.demos, { id: 'food-2', file: 'demos/food-2.json', data: {} }] });
    expect(found.map((f) => f.fix)).toEqual([expect.stringContaining("`{ id: 'food-2', template, label, for, description }`")]);
  });
});

describe('theme/template-business (R2.8)', () => {
  it("checks each template's for once, by its design 1", async () => {
    const found = await templateBusinessRule.run(declaring(MAIN, [{ ...FOOD, for: ['jewellery'] }, { ...FOOD_2, for: ['jewellery'] }]));
    expect(found.map((f) => [f.found, f.where])).toEqual([
      ['template "food" is for "jewellery", not in the business vocabulary', 'theme/theme.config.ts → demos[food].for'],
    ]);
  });
});

describe('theme/template-business shop advisory (R2.9)', () => {
  it('warns, never rejects, when a template names only shop; a specific for is quiet', async () => {
    const warned = await templateBusinessRule.run(context({ defaultFor: ['shop'] }));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ rule: 'theme/template-business', severity: 'warn' });
    expect(warned[0].found).toBe('template "default" is for only "shop"');
    expect(warned[0].fix).toContain('"shop" is for a general store only');
    expect(await templateBusinessRule.run(context({ defaultFor: ['laundry'] }))).toEqual([]);
    expect(await templateBusinessRule.run(context({ defaultFor: ['shop', 'groceries'] }))).toEqual([]);
  });

  it("warns once per shop-only template, by its design 1", async () => {
    const found = await templateBusinessRule.run(declaring(MAIN, [{ ...FOOD, for: ['shop'] }, FOOD_2]));
    expect(found.map((f) => [f.severity, f.found, f.where])).toEqual([
      ['warn', 'template "food" is for only "shop"', 'theme/theme.config.ts → demos[food].for'],
    ]);
  });

  it('reads the vocabulary from the context, not the bundled import', async () => {
    const found = await templateBusinessRule.run({
      ...context({ defaultFor: ['shop'] }),
      vocabulary: vocabularyViewOf({ services: ['laundry'], catalogue: {}, subcategories: {} }),
    });
    expect(found.map((f) => f.found)).toEqual(['template "default" is for "shop", not in the business vocabulary']);
  });
});

describe('theme/composition-variants (BE19)', () => {
  const manifest = { slug: 'x', variants: { gallery: [{ id: 'mosaic' }, { id: 'slider' }], products: [{ id: 'grid' }] } } as unknown as ThemeContext['manifest'];
  const store = (id: string, file: string, content: unknown): DemoStore => ({ id, file, data: { pages: { home: { content } } } });

  it('rejects a section naming a variant the theme does not implement, in every design', async () => {
    const found = await compositionVariantsRule.run(context({
      manifest,
      demos: [
        store('default', 'demo.json', [{ type: 'gallery', variant: 'mosaic' }, { type: 'gallery', variant: 'grid' }]),
        store('blog-shop', 'demos/blog-shop.json', [{ type: 'gallery', variant: 'grid' }]),
      ],
    }));
    expect(found.map((f) => [f.severity, f.found, f.where])).toEqual([
      ['reject', 'gallery/grid', 'theme/demo.json → pages.home[1]'],
      ['reject', 'gallery/grid', 'theme/demos/blog-shop.json → pages.home[0]'],
    ]);
    expect(found[0].fix).toContain('mosaic');
    expect(found[0].fix).toContain('slider');
    expect(found[0]).toMatchObject({ rule: 'theme/composition-variants' });
  });

  it('passes implemented variants, and ignores sections with no variant or a type with no declared variants', async () => {
    const found = await compositionVariantsRule.run(context({
      manifest,
      demos: [store('default', 'demo.json', [
        { type: 'gallery', variant: 'slider' },
        { type: 'products', variant: 'grid' },
        { type: 'gallery' },
        { type: 'gallery', variant: null },
        { type: 'divider', variant: 'anything' },
      ])],
    }));
    expect(found).toEqual([]);
  });

  it('skips a retired theme or an unloadable manifest', async () => {
    const bad = context({
      manifest,
      demos: [store('default', 'demo.json', [{ type: 'gallery', variant: 'grid' }])],
    });
    expect(await compositionVariantsRule.run({ ...bad, retired: true })).toEqual([]);
    expect(await compositionVariantsRule.run({ ...bad, manifest: null })).toEqual([]);
  });
});

describe('theme/template-pages', () => {
  it('rejects a template missing about, sales or landing; exempts a one-page theme', async () => {
    const found = await templatePagesRule.run(context({ demos: [{ id: 'default', file: 'demo.json', data: { pages: { home: { content: [] } } } }] }));
    expect(found.map((f) => f.found)).toEqual([
      'template "default" has no `about` page',
      'template "default" has no `sales` page',
      'template "default" has no `landing` page',
    ]);
    expect(await templatePagesRule.run(context({ pageBased: false, demos: [{ id: 'default', file: 'demo.json', data: { pages: {} } }] }))).toEqual([]);
  });
});

describe('theme/vendor-facts', () => {
  it("rejects a vendor fact with a worded fallback, allows an empty one", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vendor-facts-'));
    writeFileSync(join(dir, 'footer.tsx'), "<span>{vendor.address ?? 'Lagos, Nigeria'}</span>");
    const found = await vendorFactsRule.run({ ...context({}), dir });
    expect(found.map((f) => f.found)).toEqual(['vendor.address falls back to "Lagos, Nigeria"']);
    writeFileSync(join(dir, 'footer.tsx'), "<span>{vendor.address ?? ''}</span>");
    expect(await vendorFactsRule.run({ ...context({}), dir })).toEqual([]);
  });
});

describe('theme/placeholder-content', () => {
  const store = (products: Array<{ slug: string; media?: unknown }>): DemoStore => ({ id: 'default', file: 'demo.json', data: { profile: { id: 'demo-x' }, products, pages: {} } });

  it("rejects the starter's placeholder products and photos", async () => {
    const found = await placeholderContentRule.run(context({ demos: [store([
      { slug: 'placeholder-one', media: { image: 'https://media.usequeek.com/theme-assets/_bare/0c8749c67b449815.jpg' } },
      { slug: 'real-dress' },
    ])] }));
    expect(found).toHaveLength(1);
    expect(found[0].found).toBe("1 placeholder product(s) and 1 of the starter's photos");
  });

  it("passes a store with the developer's own products", async () => {
    expect(await placeholderContentRule.run(context({ demos: [store([{ slug: 'real-dress', media: { image: 'https://example.test/dress.jpg' } }])] }))).toEqual([]);
  });

  it("rejects a theme description that is still the starter's placeholder", async () => {
    const found = await placeholderContentRule.run(context({ demos: [store([{ slug: 'real-dress' }])], themeDescription: 'Replace before publishing. What this theme is, in one sentence.' }));
    expect(found.map((f) => [f.where, f.found, f.severity])).toEqual([
      ['theme/theme.config.ts → description', "the theme's description is still the starter's placeholder", 'reject'],
    ]);
    expect(found[0].docs).toBe('https://example.test/THEME.md#placeholder-content');
  });

  it("passes the theme's own description, the skeleton's included", async () => {
    for (const themeDescription of ['A dark, photo-led theme for restaurants.', 'The starting skeleton for a new theme — the contract with no design opinions. Never published.', null]) {
      expect(await placeholderContentRule.run(context({ demos: [store([{ slug: 'real-dress' }])], themeDescription }))).toEqual([]);
    }
  });

  it("passes a store using lumiere's original photos", async () => {
    expect(await placeholderContentRule.run(context({ demos: [store([{ slug: 'real-dress', media: { image: 'https://media.usequeek.com/theme-assets/lumiere/0c8749c67b449815.jpg' } }])] }))).toEqual([]);
  });
});

describe('theme/core-boundary: the framework stays behind the kit', () => {
  it('finds every way a theme can import Next', () => {
    expect(frameworkImport("import Link from 'next/link';")).toBe('next/link');
    expect(frameworkImport('import { useRouter } from "next/navigation";')).toBe('next/navigation');
    expect(frameworkImport("import Image from 'next/image';")).toBe('next/image');
    expect(frameworkImport("import { headers } from 'next/headers';")).toBe('next/headers');
    expect(frameworkImport("import type { Metadata } from 'next';")).toBe('next');
    expect(frameworkImport("import 'next/font';")).toBe('next/font');
    expect(frameworkImport("const Map = dynamic(() => import('next/dynamic'));")).toBe('next/dynamic');
    expect(frameworkImport("const link = require('next/link');")).toBe('next/link');
  });

  it("leaves the kit's navigation and look-alike packages alone", () => {
    expect(frameworkImport("import { Link, useRouter } from '@usequeek/theme-kit/navigation';")).toBeNull();
    expect(frameworkImport("import { useTranslations } from 'next-intl';")).toBeNull();
    expect(frameworkImport("import x from './next/link';")).toBeNull();
    expect(frameworkImport('// the next step is the cart')).toBeNull();
  });

  it('rejects a theme file that imports next/link, naming the file and the fix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'boundary-'));
    writeFileSync(join(dir, 'header.tsx'), "'use client';\nimport Link from 'next/link';\nexport const Header = () => <Link href=\"/\">Home</Link>;\n");
    writeFileSync(join(dir, 'footer.tsx'), "import { Link } from '@usequeek/theme-kit/navigation';\nexport const Footer = () => <Link href=\"/\">Home</Link>;\n");

    const findings = await sdkBoundaryRule.run({ ...context({}), dir });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'theme/core-boundary', severity: 'reject', where: 'header.tsx' });
    expect(findings[0].found).toContain("'next/link'");
    expect(findings[0].fix).toContain('@usequeek/theme-kit/navigation');
  });

  it("rejects an `@/` app-code import in every module form, even in .mjs", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'boundary-alias-'));
    writeFileSync(join(dir, 'a.ts'), "import { useClientState } from '@/lib/storefront/hooks/use-client-state';\n");
    writeFileSync(join(dir, 'b.ts'), "export { useClientState } from '@/lib/storefront/hooks/use-client-state';\n");
    writeFileSync(join(dir, 'c.ts'), "const mod = await import('@/lib/storefront/hooks/use-client-state');\n");
    writeFileSync(join(dir, 'd.ts'), "const mod = require('@/lib/storefront/hooks/use-client-state');\n");
    writeFileSync(join(dir, 'e.mjs'), "import '@/lib/storefront/hooks/use-client-state';\n");

    const findings = await sdkBoundaryRule.run({ ...context({}), dir });

    expect(findings).toHaveLength(5);
    for (const finding of findings) {
      expect(finding).toMatchObject({ rule: 'theme/core-boundary', severity: 'reject' });
      expect(finding.found).toContain('@/lib/storefront/hooks/use-client-state');
      expect(finding.fix).toContain('@usequeek/theme-kit');
    }
    expect(findings.map((f) => f.where).sort()).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.mjs']);
  });

  it('rejects a relative import that escapes the theme, naming where it lands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'boundary-escape-'));
    mkdirSync(join(dir, 'blocks'), { recursive: true });
    writeFileSync(join(dir, 'blocks', 'card.tsx'), "import { helper } from '../../lib/x';\n");

    const findings = await sdkBoundaryRule.run({ ...context({}), dir });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'theme/core-boundary', severity: 'reject', where: 'blocks/card.tsx' });
    expect(findings[0].found).toContain("'../../lib/x'");
    expect(findings[0].found).toContain('../lib/x');
    expect(findings[0].fix).toContain('@usequeek/theme-kit');
  });

  it('passes in-theme relatives, the kit, react, and other scoped packages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'boundary-clean-'));
    mkdirSync(join(dir, 'blocks'), { recursive: true });
    mkdirSync(join(dir, 'components'), { recursive: true });
    writeFileSync(join(dir, 'components', 'x.tsx'), 'export const X = () => null;\n');
    writeFileSync(join(dir, 'blocks', 'card.tsx'), "import { X } from '../components/x';\n");
    writeFileSync(join(dir, 'header.tsx'), "import { Link } from '@usequeek/theme-kit/navigation';\nimport { useState } from 'react';\n");
    writeFileSync(join(dir, 'footer.js'), "import { thing } from '@scope/pkg';\n");

    expect(await sdkBoundaryRule.run({ ...context({}), dir })).toEqual([]);
  });

  it('passes the starter fixture', async () => {
    const { findings } = await checkTheme(resolve(import.meta.dirname, '../../../fixtures/starter/theme'), { only: ['theme/core-boundary'] });
    expect(findings).toEqual([]);
  }, 60_000);
});

describe('theme/fonts-self-hosted', () => {
  it('rejects a Google Fonts @import in a theme stylesheet, same as next/font/google', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fonts-rule-'));
    mkdirSync(join(dir, 'styles'), { recursive: true });
    writeFileSync(join(dir, 'styles/type.css'), "@import url('https://fonts.googleapis.com/css2?family=Jost&display=swap');\n");

    const findings = await fontsSelfHostedRule.run({ ...context({}), dir });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'theme/fonts-self-hosted',
      severity: 'reject',
      where: 'styles/type.css',
      found: 'loads a font with @import from fonts.googleapis.com',
    });
  });
});

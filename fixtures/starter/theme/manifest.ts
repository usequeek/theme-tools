import type { ThemeManifest } from '@usequeek/theme-kit/types/theme';

/**
 * ONE variant per scope, and nothing decorative.
 *
 * This is a starting point, not a design. Add your own variants here and give
 * each a renderer in index.ts — `yarn theme:check` holds the two lists to each
 * other, and holds every field you declare to what your component actually
 * reads, so the manifest cannot drift from the UI a merchant is offered.
 */
const manifest: ThemeManifest = {
  name: 'Bare',
  slug: 'bare',
  version: '1.0.0',
  description: 'The starting skeleton for a new theme — the contract with no design opinions.',
  fields_contract: { content: 'structured' },
  tokens: {
    color: { primary: '#111111', bg: '#ffffff', text: '#111111' },
    type: { heading_font: 'Inter', body_font: 'Inter', scale_ratio: 1.25, heading_weight: 600, heading_case: 'none', heading_tracking: 0 },
    space: { density: 'comfortable' },
    shape: { radius: 'soft', border_weight: 'hairline' },
    elevation: 'flat',
    motion: 'subtle',
    image: { fit: 'cover', filter: 'none', radius: 'soft' },
  },
  variants: {
    header: [{
      id: 'default', label: 'Header', default: true, purpose: 'Store name, navigation, cart',
      fields: { logo: 'image url', menu: 'nav menu' }, editable: ['color.accent', 'type', 'space.density'],
    }],
    footer: [{
      id: 'default', label: 'Footer', default: true, purpose: 'Secondary navigation and store details',
      fields: { heading: 'string', tagline: 'string', columns: '[{heading, content}]', copyright: 'string' },
      editable: ['color.accent', 'type', 'space.density'],
    }],
    subscribe: [{
      id: 'inline', label: 'Inline', default: true, purpose: 'Newsletter form rendered above the footer',
      fields: { heading: 'string', tagline: 'string', cta: 'string' }, editable: ['color.accent', 'type'],
    }],
    gallery: [{
      id: 'banner', label: 'Banner', default: true, purpose: 'Full-width image with a heading and a call to action',
      fields: { images: '[{url, alt, title, subtitle, cta_label, cta_url}]', heading: 'string', description: 'string' },
      editable: ['space.density', 'image.fit', 'image.radius', 'image.filter'],
      best_for: ['product'], auto_pick: true, min_images: 1,
    }],
    products: [{
      id: 'grid', label: 'Product grid', default: true, purpose: 'Products in a responsive grid',
      fields: { title: { type: 'string' }, limit: { type: 'int' }, collection: 'collection slug', ids: 'product ids', sort: 'latest|popular|price_low|price_high' },
      editable: ['space.density', 'image.fit', 'image.radius'], best_for: ['product'], auto_pick: true,
    }],
    categories: [{
      id: 'grid', label: 'Category grid', default: true, purpose: 'Categories in a responsive grid',
      fields: { title: { type: 'string' }, limit: { type: 'int' } },
      editable: ['space.density', 'image.radius'], best_for: ['product'], auto_pick: true,
    }],
    contact: [{
      id: 'default', label: 'Contact', default: true, purpose: 'How to reach the store: a heading, a line and its details',
      fields: { heading: { type: 'string' }, description: { type: 'text' }, email: { type: 'string' }, phone: { type: 'string' }, address: { type: 'text' }, hours: { type: 'string' } },
      editable: ['space.density'],
    }],
  },
};

export default manifest;

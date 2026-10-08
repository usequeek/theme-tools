const config = {
  name: 'Medley',
  slug: 'medley',
  author: 'Queek',
  description: 'Bundle-first commerce theme: white pages, a condensed display serif over a geometric sans, rounded photo frames, a drifting photo-collage hero, a tilted colour ribbon and a dark footer. Seven templates (beauty, clothing, sneakers, hair, restaurant, laundry, home & living), each with its own home, header, palette and type.',
  version: '1.0.0',
  tags: ['beauty', 'skincare', 'cosmetics', 'fashion', 'clothing', 'sneakers', 'shoes', 'hair', 'wigs', 'restaurant', 'food', 'bundles', 'light', 'commerce'],
  categories: ['beauty-cosmetics', 'fashion', 'foods'],
  rank: 0,
  // What an AI reads to pick a template for a merchant (≤ 300 chars): who it
  // fits · the look · the signature sections · the material it needs.
  default_demo: {
    template: 'beauty',
    design_label: 'Photo collage',
    for: ['beauty-cosmetics', 'makeup', 'skincare', 'fragrance', 'beauty-personal-care'],
    label: 'Skincare & make-up',
    description: 'Skincare, cosmetics and other bundle-led shops. White and airy with big serif headlines; opens on a photo collage drifting round the headline, then mix-and-match bundles, kits, how-to steps, before/after and a tilted ribbon. Needs 6+ product photos on plain backdrops.',
  },
  // More designs (demos/<id>.json), previewed at /medley~<id> and grouped by
  // their `template`: clothes and food have two
  // designs each, the others one. Each design has its own home composition,
  // header, footer, palette and faces — not the beauty store with the copy
  // swapped. `for` names each template's business in
  // docs/business-vocabulary.json: a whole business leads with its
  // category, a niche (hair, shoes) names only catalogue keys.
  demos: [
    {
      id: 'clothes', template: 'clothes', design_label: 'Campaign',
      label: 'Clothing & menswear', for: ['fashion', 'mens-fashion', 'womens-fashion', 'modest-occasion-wear'],
      description: 'Clothing and menswear. Crisp white with ink and rust, tall condensed caps, centred logo; opens on two campaign photos side by side, then category cards, tabbed new-in, a lookbook mosaic and an offer panel. Needs 2 wide model photos and on-model product shots.',
    },
    {
      id: 'clothes-2', template: 'clothes', design_label: 'Tailoring house',
      description: 'Tailors and menswear houses. Dark charcoal with sand gold, a classical display serif: a drifting photo collage, the suiting collection, one complete look, made-to-measure steps and a fitting booking. Needs model photos and a few garment close-ups.',
    },
    {
      id: 'shoes', template: 'shoes', design_label: 'Drop day',
      label: 'Sneakers & footwear', for: ['shoes'],
      description: 'Sneakers, streetwear and drop-led shops. Loud: header over a full-screen slideshow, heavy condensed caps in cobalt and tangerine, a tilted ribbon, drop countdown, size guide and a giant wordmark footer. Needs 3 wide action photos and clean product shots.',
    },
    {
      id: 'hair', template: 'hair', design_label: 'Soft rose',
      label: 'Wigs & hair', for: ['wigs-extensions-hair-accessories', 'hair-care-styling'],
      description: 'Wigs, hair and beauty services. Soft rose and espresso with an elegant serif; opens on a three-photo mosaic, then texture circles, before/after install, install steps, shop-the-look and bundle deals. Needs 5+ portrait model photos.',
    },
    {
      id: 'food', template: 'food', design_label: 'Dining room',
      label: 'Restaurant & kitchen', for: ['foods'],
      description: 'Restaurants and takeaways. Warm and appetising: header over a full-screen dish slideshow, a two-column menu with prices, signature plates, table booking, dining-room photos and a map. Needs 3 wide dish or room photos; the menu reads well with few.',
    },
    {
      id: 'food-2', template: 'food', design_label: 'Neighbourhood buka',
      description: 'Neighbourhood bukas and canteens. Bright cream and green, bold grotesque type: opens on today\'s pot with hours and delivery area, the full priced menu up top, the plates people come for, party trays, dish categories and a map. Works with a short menu and few photos.',
    },
    {
      id: 'laundry', template: 'laundry', design_label: 'Claim ticket',
      label: 'Laundry & dry cleaning', for: ['laundry'],
      description: 'Laundries and dry cleaners. Starched white and ink navy with a claim-ticket orange, heavy grotesque type: a photo collage of pressed work, how-it-works steps, the price list by service, laundry plans and a book-a-pickup form. Needs 6+ photos of folded linen, pressed garments and the shop.',
    },
    {
      id: 'home', template: 'home', design_label: 'Room by room',
      label: 'Home & living', for: ['home-living', 'furniture', 'home-decor', 'kitchen-dining', 'bedding-bath'],
      description: 'Furniture and homeware stores. Deep teal and terracotta on white, a classic serif: full-bleed room slideshow, shop-by-room cards, new arrivals by room, a featured piece with its buy box, reviews and a journal. Needs room photos for each category and clean shots of every piece.',
    },
  ],
};

export default config;

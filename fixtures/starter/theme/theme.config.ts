const config = {
  name: 'Bare',
  slug: 'bare',
  author: 'Queek',
  description: 'The starting skeleton for a new theme — the contract with no design opinions. Never published.',
  version: '1.0.0',
  tags: ['minimal'],
  categories: ['shop'],
  rank: 0,
  // Every demo store is a template (themes/THEME.md#templates). demo.json is
  // the primary: name its business (its business category first), in the vocabulary of
  // lib/storefront/business-vocabulary.json. Its description is what an AI
  // reads to choose it for a merchant — write your own.
  default_demo: {
    label: 'General store',
    for: ['shop'],
    description: 'Replace before publishing. Any shop: a banner hero, a product grid and category tiles on plain white. Write who the template fits, the look, its signature sections and the photos it needs, in at most 300 characters.',
  },
  // Alternative demo stores, one per `demos/<id>.json` — the same theme as a
  // different business, previewed at `/?demo=<id>` here and `/<slug>~<id>`
  // once published. `for` uses the same vocabulary.
  // demos: [{ id: 'food', label: 'Restaurant & takeaway', for: ['foods', 'local-meals'], description: '…' }],
};

export default config;

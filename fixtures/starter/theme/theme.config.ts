const config = {
  name: 'Bare',
  slug: 'bare',
  author: 'Queek',
  description: 'The starting skeleton for a new theme — the contract with no design opinions. Never published.',
  version: '1.0.0',
  tags: ['starter'],
  categories: [],
  rank: 0,
  // Every demo store is a template (themes/THEME.md#templates). demo.json is
  // the primary: name its business (its business category first), in the vocabulary of
  // lib/storefront/business-vocabulary.json. Its description is what an AI
  // reads to choose it for a merchant — write your own.
  default_demo: {
    label: 'General store',
    for: ['shop'],
    description: 'Any shop: a banner hero, a product grid and category tiles on plain white. The Queek skeleton — structure and token wiring with no design, used by the theme tools tests.',
  },
  // Alternative demo stores, one per `demos/<id>.json` — the same theme as a
  // different business, previewed at `/?demo=<id>` here and `/<slug>~<id>`
  // once published. `for` uses the same vocabulary.
  // demos: [{ id: 'food', label: 'Restaurant & takeaway', for: ['foods', 'local-meals'], description: '…' }],
};

export default config;

const config = {
  name: 'Bare',
  slug: 'bare',
  author: 'Queek',
  description: 'The starting skeleton for a new theme — the contract with no design opinions. Never published.',
  version: '1.0.0',
  tags: ['minimal'],
  categories: ['shop'],
  rank: 0,
  // Theme → template → design (themes/THEME.md#templates). Every demo store is
  // a design; a template is the business a design is dressed as, and groups
  // its designs. demo.json is the main template's first design. `template` is
  // that template's key: a slug for its business, never renamed once shipped.
  // `label` names the business and `for` lists it (its business category
  // first) in the vocabulary of lib/storefront/business-vocabulary.json. Its
  // description is what an AI reads to choose it for a merchant — write your own.
  default_demo: {
    template: 'shop',
    label: 'General store',
    for: ['shop'],
    description: 'Replace before publishing. Any shop: a banner hero, a product grid and category tiles on plain white. Write who the template fits, the look, its signature sections and the photos it needs, in at most 300 characters.',
  },
  // More designs, one per `demos/<id>.json`, previewed at `/?demo=<id>` here
  // and `/<slug>~<id>` once published. Another business is another template;
  // its first design's id is its key:
  // demos: [{ id: 'food', template: 'food', label: 'Restaurant & takeaway', for: ['foods', 'local-meals'], description: '…' }],
  // A second design of the same template declares only `id`, `template`,
  // `design_label` and `description` — it inherits the template's `label` and
  // `for`:
  //   { id: 'food-2', template: 'food', design_label: 'Night market', description: '…' }
};

export default config;

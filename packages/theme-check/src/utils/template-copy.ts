/**
 * What a template's `copy` may not say (queek_backend contract R2.6).
 *
 * The merchant setup wizard publishes a template's homepage onto a real store
 * without rewriting it, so its copy must be true of ANY store in that business:
 * no demo store name ("…at Mama Tee's"), no place ("delivered across Lekki"),
 * no naira amount ("free delivery over ₦5,000"), no promise only the vendor can
 * make (a delivery window, a return period, a guarantee) and no founding date.
 * Testimonials and reviews are exempt; the backend never places their copy on a
 * real store.
 */

/**
 * Places the demo copy named when it was measured (24/9/26), plus the rest of
 * the country's big cities and Lagos and Abuja districts a new template is
 * likely to reach for. Matched case-sensitively as whole words, so "the island"
 * or "delta" in a sentence are not places; "Ankara" is left out because in
 * this copy it is always the fabric.
 */
export const TEMPLATE_COPY_PLACES: readonly string[] = [
  // Nigeria, its states and big cities
  'Nigeria', 'Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Kaduna', 'Enugu', 'Benin City', 'Abeokuta',
  'Owerri', 'Uyo', 'Calabar', 'Jos', 'Warri', 'Asaba', 'Onitsha', 'Aba', 'Ilorin', 'Akure', 'Osogbo', 'Ile-Ife',
  'Sokoto', 'Maiduguri', 'Kwara', 'Ogun', 'Oyo', 'Anambra', 'Akwa Ibom', 'Cross River', 'Bayelsa', 'Ekiti', 'Ondo',
  'Osun', 'Kogi', 'Benue', 'Katsina', 'Bauchi', 'Gombe', 'Borno', 'Adamawa', 'Taraba', 'Nasarawa', 'Zamfara',
  'Kebbi', 'Jigawa', 'Ebonyi', 'Delta State', 'Rivers State', 'Plateau State', 'Niger State', 'Imo State', 'Edo State',
  // Lagos
  'Lekki', 'Ikoyi', 'Victoria Island', 'VI', 'Lagos Island', 'Banana Island', 'Eko Atlantic', 'Oniru', 'Ajah', 'Sangotedo',
  'Yaba', 'Surulere', 'Ikeja', 'GRA', 'Maryland', 'Magodo', 'Gbagada', 'Ogudu', 'Ojodu', 'Ojota', 'Ketu', 'Agege',
  'Isolo', 'Oshodi', 'Mushin', 'Ikorodu', 'Epe', 'Badagry', 'Festac', 'Apapa', 'Obalende', 'Ebute Metta',
  'Ebute-Metta', 'Idumota', 'Balogun', 'Marina', 'Ilupeju', 'Opebi', 'Oregun', 'Allen Avenue', 'Admiralty Way',
  'Awolowo Road', 'Odeku Street', 'Akoka', 'Bariga', 'Shomolu', 'Ogba', 'Omole', 'Ikota', 'Osapa', 'Chevron Drive',
  // Abuja and Port Harcourt
  'Wuse', 'Maitama', 'Garki', 'Asokoro', 'Gwarinpa', 'Jabi', 'Utako', 'Kubwa', 'Lugbe', 'Katampe', 'Guzape',
  'Trans-Amadi', 'Rumuola',
  // Abroad, as the demo stores claimed origins
  'Accra', 'Nairobi', 'Johannesburg', 'Dubai', 'London', 'Birmingham', 'Paris', 'Milan', 'Florence', 'Rome',
  'Italy', 'France', 'Japan', 'Tokyo', 'Jaipur', 'New York', 'Istanbul', 'Guangzhou',
];

/** Words a store name ends in that say what it is, not who: stripped to find the name a copy line would use. */
const GENERIC_NAME_WORDS = new Set([
  'co', 'co.', 'supply', 'house', 'kitchen', 'studio', 'bakehouse', 'grillhouse', 'buka', 'lagos', 'skin', 'fine',
  'jewellery', 'jewelry', 'beauty', 'hair', 'fashion', 'occasion', 'tailoring', 'store', 'shop', 'boutique',
]);

/**
 * The forms of a store's name that copy would use: the full name, without a
 * leading "The", and without the generic words it ends in ("Bloom Bakehouse"
 * → "Bloom", "Mama Tee's Buka" → "Mama Tee").
 */
export function storeNameForms(name: string | null | undefined): string[] {
  const full = (name ?? '').trim();
  if (!full) return [];
  const forms = new Set([full, full.replace(/^The\s+/, '')]);
  const words = full.replace(/^The\s+/, '').split(/\s+/);
  while (words.length > 1 && GENERIC_NAME_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  const core = words.join(' ').replace(/['’]s$/, '');
  if (core.length >= 3) forms.add(core);
  return [...forms];
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A whole word or phrase, case-sensitive: letters on either side make it part of another word. */
const wordPattern = (phrase: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${escape(phrase)}(?![\\p{L}\\p{N}])`, 'u');

const PLACE_PATTERNS = TEMPLATE_COPY_PLACES.map((place) => [place, wordPattern(place)] as const);
/** ₦5,000 · NGN 5000 · N5,000 — any naira amount. */
const NAIRA_AMOUNT = /₦\s?\d|\bNGN\s?\d|(?<![\p{L}\p{N}])N\d{1,3}(,\d{3})+(?![\p{N}])/u;

/**
 * Commitments only the vendor can make, in the phrasings that are never
 * anything else: "same-day", "within 30 days", "1–2 days", "30-day returns",
 * "free delivery", "guaranteed", "in 45 minutes". A process ("fermented for
 * 36 hours") is not a promise and does not match.
 */
const PROMISE = new RegExp([
  String.raw`\b(?:same|next)[- ]day\b`,
  String.raw`\bwithin \d+ ?(?:min(?:ute)?s?|hours?|days?|weeks?)\b`,
  String.raw`\b\d+\s*(?:–|-|to)\s*\d+\s*(?:working |business )?(?:hours|days|weeks)\b`,
  String.raw`\b\d+[- ]day (?:returns?|exchanges?|refunds?|adjustments?)\b`,
  String.raw`\bfree (?:delivery|shipping|returns?)\b`,
  String.raw`\bguarantee[ds]?\b`, String.raw`\bmoney[- ]back\b`, String.raw`\bwarranty\b`,
  String.raw`\bin (?:about |under )?\d+ ?min(?:ute)?s?\b`,
].join('|'), 'i');

/** A founding date is the demo store's history, not the business's: "since 2014", "started in 2019". */
const STORE_HISTORY = /\b(?:since|est\.?|established) (?:19|20)\d\d\b|\b(?:founded|started|opened)\b[^.!?]{0,40}?\b(?:19|20)\d\d\b/i;

/** Why one copy string could not go live on another store unchanged; empty when it can. */
export function copyViolations(text: string, storeName: string | null | undefined): string[] {
  const found: string[] = [];
  const name = storeNameForms(storeName).find((form) => wordPattern(form).test(text));
  if (name) found.push(`names the store ("${name}")`);
  const places = PLACE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([place]) => place);
  if (places.length > 0) found.push(`names ${places.length === 1 ? 'a place' : 'places'} (${places.join(', ')})`);
  if (NAIRA_AMOUNT.test(text)) found.push('states a naira amount');
  const promise = PROMISE.exec(text);
  if (promise) found.push(`makes a promise ("${promise[0]}")`);
  const history = STORE_HISTORY.exec(text);
  if (history) found.push(`dates the store ("${history[0]}")`);
  return found;
}

/** Keys that make a list a set of customer quotes. */
const TESTIMONIAL_KEYS = /\b(quote|author|rating)\b/;

/**
 * Testimonials and reviews, as the backend reads them (R2.6.3): a variant
 * whose id or section type names them, or whose items declare quote, author or
 * rating. Their copy is never placed on a real store, so the demo keeps it.
 */
export function isTestimonialSection(type: string, variant: string, fields: Record<string, unknown> | undefined): boolean {
  if (/testimonial|review/i.test(`${type} ${variant}`)) return true;
  return Object.values(fields ?? {}).some((spec) => {
    if (typeof spec === 'string') return TESTIMONIAL_KEYS.test(spec);
    const of = spec && typeof spec === 'object' ? (spec as { of?: unknown }).of : undefined;
    return !!of && typeof of === 'object' && Object.keys(of).some((key) => TESTIMONIAL_KEYS.test(key));
  });
}

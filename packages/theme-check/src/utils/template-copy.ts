/**
 * What a template's `copy` may not say (queek_backend contract R2.6).
 *
 * The merchant setup wizard publishes a template's homepage onto a real store
 * without rewriting it, so its copy must be true of ANY store in that business:
 * no demo store name ("…at Mama Tee's"), no place ("delivered across Lekki"),
 * no naira amount ("free delivery over ₦5,000"), no offer or coupon code, no
 * opening hours, no promise only the vendor can make (a delivery window, a
 * return period, a guarantee), no founding date or store age, and no email or
 * phone number. Testimonials and reviews are exempt; the backend never places
 * their copy on a real store.
 *
 * Each pattern is shaped by what it must NOT catch as much as what it must: a
 * review ran real demo lines through it (24/9/26) — "Cold brewed for 12–24
 * hours" is process, "Delivered in 2 hours" is a promise; "London Dry gin" is a
 * style, "Made in Lagos" is a place. tests/theme-templates.test.ts holds both lists.
 */

/**
 * Places the demo copy named when it was measured (24/9/26), plus the rest of
 * the country's big cities and Lagos and Abuja districts a new template is
 * likely to reach for. Matched case-sensitively as whole words, so "the island"
 * or "delta" in a sentence are not places. Left out on purpose: "Ankara" (in
 * this copy it is the fabric) and cities that name product styles — London Dry
 * gin, New York cheesecake, Dubai chocolate, Milan and Florence cuts.
 */
export const TEMPLATE_COPY_PLACES: readonly string[] = [
  // Nigeria, its states and big cities
  'Nigeria', 'Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Kaduna', 'Enugu', 'Benin City', 'Abeokuta',
  'Owerri', 'Uyo', 'Calabar', 'Jos', 'Warri', 'Asaba', 'Onitsha', 'Aba', 'Ilorin', 'Akure', 'Osogbo', 'Ile-Ife',
  'Sokoto', 'Maiduguri', 'Kwara', 'Ogun', 'Oyo', 'Anambra', 'Akwa Ibom', 'Cross River', 'Bayelsa', 'Ekiti', 'Ondo',
  'Osun', 'Kogi', 'Benue', 'Katsina', 'Bauchi', 'Gombe', 'Borno', 'Adamawa', 'Taraba', 'Nasarawa', 'Zamfara',
  'Kebbi', 'Jigawa', 'Ebonyi', 'Delta State', 'Rivers State', 'Plateau State', 'Niger State', 'Imo State', 'Edo State',
  // Lagos
  'Lekki', 'Ikoyi', 'Victoria Island', 'VI', 'Lagos Island', 'Banana Island', 'Eko Atlantic', 'Eko', 'Oniru', 'Ajah',
  'Sangotedo', 'Yaba', 'Surulere', 'Ikeja', 'Computer Village', 'GRA', 'Maryland', 'Magodo', 'Gbagada', 'Ogudu',
  'Ojodu', 'Ojota', 'Ketu', 'Agege', 'Isolo', 'Oshodi', 'Mushin', 'Ikorodu', 'Epe', 'Badagry', 'Festac', 'Apapa',
  'Obalende', 'Ebute Metta', 'Ebute-Metta', 'Idumota', 'Balogun', 'Marina', 'Ilupeju', 'Opebi', 'Oregun',
  'Allen Avenue', 'Admiralty Way', 'Awolowo Road', 'Odeku Street', 'Akoka', 'Bariga', 'Shomolu', 'Ogba', 'Omole',
  'Ikota', 'Osapa', 'Chevron Drive',
  // Abuja and Port Harcourt
  'Wuse', 'Maitama', 'Garki', 'Asokoro', 'Gwarinpa', 'Jabi', 'Utako', 'Kubwa', 'Lugbe', 'Katampe', 'Guzape',
  'Trans-Amadi', 'Rumuola',
  // Abroad, as the demo stores claimed origins
  'Accra', 'Nairobi', 'Johannesburg', 'Birmingham', 'Paris', 'Italy', 'France', 'Japan', 'China', 'Tokyo', 'Jaipur',
  'Istanbul', 'Guangzhou',
];

/**
 * Words a store name ends in that say what it is, not who: stripped to find
 * the name a copy line would use ("Bloom Bakehouse" → "Bloom").
 */
const GENERIC_NAME_WORDS = new Set([
  'co', 'co.', 'company', 'ltd', 'limited', 'enterprises', 'ventures', 'global', 'supply', 'house', 'kitchen',
  'studio', 'studios', 'bakehouse', 'bakery', 'grillhouse', 'grill', 'buka', 'cafe', 'café', 'coffee', 'roasters',
  'lagos', 'skin', 'skincare', 'cosmetics', 'beauty', 'hair', 'wigs', 'salon', 'fine', 'jewellery', 'jewelry',
  'fashion', 'occasion', 'tailoring', 'couture', 'wear', 'shoes', 'sneakers', 'store', 'stores', 'shop', 'mart',
  'boutique', 'collective', 'hub', 'foods', 'food', 'laundry', 'laundromat', 'pharmacy',
]);

/**
 * The forms of a store's name that copy would use: the full name, without a
 * leading "The", without the generic words it ends in ("Mama Tee's Buka" →
 * "Mama Tee"), and each in capitals. A name that is nothing but generic words
 * ("Fashion House") keeps only its full form — "Fashion" alone is the business.
 */
export function storeNameForms(name: string | null | undefined): string[] {
  const full = (name ?? '').trim();
  if (!full) return [];
  const bare = full.replace(/^The\s+/, '');
  const forms = new Set([full, bare]);
  const words = bare.split(/\s+/);
  while (words.length > 1 && GENERIC_NAME_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  const core = words.join(' ').replace(/['’]s$/, '');
  const allGeneric = words.every((word) => GENERIC_NAME_WORDS.has(word.toLowerCase().replace(/['’]s$/, '')));
  if (core.length >= 3 && !allGeneric) forms.add(core);
  for (const form of [...forms]) forms.add(form.toUpperCase());
  return [...forms];
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A whole word or phrase, case-sensitive: letters on either side make it part of another word. */
const wordPattern = (phrase: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${escape(phrase)}(?![\\p{L}\\p{N}])`, 'u');

/** "VI" is Victoria Island — unless it numbers something ("Collection VI"). */
const ROMAN_CONTEXT = '(?<!(?:Collection|Volume|Vol\\.|Part|Chapter|Edition|Series|Season|Phase|No\\.|Act|Book) )';
const PLACE_PATTERNS = TEMPLATE_COPY_PLACES.map((place) => [
  place,
  place === 'VI' ? new RegExp(`${ROMAN_CONTEXT}(?<![\\p{L}\\p{N}])VI(?![\\p{L}\\p{N}])`, 'u') : wordPattern(place),
] as const);

/** ₦5,000 · NGN 5000 · N5,000 · N5000 · 5,000 naira — any naira amount. */
const NAIRA_AMOUNT = [
  /₦\s?\d|\bNGN\s?\d/,
  /(?<![\p{L}\p{N}])N\d{1,3}(,\d{3})+(?![\p{N}])|(?<![\p{L}\p{N}])N\d{3,}(?![\p{L}\p{N}])/u,
  /\d[\d,.]*\s?k?\s?naira\b/i,
];

/**
 * A discount or a coupon code: "Save 20% with code RAINS20", "Up to 25% off".
 * "Half-price" and a bare "sale" are offers too ("the clearance sale is on",
 * "shop the sale", "sale ends Sunday") — but only as their own word, so
 * "wholesale" and "salesperson" are not, and never the trade phrase "for sale
 * by the kilo". "Discount" and "coupon" alone name an offer no store can keep.
 */
const OFFER = [
  /\b(?:code|coupon|promo(?: code)?)\s*:?\s*[A-Z][A-Z0-9]{3,}\b/,
  /\b\d{1,3}\s?%\s?(?:off|discount)\b|\bsave\s+(?:up to\s+)?\d{1,3}\s?%|\bup to\s+\d{1,3}\s?%/i,
  /\bhalf[\s-]price\b/i,
  /\b(?<!for )sale\b(?! by the kilo)/i,
  /\b(?:coupon|discount)s?\b/i,
];

/**
 * Opening hours: "Open daily", "11am–10pm", "Doors open 11am", "from 6 AM",
 * "till 11 PM", "08:00–19:00". A time on its own is not hours ("Glow before
 * 8am", "trace your feet after 6pm").
 */
const TIME = String.raw`\d{1,2}(?::\d{2})?\s?(?:am|pm)\b`;
const HOURS = new RegExp([
  String.raw`\bopen\s+(?:daily|every\s+day|all\s+week|24\/7|early|late)\b`,
  String.raw`\b\d{1,2}(?::\d{2})?\s?(?:am|pm)?\s?(?:–|-|to)\s?${TIME}`,
  String.raw`\b(?:opens?|opening|doors|from|till|until|last\s+orders|closes?|closing)\s+(?:at\s+)?${TIME}`,
  String.raw`\b(?:[01]?\d|2[0-3]):[0-5]\d\s?(?:–|-|to)\s?(?:[01]?\d|2[0-3]):[0-5]\d\b`,
  // a weekday at a clock time is the store's schedule: "New drop every Friday, 7pm"
  String.raw`\b(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b,?\s+(?:at\s+)?${TIME}`,
].join('|'), 'i');

/**
 * Commitments only the vendor can make. A time window is a promise only next
 * to a service — delivered, ships, answered, fitted, returned — so a recipe's
 * or a process's time ("marinated 24–48 hours", "ready in 3 minutes") is not.
 */
const SERVICE = String.raw`(?:deliver\w*|ship(?:s|ped|ping)?|dispatch\w*|arriv\w*|collect\w*|pick(?:ed|s)?[- ]?up|turnaround|answer\w*|repl(?:y|ies|ied)|respond\w*|install\w*|fit(?:ted|ting)?|resiz\w*|repair\w*|replace\w*|exchang\w*|return\w*|refund\w*|measur\w*|tailor\w*|alter(?:s|ed|ing|ations?)?)`;
const WINDOW = String.raw`(?:(?:within|in|under)\s+(?:about\s+)?(?:\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty)[\s-]?(?:min(?:ute)?s?|hours?|hrs?|days?|weeks?)|\d+\s*(?:–|-|to)\s*\d+[\s-]*(?:working\s+|business\s+)?(?:hours?|days?|weeks?)|(?:same|next)[- ](?:day|evening|morning))`;
const PROMISE = [
  new RegExp(String.raw`\b${SERVICE}\b[^.!?\n]{0,40}?${WINDOW}\b|${WINDOW}\b[^.!?\n]{0,40}?\b${SERVICE}\b`, 'i'),
  /\b\d+[\s-](?:minute|min|hour|hr|day|week)s?\s+(?:delivery|dispatch|shipping|turnaround|returns?|exchanges?|refunds?|adjustments?|service)\b/i,
  /\b(?:free|complimentary)\s+(?:\w+\s+)?(?:delivery|shipping|returns?|pick[- ]?up|collection|alterations?|installation|install|resizing|exchanges?|samples?|styling|gifts?|consultations?|fittings?|refills?)\b/i,
  // a service promised without end, or a reply promised fast
  /\b(?:returns?|exchanges?|refunds?|delivery|shipping)\b[^.!?\n|]{0,20}\balways\b/i,
  /\b(?:answer\w*|repl(?:y|ies|ied)|respond\w*)\s+(?:fast|quickly|promptly|right away)\b|\b(?:fast|quick|prompt)\s+(?:repl(?:y|ies)|answers?|responses?)\b/i,
  /\b(?:guarantee[ds]?|money[- ]back|warrant(?:y|ies)|no questions asked)\b/i,
];

/** The store's history, not the business's: "since 2014", "started in 2019", "six years, two stores". */
const NUMBER = '(?:\\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)';
const STORE_HISTORY = [
  /\b(?:since|est\.?|established(?:\s+in)?)\s+(?:19|20)\d\d\b/i,
  /\b(?:founded|started|opened|established|began)\b(?:\s+[\w’'-]+){0,6}?\s+in\s+(?:19|20)\d\d\b/i,
  /\bin\s+(?:19|20)\d\d,?\s+(?:we|our|the\s+(?:shop|store|kitchen|studio|house|bakery))\b/i,
  new RegExp(`\\b${NUMBER}\\s+years?(?:,|\\s+(?:on|later|ago|in\\s+business|of\\s+(?:experience|service|serving|trading)))`, 'i'),
];

/** The demo store's email or phone written into the words ("Email hello@zuri.ng", "wa.me/234…"). */
const CONTACT = /[\w.+-]+@[\w-]+\.[a-z]{2,}|\+234[\s\d-]{6,}|\b0[789][01]\d(?:[\s-]?\d){7}\b|\bwa\.me\/\d+/i;

const first = (patterns: RegExp[], text: string): string | null => {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
};

/** Why one copy string could not go live on another store unchanged; empty when it can. */
export function copyViolations(text: string, storeName: string | null | undefined): string[] {
  const found: string[] = [];
  const name = storeNameForms(storeName).find((form) => wordPattern(form).test(text));
  if (name) found.push(`names the store ("${name}")`);
  const places = PLACE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([place]) => place);
  if (places.length > 0) found.push(`names ${places.length === 1 ? 'a place' : 'places'} (${places.join(', ')})`);
  if (first(NAIRA_AMOUNT, text)) found.push('states a naira amount');
  const offer = first(OFFER, text);
  if (offer) found.push(`states an offer ("${offer}")`);
  const hours = HOURS.exec(text);
  if (hours) found.push(`states opening hours ("${hours[0]}")`);
  const promise = first(PROMISE, text);
  if (promise) found.push(`makes a promise ("${promise}")`);
  const history = first(STORE_HISTORY, text);
  if (history) found.push(`dates the store ("${history}")`);
  const contact = CONTACT.exec(text);
  if (contact) found.push(`gives the store’s contact details ("${contact[0]}")`);
  return found;
}

/** A section whose type or variant id is a testimonials/reviews one — whole words, so "preview" is not. */
const TESTIMONIAL_NAME = /(?:^|[\s_-])(?:testimonials?|reviews?)(?:$|[\s_-])/i;
/** Keys that make a list a set of customer quotes. */
const TESTIMONIAL_KEYS = /\b(quote|author|rating)\b/;

/**
 * Testimonials and reviews, as the backend reads them (R2.6.3): a variant
 * whose id or section type names them, or whose items declare quote, author or
 * rating. Their copy is never placed on a real store, so the demo keeps it.
 */
export function isTestimonialSection(type: string, variant: string, fields: Record<string, unknown> | undefined): boolean {
  if (TESTIMONIAL_NAME.test(type) || TESTIMONIAL_NAME.test(variant)) return true;
  return Object.values(fields ?? {}).some((spec) => {
    if (typeof spec === 'string') return TESTIMONIAL_KEYS.test(spec);
    const of = spec && typeof spec === 'object' ? (spec as { of?: unknown }).of : undefined;
    return !!of && typeof of === 'object' && Object.keys(of).some((key) => TESTIMONIAL_KEYS.test(key));
  });
}

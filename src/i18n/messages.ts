/**
 * Setswana and English message catalogue.
 *
 * MASTER_PROMPT.md §3.6: Setswana is a launch language, not a Phase-4
 * afterthought. It is the first language of most of the farmers this platform
 * exists for, and an English-only livestock marketplace in Botswana is a
 * marketplace for people who already have other options.
 *
 * Setswana is the default when the device gives no better signal.
 *
 * Translation notes for review by a first-language speaker:
 *   - "kgomo" (pl. "dikgomo") is cattle generally; "poo" a bull, "kgomo e
 *     namagadi" a cow, "namane" a calf.
 *   - Livestock counts use "ditlhogo" (head) the same way English does.
 *   - Money is "Pula"; the currency code BWP is left untranslated.
 */

export type Locale = 'TN' | 'EN';

export const DEFAULT_LOCALE: Locale = 'TN';

export type MessageKey = keyof typeof EN;

const EN = {
  // ─── General ───
  'app.name': 'Kraal',
  'app.tagline': 'Buy and sell livestock, farmer to farmer',
  'action.continue': 'Continue',
  'action.back': 'Back',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.publish': 'Publish',
  'action.retry': 'Try again',

  // ─── Listings ───
  'listing.create.title': 'Sell livestock',
  'listing.create.photos': 'Take photos',
  'listing.create.photos.hint': 'At least 3: side view, rear view, and the ear tag',
  'listing.create.lits': 'Ear tag number',
  'listing.create.lits.hint': 'The LITS number on the animal\'s ear tag',
  'listing.create.weight': 'Weight',
  'listing.create.weight.method': 'How was this weighed?',
  'listing.create.price': 'Asking price',
  'listing.create.saved_offline': 'Saved on your phone. It will be posted when you have signal.',
  'listing.status.draft': 'Draft',
  'listing.status.active': 'For sale',
  'listing.status.sold': 'Sold',

  // ─── Movement (§3.2) ───
  'movement.same_zone': 'Same zone — no permit needed',
  'movement.permit_required': 'Different zone — a movement permit is needed',
  'movement.blocked': 'Movement restricted — this zone is under disease control',
  'movement.unknown_zone': 'Zone not confirmed — check before arranging collection',

  // ─── Offers & transactions ───
  'offer.made': 'Offer sent',
  'offer.received': 'You have a new offer',
  'offer.accepted': 'Your offer was accepted',
  'offer.declined': 'Your offer was declined',
  'offer.expires_in': 'Expires in {hours} hours',
  'txn.escrow.pending': 'Waiting for payment',
  'txn.escrow.funded': 'Payment received and held safely',
  'txn.escrow.explain':
    'Your money is held safely until you confirm you have received the animals.',
  'txn.ready_for_collection': 'Ready for collection',
  'txn.collection_code': 'Collection code',
  'txn.collection_code.explain': 'Give this code to the buyer when they collect',
  'txn.settled': 'Complete — the seller has been paid',
  'txn.weight_adjusted':
    'The price was adjusted because the actual weight differed from the declared weight',

  // ─── Alerts (§9) ───
  'alert.new_match': 'New listing that matches what you are looking for',
  'alert.new_match.body': '{title} — {price}, {distance} km away',
  'alert.price_drop': 'The price has dropped on a listing you are watching',
  'alert.wtb_match': 'A buyer near you wants what you are selling',
  'alert.digest.title': 'Your daily listings',
  'alert.market.title': 'This week in the market',

  // ─── Verification (§8.1) ───
  'verify.required': 'Verification needed',
  'verify.t1.explain': 'Verify your identity to make offers',
  'verify.t2.explain': 'Verify your farm to sell livestock',
  'verify.offer_ceiling': 'Verify your farm to make offers above {amount}',
  'verify.pending': 'We are checking your documents. This usually takes one working day.',

  // ─── Errors ───
  'error.lits.required': 'The ear tag number is required for cattle',
  'error.lits.format': 'That does not look like a valid ear tag number',
  'error.lits.duplicate':
    'This ear tag number is already listed by someone else. Both listings have been paused '
    + 'while we check.',
  'error.lits.stolen': 'This animal has been reported stolen. This listing cannot be posted.',
  'error.photos.minimum': 'Please add at least 3 photos',
  'error.price.required': 'Please enter an asking price',
  'error.offline': 'No signal. Your work is saved and will be sent when you reconnect.',
  'error.generic': 'Something went wrong. Please try again.',
} as const;

const TN: Record<MessageKey, string> = {
  'app.name': 'Kraal',
  'app.tagline': 'Reka o bo o rekise leruo, molemi go molemi',
  'action.continue': 'Tswelela',
  'action.back': 'Boela morago',
  'action.save': 'Boloka',
  'action.cancel': 'Khansela',
  'action.publish': 'Phasalatsa',
  'action.retry': 'Leka gape',

  'listing.create.title': 'Rekisa leruo',
  'listing.create.photos': 'Tsaya ditshwantsho',
  'listing.create.photos.hint': 'Bonnye tse 3: lotlhakore, morago, le letshwao la tsebe',
  'listing.create.lits': 'Nomoro ya letshwao la tsebe',
  'listing.create.lits.hint': 'Nomoro ya LITS e e mo letshwaong la tsebe ya phologolo',
  'listing.create.weight': 'Boima',
  'listing.create.weight.method': 'Boima bo ne bo elwa jang?',
  'listing.create.price': 'Tlhwatlhwa e e kopiwang',
  'listing.create.saved_offline':
    'Go bolokilwe mo founong ya gago. Go tla romelwa fa o na le networko.',
  'listing.status.draft': 'E sa phasalatswa',
  'listing.status.active': 'E a rekisiwa',
  'listing.status.sold': 'E rekisitswe',

  'movement.same_zone': 'Kgaolo e le nngwe — ga go tlhokege pemiti',
  'movement.permit_required': 'Kgaolo e sele — go tlhokega pemiti ya go fudusa',
  'movement.blocked': 'Go fudusa go thibetswe — kgaolo e mo taolong ya bolwetse',
  'movement.unknown_zone': 'Kgaolo ga e a netefadiwa — tlhola pele o rulaganya go tsaya',

  'offer.made': 'Kabo e rometswe',
  'offer.received': 'O na le kabo e ntšhwa',
  'offer.accepted': 'Kabo ya gago e amogetswe',
  'offer.declined': 'Kabo ya gago ga e a amogelwa',
  'offer.expires_in': 'E fela mo diureng tse {hours}',
  'txn.escrow.pending': 'Go letetswe tuelo',
  'txn.escrow.funded': 'Tuelo e amogetswe e bile e bolokilwe sentle',
  'txn.escrow.explain':
    'Madi a gago a bolokilwe sentle go fitlhelela o netefatsa gore o amogetse diphologolo.',
  'txn.ready_for_collection': 'E siametse go tsewa',
  'txn.collection_code': 'Khoutu ya go tsaya',
  'txn.collection_code.explain': 'Naya moreki khoutu e fa a tla go tsaya',
  'txn.settled': 'Go fedile — morekisi o duetswe',
  'txn.weight_adjusted':
    'Tlhwatlhwa e fetotswe ka gonne boima jwa nnete bo ne bo farologana le jo bo neng bo begilwe',

  'alert.new_match': 'Go na le se se ntšhwa se se tsamaisanang le se o se batlang',
  'alert.new_match.body': '{title} — {price}, dikhilomitara tse {distance} go tswa mo go wena',
  'alert.price_drop': 'Tlhwatlhwa e fokoditswe mo go se o se lebeletseng',
  'alert.wtb_match': 'Moreki yo o gaufi le wena o batla se o se rekisang',
  'alert.digest.title': 'Dilo tse di rekisiwang gompieno',
  'alert.market.title': 'Mmaraka mo bekeng eno',

  'verify.required': 'Go tlhokega netefatso',
  'verify.t1.explain': 'Netefatsa boitshupo jwa gago go kgona go dira dikabo',
  'verify.t2.explain': 'Netefatsa polase ya gago go kgona go rekisa leruo',
  'verify.offer_ceiling': 'Netefatsa polase ya gago go dira dikabo tse di fetang {amount}',
  'verify.pending': 'Re tlhola dikwalo tsa gago. Gantsi go tsaya letsatsi le le lengwe la tiro.',

  'error.lits.required': 'Nomoro ya letshwao la tsebe e a tlhokega mo dikgomong',
  'error.lits.format': 'Nomoro eo ga e lebege e siame',
  'error.lits.duplicate':
    'Nomoro e ya letshwao e setse e rekisiwa ke mongwe o sele. Dithulaganyo tsoopedi di '
    + 'emisitswe go fitlhelela re tlhola.',
  'error.lits.stolen':
    'Phologolo e e begilwe e utswitswe. Thulaganyo e ga e kake ya phasalatswa.',
  'error.photos.minimum': 'Tsweetswee tsenya ditshwantsho tse le tharo bonnye',
  'error.price.required': 'Tsweetswee tsenya tlhwatlhwa e o e kopang',
  'error.offline': 'Ga go na networko. Tiro ya gago e bolokilwe, e tla romelwa fa o kgokagana.',
  'error.generic': 'Go na le se se sa tsamayang sentle. Tsweetswee leka gape.',
};

const CATALOGUES: Record<Locale, Record<MessageKey, string>> = { EN, TN };

/**
 * Look up a message, substituting `{placeholders}`.
 *
 * Falls back to English, then to the key itself. A missing translation should
 * degrade to something readable, never to a blank screen.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = CATALOGUES[locale]?.[key] ?? EN[key] ?? key;
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Pick a locale from an Accept-Language header or navigator.language. */
export function resolveLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const tags = header.toLowerCase();
  if (tags.includes('tn') || tags.includes('setswana') || tags.includes('bw')) return 'TN';
  if (tags.includes('en')) return 'EN';
  return DEFAULT_LOCALE;
}

export const SUPPORTED_LOCALES: Locale[] = ['TN', 'EN'];

export const LOCALE_NAMES: Record<Locale, string> = {
  TN: 'Setswana',
  EN: 'English',
};

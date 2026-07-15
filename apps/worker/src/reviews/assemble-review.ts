import { isUsableUspPhrase, type ReviewLength } from "@ai-shopify/shared";
import {
  BRAND_CLOSERS,
  CLOSERS,
  DETAILS,
  GIFT_CLOSERS,
  GIFT_DETAILS,
  GIFT_OPENERS,
  OPENERS,
  ratingToTier,
  TITLE_PHRASES,
  USP_CLOSERS,
} from "./content-bank.js";

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

/** Casual lead-ins occasionally prepended to the opener sentence — real typed reviews don't
 * always start "fresh" with a clean declarative sentence the way every phrase-bank entry does on
 * its own; this breaks that pattern up without needing a whole extra hand-written sentence pool. */
const INTERJECTIONS = [
  "Honestly, ",
  "Not gonna lie, ",
  "Ngl, ",
  "Okay so ",
  "So far, ",
  "Real talk, ",
  "Gotta say, ",
];

function maybeAddInterjection(sentence: string): string {
  if (Math.random() >= 0.22) return sentence;
  const interjection = pick(INTERJECTIONS);
  // The pronoun "I" (and its contractions — I've, I'm, I'll, I'd) is always capitalized in
  // English regardless of position, unlike an ordinary sentence-initial word — lowercasing it
  // reads as a typo rather than casual style, so leave those sentences' capitalization alone.
  const startsWithCapitalI = /^I(['\s]|$)/.test(sentence);
  const lowered = startsWithCapitalI ? sentence : sentence.charAt(0).toLowerCase() + sentence.slice(1);
  return interjection + lowered;
}

function fillPlaceholders(
  phrase: string,
  vars: {
    productType: string;
    brandCategory?: string;
    brandName?: string;
    usp?: string;
    giftRecipient?: string;
  },
): string {
  return phrase
    .replaceAll("{productType}", vars.productType || "product")
    .replaceAll("{brandCategory}", vars.brandCategory || vars.productType || "this category")
    .replaceAll("{brandName}", vars.brandName || "this shop")
    .replaceAll("{usp}", vars.usp || "")
    .replaceAll("{giftRecipient}", vars.giftRecipient || "family member");
}

export type AssembledReview = { title: string; content: string; comboKey: string };

export type AssembleReviewParams = {
  productType: string;
  rating: number;
  length: ReviewLength;
  brand?: { name?: string; category?: string; usp?: string };
  excludeCombos: Set<string>;
  /** Set when the reviewer's own gender doesn't match the product's detected audience — swaps in
   * gift-framed phrasing (see content-bank.ts's GIFT_* pools) instead of personal-use phrasing. */
  giftRecipient?: string;
};

const DETAIL_COUNT_BY_LENGTH: Record<ReviewLength, number> = {
  SHORT: 0,
  MEDIUM: 1,
  DETAILED: 2,
};

/**
 * Assembles a review from the hand-authored content bank. `excludeCombos` tracks
 * opener/detail/closer index combinations already used for this product in the current batch,
 * so a single generation request doesn't produce visibly repeated sentence structure.
 */
export function assembleReview(params: AssembleReviewParams): AssembledReview {
  const { productType, rating, length, brand, excludeCombos, giftRecipient } = params;
  const isGift = Boolean(giftRecipient);
  const tier = ratingToTier(rating);
  const openers = isGift ? GIFT_OPENERS[tier] : OPENERS[tier];
  const details = isGift ? GIFT_DETAILS[tier] : DETAILS[tier];
  const closers = isGift ? GIFT_CLOSERS[tier] : CLOSERS[tier];
  const detailCount = DETAIL_COUNT_BY_LENGTH[length];
  // Brand/USP closers lean on personal-use framing ("I'll be shopping here again"), which reads
  // oddly alongside gift framing, so gift reviews skip straight to the gift closer pool.
  const canUseBrandCloser = !isGift && (tier === "5" || tier === "4") && Boolean(brand?.name);
  // Guards against stale/malformed stored USPs (e.g. multi-line marketing copy pasted into the
  // field before validation caught this) — not just missing ones — since {usp} is spliced
  // verbatim into a short sentence template below.
  const canUseUspCloser = !isGift && (tier === "5" || tier === "4") && Boolean(brand?.usp && isUsableUspPhrase(brand.usp));

  let openerIdx = 0;
  let detailIdxs: number[] = [];
  let useBrandCloser = false;
  let useUspCloser = false;
  let closerIdx = 0;
  let includeCloser = true;
  let comboKey = "";

  function pickCloserPool(): string[] {
    if (useUspCloser) return USP_CLOSERS[tier as "5" | "4"];
    if (useBrandCloser) return BRAND_CLOSERS[tier as "5" | "4"];
    return closers;
  }

  for (let attempt = 0; attempt < 25; attempt++) {
    openerIdx = Math.floor(Math.random() * openers.length);

    detailIdxs = [];
    while (detailIdxs.length < detailCount) {
      const idx = Math.floor(Math.random() * details.length);
      if (!detailIdxs.includes(idx)) detailIdxs.push(idx);
    }

    useUspCloser = canUseUspCloser && Math.random() < 0.35;
    useBrandCloser = !useUspCloser && canUseBrandCloser && Math.random() < 0.4;
    const closerPool = pickCloserPool();
    closerIdx = Math.floor(Math.random() * closerPool.length);
    // Real short reviews often just trail off without a tidy wrap-up sentence — a USP/brand
    // closer is worth keeping (that's the whole point of picking one), but a plain generic closer
    // is skippable, more so for SHORT reviews than longer ones.
    includeCloser = useUspCloser || useBrandCloser || Math.random() >= (length === "SHORT" ? 0.45 : 0.2);

    const closerTag = !includeCloser ? "n" : useUspCloser ? "u" : useBrandCloser ? "b" : "c";
    comboKey = `${isGift ? "gift" : "self"}:${tier}:${length}:${openerIdx}:${detailIdxs.slice().sort().join(",")}:${closerTag}${includeCloser ? closerIdx : ""}`;
    if (!excludeCombos.has(comboKey)) break;
  }

  const vars = {
    productType,
    brandCategory: brand?.category,
    brandName: brand?.name,
    usp: brand?.usp,
    giftRecipient,
  };

  const opener = maybeAddInterjection(fillPlaceholders(openers[openerIdx] as string, vars));
  const detailSentences = detailIdxs.map((idx) => fillPlaceholders(details[idx] as string, vars));
  const closerPool = pickCloserPool();
  const closer = includeCloser ? fillPlaceholders(closerPool[closerIdx] as string, vars) : undefined;

  const content = [opener, ...detailSentences, closer].filter(Boolean).join(" ");
  const title = pick(TITLE_PHRASES[tier]);

  return { title, content, comboKey };
}

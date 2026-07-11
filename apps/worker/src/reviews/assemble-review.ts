import type { ReviewLength } from "@ai-shopify/shared";
import { BRAND_CLOSERS, CLOSERS, DETAILS, OPENERS, ratingToTier, TITLE_PHRASES } from "./content-bank.js";

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function fillPlaceholders(
  phrase: string,
  vars: { productType: string; brandCategory?: string; brandName?: string },
): string {
  return phrase
    .replaceAll("{productType}", vars.productType || "product")
    .replaceAll("{brandCategory}", vars.brandCategory || vars.productType || "this category")
    .replaceAll("{brandName}", vars.brandName || "this shop");
}

export type AssembledReview = { title: string; content: string; comboKey: string };

export type AssembleReviewParams = {
  productType: string;
  rating: number;
  length: ReviewLength;
  brand?: { name?: string; category?: string };
  excludeCombos: Set<string>;
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
  const { productType, rating, length, brand, excludeCombos } = params;
  const tier = ratingToTier(rating);
  const openers = OPENERS[tier];
  const details = DETAILS[tier];
  const closers = CLOSERS[tier];
  const detailCount = DETAIL_COUNT_BY_LENGTH[length];
  const canUseBrandCloser = (tier === "5" || tier === "4") && Boolean(brand?.name);

  let openerIdx = 0;
  let detailIdxs: number[] = [];
  let useBrandCloser = false;
  let closerIdx = 0;
  let comboKey = "";

  for (let attempt = 0; attempt < 25; attempt++) {
    openerIdx = Math.floor(Math.random() * openers.length);

    detailIdxs = [];
    while (detailIdxs.length < detailCount) {
      const idx = Math.floor(Math.random() * details.length);
      if (!detailIdxs.includes(idx)) detailIdxs.push(idx);
    }

    useBrandCloser = canUseBrandCloser && Math.random() < 0.4;
    const closerPool = useBrandCloser ? BRAND_CLOSERS[tier as "5" | "4"] : closers;
    closerIdx = Math.floor(Math.random() * closerPool.length);

    comboKey = `${tier}:${length}:${openerIdx}:${detailIdxs.slice().sort().join(",")}:${useBrandCloser ? "b" : "c"}${closerIdx}`;
    if (!excludeCombos.has(comboKey)) break;
  }

  const vars = { productType, brandCategory: brand?.category, brandName: brand?.name };

  const opener = openers[openerIdx] as string;
  const detailSentences = detailIdxs.map((idx) => fillPlaceholders(details[idx] as string, vars));
  const closerPool = useBrandCloser ? BRAND_CLOSERS[tier as "5" | "4"] : closers;
  const closer = fillPlaceholders(closerPool[closerIdx] as string, vars);

  const content = [opener, ...detailSentences, closer].join(" ");
  const title = pick(TITLE_PHRASES[tier]);

  return { title, content, comboKey };
}

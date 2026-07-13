import type { ReviewLength } from "@ai-shopify/shared";
import {
  BRAND_CLOSERS,
  CLOSERS,
  DETAILS,
  OPENERS,
  ratingToTier,
  TITLE_PHRASES,
  USP_CLOSERS,
} from "./content-bank.js";

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function fillPlaceholders(
  phrase: string,
  vars: { productType: string; brandCategory?: string; brandName?: string; usp?: string },
): string {
  return phrase
    .replaceAll("{productType}", vars.productType || "product")
    .replaceAll("{brandCategory}", vars.brandCategory || vars.productType || "this category")
    .replaceAll("{brandName}", vars.brandName || "this shop")
    .replaceAll("{usp}", vars.usp || "");
}

export type AssembledReview = { title: string; content: string; comboKey: string };

export type AssembleReviewParams = {
  productType: string;
  rating: number;
  length: ReviewLength;
  brand?: { name?: string; category?: string; usp?: string };
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
  const canUseUspCloser = (tier === "5" || tier === "4") && Boolean(brand?.usp);

  let openerIdx = 0;
  let detailIdxs: number[] = [];
  let useBrandCloser = false;
  let useUspCloser = false;
  let closerIdx = 0;
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

    const closerTag = useUspCloser ? "u" : useBrandCloser ? "b" : "c";
    comboKey = `${tier}:${length}:${openerIdx}:${detailIdxs.slice().sort().join(",")}:${closerTag}${closerIdx}`;
    if (!excludeCombos.has(comboKey)) break;
  }

  const vars = { productType, brandCategory: brand?.category, brandName: brand?.name, usp: brand?.usp };

  const opener = openers[openerIdx] as string;
  const detailSentences = detailIdxs.map((idx) => fillPlaceholders(details[idx] as string, vars));
  const closerPool = pickCloserPool();
  const closer = fillPlaceholders(closerPool[closerIdx] as string, vars);

  const content = [opener, ...detailSentences, closer].join(" ");
  const title = pick(TITLE_PHRASES[tier]);

  return { title, content, comboKey };
}

/**
 * Detects a product's likely gendered audience from its title/type text, so reviewer
 * assignment can be skewed toward that gender instead of an arbitrary 50/50 split — a men's
 * chain getting mostly female reviewers (or vice versa) reads as unnatural at review-list scale.
 */

export type AudienceGender = "FEMALE" | "MALE" | "UNISEX";

const FEMALE_PATTERN = /\b(women'?s?|woman|ladies|lady|girls?|female)\b/i;
const MALE_PATTERN = /\b(men'?s?|man|gentlemen|gentleman|guys?|male)\b/i;

export function detectAudienceGender(...texts: Array<string | null | undefined>): AudienceGender {
  const combined = texts.filter(Boolean).join(" ");
  const isFemale = FEMALE_PATTERN.test(combined);
  const isMale = MALE_PATTERN.test(combined);
  if (isFemale && !isMale) return "FEMALE";
  if (isMale && !isFemale) return "MALE";
  return "UNISEX";
}

/** When a reviewer's gender doesn't match the detected product audience, frame the review as a
 * gift rather than personal use — this word fills the "bought this for my ___" phrasing. */
export const FEMALE_GIFT_RECIPIENTS = ["wife", "girlfriend", "mother", "sister", "daughter"];
export const MALE_GIFT_RECIPIENTS = ["husband", "boyfriend", "father", "brother", "son"];

export function pickGiftRecipient(reviewerGender: "MALE" | "FEMALE"): string {
  const pool = reviewerGender === "MALE" ? FEMALE_GIFT_RECIPIENTS : MALE_GIFT_RECIPIENTS;
  return pool[Math.floor(Math.random() * pool.length)] as string;
}

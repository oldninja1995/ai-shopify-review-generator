import { isUsableUspPhrase, type ReviewLength } from "@ai-shopify/shared";
import { fetchWithTimeout } from "../lib/fetch-with-timeout.js";

// Kept deliberately short across all three tiers — real customer reviews are almost always brief,
// and even the "long" tier should read as a slightly fuller quick review, not a paragraph.
const LENGTH_GUIDANCE: Record<ReviewLength, string> = {
  SHORT: "1 short sentence, under 15 words",
  MEDIUM: "1-2 sentences",
  DETAILED: "2-3 sentences, with one specific detail",
};

const PLACEHOLDER_TITLE = "a short review headline, under 8 words";
const PLACEHOLDER_CONTENT = "the full review text";

/** Telltale fragments of a model "thinking out loud" about the instructions instead of just
 * writing the review — if these show up, the response isn't usable as review content. */
const META_COMMENTARY_PATTERNS = [
  /\bwe need to\b/i,
  /\blet'?s craft\b/i,
  /\bmust (be|output|mention|not)\b/i,
  /\bshould (output|mention|reflect)\b/i,
  /\bunder 8 words\b/i,
  /\bjson only\b/i,
  /\bno markdown\b/i,
  /\bfirst[- ]person\b/i,
];

function looksLikeMetaCommentary(text: string): boolean {
  return META_COMMENTARY_PATTERNS.some((pattern) => pattern.test(text));
}

/** Small/free models sometimes ignore the prompt's "entirely positive, no caveats" instruction —
 * catches the concessive/critique phrasing patterns real reviews use for a flaw ("though the X
 * felt a bit small", "aside from...", "only complaint is..."). Deliberately a curated list of
 * fairly specific phrases rather than broad words like "but", to avoid rejecting genuinely
 * positive reviews that happen to contain them. */
const NEGATIVE_LANGUAGE_PATTERNS = [
  /\bthough\b/i,
  /\baside from\b/i,
  /\bexcept for\b/i,
  /\bhowever\b/i,
  /\bdownside\b/i,
  /\bwish (it|this|the)\b/i,
  /\bcould be better\b/i,
  /\bdisappoint/i,
  /\bflaw/i,
  /\blearning curve\b/i,
  /\bnot perfect\b/i,
  /\bonly (issue|complaint|downside|problem|gripe)\b/i,
  /\ba (bit|little) (small|big|tight|loose|flimsy|cheap|thin)\b/i,
  /\bnitpick/i,
  /\bcaveat/i,
];

function containsNegativeLanguage(text: string): boolean {
  return NEGATIVE_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Catches a single "Label: short value" line (e.g. "User Safety: safe") — some models emit a
 * stray classification/moderation-style fragment instead of review prose. Real review text always
 * has sentence punctuation or is at least a few words of ordinary prose, so a short colon-separated
 * label with no sentence punctuation is never a legitimate review. */
function looksLikeLabelFragment(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^[A-Za-z][A-Za-z0-9 /'-]{1,40}:\s*[A-Za-z0-9][A-Za-z0-9 /'-]{0,40}$/.test(trimmed) &&
    !/[.!?]/.test(trimmed)
  );
}

/** Catches leftover template syntax (angle-bracket placeholders) or fragments of unparseable
 * JSON — signs the model didn't actually produce a finished, fillable-in review. */
function looksUnusable(text: string): boolean {
  if (looksLikeMetaCommentary(text)) return true;
  if (containsNegativeLanguage(text)) return true;
  if (looksLikeLabelFragment(text)) return true;
  if (/<your\s/i.test(text)) return true;
  if (/"title"\s*:|"content"\s*:/.test(text)) return true;
  return false;
}

export type AiReviewParams = {
  apiKey: string;
  productTitle: string;
  productType: string;
  brand?: { name?: string; category?: string; usp?: string };
  reviewer: {
    name: string;
    gender: "MALE" | "FEMALE";
    ageGroup: string;
    occupation: string;
    country: string;
  };
  rating: number;
  length: ReviewLength;
  /** Set when the reviewer's own gender doesn't match the product's detected audience (e.g. a
   * male reviewer on a women's chain) — tells the model to frame this as a gift purchase instead
   * of writing as if the reviewer personally uses/wears the product. */
  giftRecipient?: string;
};

/** Injected per call to push each generation toward a different voice/angle — without this,
 * independent model calls (no shared memory across reviews) tend to converge on the same safe,
 * generic "I bought this and love it, [brand name], [occasion]" shape every time, which reads as
 * repetitive even when the exact wording differs. Randomly hints a buyer mindset and what part of
 * the purchase to focus on, without dictating any actual sentence. */
const BUYER_PERSONAS = [
  "an excited buyer who's thrilled and a bit gushing about it",
  "a low-key, matter-of-fact buyer who keeps it short and understated",
  "a repeat customer who's ordered from this shop before",
  "someone buying for a specific event or occasion coming up",
  "someone who bought this as a gift for a family member",
  "a budget-conscious buyer who cares mostly about value for the price",
  "someone who was a bit hesitant or skeptical before ordering, now pleasantly surprised",
  "someone who prefers this over similar things they've bought before",
  "someone focused mainly on how it looks/feels day-to-day",
  "someone who mentions the delivery/unboxing experience",
];

const FOCUS_ANGLES = [
  "first impressions on opening it",
  "how it looks or fits day-to-day",
  "wearing/using it for a specific occasion",
  "a compliment someone else gave them about it",
  "comparing it to something else they've owned",
  "how it matches their existing style",
  "just a quick, general reaction — nothing detailed",
];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

/** Generic phrases that show up constantly in AI-written marketing-flavored review text — banning
 * them by name pushes the model toward more specific, varied language instead of falling back to
 * the same handful of safe stock phrases across every review. */
const BANNED_PHRASES = [
  "absolutely loved",
  "highly recommend",
  "best product ever",
  "value for money",
  "exceeded my expectations",
  "exceeded expectations",
  "worth every penny",
  "five stars",
  "nailed it",
];

function buildPrompt(params: Omit<AiReviewParams, "apiKey">): string {
  const { productTitle, productType, brand, reviewer, rating, length, giftRecipient } = params;

  // A malformed USP (multi-line marketing copy instead of a short phrase) risks the model
  // echoing it verbatim into the review rather than paraphrasing — same guard as the
  // phrase-bank path in assemble-review.ts, so only well-formed USPs reach the prompt.
  const usableUsp = brand?.usp && isUsableUspPhrase(brand.usp) ? brand.usp : undefined;
  const brandContext = brand?.name
    ? `The store/brand is called "${brand.name}"${brand.category ? ` (a ${brand.category} brand)` : ""}.${
        usableUsp ? ` Something that sets this brand apart: this brand ${usableUsp}.` : ""
      }`
    : "";

  const purchaseContext = giftRecipient
    ? `The reviewer bought this as a GIFT for their ${giftRecipient} — do NOT write as if the reviewer personally uses/wears it themselves. Frame the review around the ${giftRecipient}'s reaction (e.g. "bought this for my ${giftRecipient}, and...").`
    : "The reviewer bought this for themselves and uses/wears it personally.";

  return `You are role-playing as a real customer writing a short product review. Output nothing except the review itself, written as that customer would type it — no notes, no explanation, no restating these instructions.

Reviewer persona: ${reviewer.name}, ${reviewer.gender === "MALE" ? "male" : "female"}, ${reviewer.ageGroup}, works as a ${reviewer.occupation}, from ${reviewer.country}. Write as ${pickRandom(BUYER_PERSONAS)}.
Product: "${productTitle}" (a ${productType}).
${brandContext}
${purchaseContext}
Star rating: ${rating}/5.
Length: ${LENGTH_GUIDANCE[length]}.
If it fits naturally, focus mainly on: ${pickRandom(FOCUS_ANGLES)} — but don't force it if it doesn't suit this product.

This review must be entirely positive — do not mention any flaw, complaint, downside, or thing that could be improved, even a minor one (e.g. never write things like "though the clasp felt a bit small" or "aside from a small learning curve"). If the rating is 4 rather than 5, express that only through a slightly calmer, less superlative tone (e.g. "really happy with this" instead of "best purchase ever") — never by naming an actual shortcoming.

Write in first person, casual and human, with the natural imperfections of real reviews (contractions, informal phrasing, imperfect grammar here and there is fine). Refer to the product naturally as "it" or "this ${productType}" rather than repeating its full name — don't mention the brand name in every review, only when it feels natural. Don't start with a generic opener like "I bought this..." or "I recently purchased..." — vary how the review starts. Never state the numeric star rating or say things like "5/5" or "5 stars" inside the review text itself — the rating is tracked separately. Don't use emojis or quotation marks anywhere in the review. Avoid these overused phrases entirely: ${BANNED_PHRASES.join(", ")}.

Respond with ONLY this JSON object, with your actual review text filled in — do not copy these instructions or example wording into your answer:
{"title": "<your headline, under 8 words>", "content": "<your review, ${LENGTH_GUIDANCE[length]}>"}`;
}

function extractJsonReview(raw: string): { title: string; content: string } | null {
  const candidates = [...raw.matchAll(/\{[\s\S]*?\}/g)].map((m) => m[0]);
  // Prefer the last candidate — models that "think out loud" put the real answer at the end.
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as { title?: string; content?: string };
      if (
        parsed.title &&
        parsed.content &&
        parsed.title !== PLACEHOLDER_TITLE &&
        parsed.content !== PLACEHOLDER_CONTENT &&
        parsed.title.trim().toLowerCase() !== parsed.content.trim().toLowerCase() &&
        !looksUnusable(parsed.title) &&
        !looksUnusable(parsed.content)
      ) {
        return { title: parsed.title, content: parsed.content };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function deriveTitleFromContent(content: string): string {
  const firstSentence = content.split(/[.!?\n]/)[0]?.trim();
  const words = (firstSentence || content).split(/\s+/).slice(0, 6).join(" ");
  return words || "Review";
}

/** Calls OpenRouter's chat-completions API with one specific model. Throws on any failure or
 * unusable output — callers move on to the next configured model. */
async function callOpenRouter(
  apiKey: string,
  model: string,
  prompt: string,
  useJsonMode: boolean,
): Promise<Response> {
  return fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 600,
      temperature: 1.0,
      ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
}

async function generateReviewWithModel(
  apiKey: string,
  model: string,
  params: Omit<AiReviewParams, "apiKey">,
): Promise<{ title: string; content: string }> {
  const prompt = buildPrompt(params);
  let response = await callOpenRouter(apiKey, model, prompt, true);

  // Some models (especially free/small ones) reject the response_format parameter — retry
  // without it rather than treating that as a hard failure for this model.
  if (!response.ok) {
    response = await callOpenRouter(apiKey, model, prompt, false);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenRouter request failed for ${model}: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error(`OpenRouter returned no content for ${model}`);

  const jsonReview = extractJsonReview(raw);
  if (jsonReview) return jsonReview;

  // Model ignored the JSON format entirely. Only accept the raw text as a review if it doesn't
  // look like meta-commentary, leftover template syntax, or a truncated/malformed JSON attempt.
  const plainText = raw.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
  if (!plainText || looksUnusable(plainText)) {
    throw new Error(`AI response from ${model} was not a usable review`);
  }
  return { title: deriveTitleFromContent(plainText), content: plainText };
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/** Picks a random model from the store's configured list first (for variety across reviews and
 * to spread load across each free model's rate limit), then falls back through the rest in random
 * order on failure. Throws only once every model has failed — callers then fall back to the
 * phrase-bank generator so a job never hard-fails over this. */
export async function generateReviewWithAI(
  apiKey: string,
  models: string[],
  params: Omit<AiReviewParams, "apiKey">,
): Promise<{ title: string; content: string }> {
  const errors: string[] = [];
  for (const model of shuffled(models)) {
    try {
      return await generateReviewWithModel(apiKey, model, params);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`All configured AI models failed: ${errors.join(" | ")}`);
}

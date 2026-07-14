import type { ReviewLength } from "@ai-shopify/shared";

const LENGTH_GUIDANCE: Record<ReviewLength, string> = {
  SHORT: "1-2 short sentences",
  MEDIUM: "2-4 sentences",
  DETAILED: "4-6 sentences with some specific detail",
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

/** Catches leftover template syntax (angle-bracket placeholders) or fragments of unparseable
 * JSON — signs the model didn't actually produce a finished, fillable-in review. */
function looksUnusable(text: string): boolean {
  if (looksLikeMetaCommentary(text)) return true;
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

function buildPrompt(params: Omit<AiReviewParams, "apiKey">): string {
  const { productTitle, productType, brand, reviewer, rating, length, giftRecipient } = params;

  const brandContext = brand?.name
    ? `The store/brand is called "${brand.name}"${brand.category ? ` (a ${brand.category} brand)` : ""}.${
        brand.usp ? ` Something that sets this brand apart: this brand ${brand.usp}.` : ""
      }`
    : "";

  const purchaseContext = giftRecipient
    ? `The reviewer bought this as a GIFT for their ${giftRecipient} — do NOT write as if the reviewer personally uses/wears it themselves. Frame the review around the ${giftRecipient}'s reaction (e.g. "bought this for my ${giftRecipient}, and...").`
    : "The reviewer bought this for themselves and uses/wears it personally.";

  return `You are role-playing as a real customer writing a short product review. Output nothing except the review itself, written as that customer would type it — no notes, no explanation, no restating these instructions.

Reviewer persona: ${reviewer.name}, ${reviewer.gender === "MALE" ? "male" : "female"}, ${reviewer.ageGroup}, works as a ${reviewer.occupation}, from ${reviewer.country}.
Product: "${productTitle}" (a ${productType}).
${brandContext}
${purchaseContext}
Star rating: ${rating}/5.
Length: ${LENGTH_GUIDANCE[length]}.

Write in first person, casual and human, with the natural imperfections of real reviews (contractions, informal phrasing, imperfect grammar here and there is fine). Refer to the product naturally as "it" or "this ${productType}" rather than repeating its full name.

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
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
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

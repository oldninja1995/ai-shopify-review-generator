import { isUsableUspPhrase, type ReviewLength } from "@ai-shopify/shared";
import { fetchWithTimeout } from "../lib/fetch-with-timeout.js";
import { cohereChat } from "./cohere-adapter.js";
import {
  isModelBlocked,
  noteModelFailure,
  noteModelSuccess,
  noteTokenUsage,
} from "./model-health.js";

/** Upper bound on honouring a 429 retry-after in place. Beyond this it is a daily cap, not a
 * per-minute one, and holding a concurrency slot open for it would stall the batch. */
const MAX_INLINE_RETRY_WAIT_S = 20;

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

/** "openrouter" and "groq" are the built-ins; any other value is the slug of a user-configured
 * OpenAI-compatible provider (see AiProviderCredential). Kept as a plain string because provider
 * capacity is the real constraint on this app, and adding a provider must never require a deploy. */
export type AiProviderName = string;

/** Every configured provider (OpenRouter, Groq, ...) speaks this same OpenAI-compatible
 * chat-completions shape — only the base URL and API key differ. */
export type AiProviderConfig = { name: AiProviderName; baseUrl: string; apiKey: string; models: string[] };

/** Reported once per call attempt, success or failure — a plain, universal signal rather than an
 * estimate. Every provider/model gets identical treatment: did the last real call work or not. */
export type ProviderQuotaEvent = {
  provider: AiProviderName;
  model: string;
  ok: boolean;
  /** Set when ok is false — the error that caused this call to fail. */
  error?: string;
};

/** Calls an OpenAI-compatible chat-completions endpoint with one specific model. Throws on any
 * failure or unusable output — callers move on to the next model/provider. */
async function callChatCompletions(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  useJsonMode: boolean,
): Promise<Response> {
  return fetchWithTimeout(`${baseUrl}/chat/completions`, {
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
  provider: AiProviderName,
  baseUrl: string,
  apiKey: string,
  model: string,
  params: Omit<AiReviewParams, "apiKey">,
  onQuotaInfo?: (event: ProviderQuotaEvent) => void,
): Promise<{ title: string; content: string }> {
  const prompt = buildPrompt(params);

  // Non-OpenAI-compatible providers take a dedicated path but rejoin the shared parsing, cooldown
  // and usage bookkeeping below, so each one stays a single small adapter file. Detected from the
  // base URL rather than a stored column, so adding one needs no migration.
  if (/(^|\.)api\.cohere\.com/.test(baseUrl)) {
    const outcome = await cohereChat(baseUrl, apiKey, model, prompt, 600);
    if (!outcome.ok) {
      noteModelFailure(provider, model, outcome.status, outcome.retryAfter);
      onQuotaInfo?.({ provider, model, ok: false, error: `${outcome.status} ${outcome.body}`.slice(0, 500) });
      throw new Error(`Request failed for ${model}: ${outcome.status} ${outcome.body}`);
    }
    noteModelSuccess(provider, model);
    onQuotaInfo?.({ provider, model, ok: true });
    noteTokenUsage(provider, model, outcome.result.promptTokens, outcome.result.completionTokens);
    return parseReviewOrThrow(outcome.result.content, model);
  }

  let response: Response;
  try {
    response = await callChatCompletions(baseUrl, apiKey, model, prompt, true);
    // Some models (especially free/small ones) reject the response_format parameter — retry
    // without it rather than treating that as a hard failure for this model. Only worth doing for
    // a request the model actually rejected: a 401/402/404/429 says nothing about response_format,
    // so retrying those just doubles the cost of a failure that was never going to succeed.
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      response = await callChatCompletions(baseUrl, apiKey, model, prompt, false);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Timeouts are the expensive failure — 30s of a concurrency slot each. Back this model off so
    // the rest of the batch doesn't queue up behind the same dead endpoint.
    noteModelFailure(provider, model, 0);
    onQuotaInfo?.({ provider, model, ok: false, error: `network error: ${message}` });
    throw error;
  }

  // A 429 with a short retry-after is worth waiting out in place: per-minute limits are the common
  // case and clear in seconds, whereas failing the model over would push the whole batch onto a
  // worse model (or the phrase bank) for a limit that was about to lift. Long waits are not held —
  // that is a daily cap, and the cooldown handles it.
  if (response.status === 429) {
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= MAX_INLINE_RETRY_WAIT_S) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
      response = await callChatCompletions(baseUrl, apiKey, model, prompt, true);
    }
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    const retryAfter = Number(response.headers.get("retry-after"));
    noteModelFailure(provider, model, response.status, Number.isFinite(retryAfter) ? retryAfter : undefined);
    onQuotaInfo?.({ provider, model, ok: false, error: `${response.status} ${errorBody}`.slice(0, 500) });
    throw new Error(`Request failed for ${model}: ${response.status} ${errorBody}`);
  }

  noteModelSuccess(provider, model);
  onQuotaInfo?.({ provider, model, ok: true });

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  // Recorded per provider+model so the real ceiling is visible. Token allowances, not request
  // allowances, are what a bulk run actually exhausts.
  if (data.usage) {
    noteTokenUsage(provider, model, data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0);
  }
  return parseReviewOrThrow(data.choices?.[0]?.message?.content ?? "", model);
}

/** Turns whatever a model returned into a usable review, or throws so the caller moves on to the
 * next model. Shared by the OpenAI-compatible path and every dedicated adapter, so response-shape
 * differences between providers never turn into differences in what counts as a valid review. */
function parseReviewOrThrow(rawContent: string, model: string): { title: string; content: string } {
  const raw = rawContent.trim();
  if (!raw) throw new Error(`No content returned for ${model}`);

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

/** Tries each configured provider in order (e.g. OpenRouter first, then Groq as a fallback once
 * OpenRouter's shared free-tier quota is exhausted) — within a provider, tries models in the exact
 * order the user configured them (see the "Fallback order" picker), only moving to the next one
 * once the current one fails. Throws only once every model on every provider has failed — callers
 * then fall back to the phrase-bank generator so a job never hard-fails over this. */
/** One reviewer's slot in a batched request. */
export type BatchSlot = {
  reviewer: AiReviewParams["reviewer"];
  rating: number;
  length: ReviewLength;
  giftRecipient?: string;
};

/** Shared, per-product half of a batched prompt — the part that would otherwise be re-sent for
 * every single review. */
export type BatchContext = {
  productTitle: string;
  productType: string;
  brand?: AiReviewParams["brand"];
};

/** Asks for several reviews in one call.
 *
 * The instruction block is ~590 tokens and is identical for every review of a product. Sending it
 * once per review means a product needing 55 reviews re-sends ~32,000 tokens of identical rules and
 * spends 55 requests. Batched, that is one copy of the rules and one request per chunk — the request
 * saving is the point when a single rate-limited model is all that is working.
 *
 * Also fixes something the per-review path cannot: independent calls have no knowledge of each
 * other, so they converge on the same safe phrasing (the reason BUYER_PERSONAS exists). In a batch
 * the model can see the siblings it is writing and differentiate them deliberately. */
export function buildBatchPrompt(context: BatchContext, slots: BatchSlot[]): string {
  const { productTitle, productType, brand } = context;
  const usableUsp = brand?.usp && isUsableUspPhrase(brand.usp) ? brand.usp : undefined;
  const brandContext = brand?.name
    ? `The store/brand is called "${brand.name}"${brand.category ? ` (a ${brand.category} brand)` : ""}.${
        usableUsp ? ` Something that sets this brand apart: this brand ${usableUsp}.` : ""
      }`
    : "";

  const roster = slots
    .map((slot, index) => {
      const gift = slot.giftRecipient
        ? ` — bought as a GIFT for their ${slot.giftRecipient}, so write about the ${slot.giftRecipient}'s reaction, not their own use`
        : "";
      return `${index + 1}. ${slot.reviewer.name}, ${slot.reviewer.gender === "MALE" ? "male" : "female"}, ${slot.reviewer.ageGroup}, ${slot.reviewer.occupation}, ${slot.reviewer.country} — ${slot.rating}/5 stars, ${LENGTH_GUIDANCE[slot.length]}, writing as ${pickRandom(BUYER_PERSONAS)}, focusing on ${pickRandom(FOCUS_ANGLES)}${gift}`;
    })
    .join("\n");

  return `You are writing ${slots.length} separate product reviews, each by a different real customer. Output nothing except the reviews themselves — no notes, no explanation, no restating these instructions.

Product: "${productTitle}" (a ${productType}).
${brandContext}

Reviewers (write one review for each, in this order):
${roster}

CRITICAL: these must read like ${slots.length} genuinely different people. Do not reuse sentence structures, openings, or phrasing between them. Vary length, tone, vocabulary and what each person notices. Two reviews that could be swapped for each other are a failure.

Every review must be entirely positive — never mention a flaw, complaint or anything that could be improved, even minor. For a 4-star reviewer express it only through a calmer, less superlative tone, never by naming a shortcoming.

Write in first person, casual and human, with the natural imperfections of real reviews (contractions, informal phrasing, slightly imperfect grammar is fine). Refer to the item as "it" or "this ${productType}" rather than repeating its full name, and only mention the brand where it feels natural. Do not open with "I bought this" or "I recently purchased". Never state a numeric rating inside the text. No emojis, no quotation marks. Avoid these phrases entirely: ${BANNED_PHRASES.join(", ")}.

Respond with ONLY a JSON array of exactly ${slots.length} objects, in reviewer order:
[{"title": "short headline, under 8 words", "content": "the review text"}, ...]`;
}

/** Parses a batched response into per-slot results, aligned by position.
 *
 * Returns nulls rather than throwing for anything unusable — a model returning 9 good reviews out of
 * 12 should yield those 9, with the caller filling the rest individually. Discarding a whole batch
 * over one malformed entry would waste the request that was the reason for batching. */
export function parseBatchResponse(raw: string, expected: number): ({ title: string; content: string } | null)[] {
  const results: ({ title: string; content: string } | null)[] = new Array(expected).fill(null);

  // Models frequently wrap the array in prose or a code fence; take the outermost bracketed span.
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return results;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return results;
  }
  if (!Array.isArray(parsed)) return results;

  for (let i = 0; i < Math.min(expected, parsed.length); i++) {
    const entry = parsed[i] as { title?: unknown; content?: unknown } | null;
    if (!entry || typeof entry !== "object") continue;
    const content = typeof entry.content === "string" ? entry.content.trim() : "";
    if (!content || looksUnusable(content)) continue;
    const title =
      typeof entry.title === "string" && entry.title.trim() && !looksUnusable(entry.title)
        ? entry.title.trim()
        : deriveTitleFromContent(content);
    results[i] = { title, content };
  }
  return results;
}

/** Rejects reviews that are too close to a sibling in the same batch.
 *
 * The content-hash check elsewhere only catches byte-identical duplicates, so "Beautiful pendant,
 * arrived quickly" and "Beautiful bracelet, arrived quickly" both pass it. Within one batch that
 * kind of parallel phrasing is the specific risk of generating many reviews in a single pass, and it
 * would land as a visible cluster on one product page. Anything caught here is nulled and
 * regenerated individually instead. */
export function screenBatchSimilarity(
  batch: ({ title: string; content: string } | null)[],
): ({ title: string; content: string } | null)[] {
  const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  const kept: string[][] = [];

  return batch.map((entry) => {
    if (!entry) return null;
    const words = normalise(entry.content);
    if (words.length === 0) return null;

    const opening = words.slice(0, 4).join(" ");
    for (const previous of kept) {
      if (previous.slice(0, 4).join(" ") === opening) return null;
      const overlap = words.filter((w) => previous.includes(w)).length / words.length;
      if (overlap > 0.7) return null;
    }
    kept.push(words);
    return entry;
  });
}

/** Runs a batched request through the provider chain, with the same cooldown, usage accounting and
 * fallback ordering as a single review. Returns per-slot results; nulls are the caller's to fill. */
export async function generateReviewBatchWithAI(
  providers: AiProviderConfig[],
  context: BatchContext,
  slots: BatchSlot[],
  onQuotaInfo?: (event: ProviderQuotaEvent) => void,
): Promise<({ title: string; content: string } | null)[]> {
  const prompt = buildBatchPrompt(context, slots);
  // Output scales with the batch, unlike a single review — roughly 60 tokens each plus headroom.
  const maxTokens = Math.min(4000, 120 * slots.length);

  for (const provider of providers) {
    for (const model of provider.models) {
      if (isModelBlocked(provider.name, model)) continue;
      try {
        const response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: maxTokens,
            temperature: 1.0,
          }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const retryAfter = Number(response.headers.get("retry-after"));
          noteModelFailure(provider.name, model, response.status, Number.isFinite(retryAfter) ? retryAfter : undefined);
          onQuotaInfo?.({
            provider: provider.name,
            model,
            ok: false,
            error: `${response.status} ${body}`.slice(0, 500),
          });
          continue;
        }

        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        noteModelSuccess(provider.name, model);
        onQuotaInfo?.({ provider: provider.name, model, ok: true });
        if (data.usage) {
          noteTokenUsage(
            provider.name,
            model,
            data.usage.prompt_tokens ?? 0,
            data.usage.completion_tokens ?? 0,
          );
        }

        const parsed = parseBatchResponse(data.choices?.[0]?.message?.content ?? "", slots.length);
        const screened = screenBatchSimilarity(parsed);
        // A response yielding nothing usable is worse than useless — move on rather than reporting
        // success for a batch the caller would have to regenerate in full anyway.
        if (screened.some(Boolean)) return screened;
      } catch (error) {
        noteModelFailure(provider.name, model, 0);
        onQuotaInfo?.({
          provider: provider.name,
          model,
          ok: false,
          error: `network error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  return new Array(slots.length).fill(null);
}

export async function generateReviewWithAI(
  providers: AiProviderConfig[],
  params: Omit<AiReviewParams, "apiKey">,
  onQuotaInfo?: (event: ProviderQuotaEvent) => void,
): Promise<{ title: string; content: string }> {
  const errors: string[] = [];
  let skipped = 0;
  for (const provider of providers) {
    for (const model of provider.models) {
      // Skip anything a recent call already proved unusable. This is what stops every review
      // re-walking the same dead fleet: after the first review of a run, a fully-blocked provider
      // costs zero requests instead of two per model.
      if (isModelBlocked(provider.name, model)) {
        skipped++;
        continue;
      }
      try {
        return await generateReviewWithModel(provider.name, provider.baseUrl, provider.apiKey, model, params, onQuotaInfo);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  throw new Error(
    skipped > 0 && errors.length === 0
      ? `All ${skipped} configured AI models are in cooldown after recent failures`
      : `All configured AI models failed: ${errors.join(" | ")}${skipped > 0 ? ` (+${skipped} skipped, in cooldown)` : ""}`,
  );
}

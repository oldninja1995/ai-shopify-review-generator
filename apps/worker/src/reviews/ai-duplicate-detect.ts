export type DuplicateCandidate = { id: string; content: string };
export type DetectedDuplicate = { reviewId: string; matchedReviewId: string };

function buildPrompt(reviews: DuplicateCandidate[]): string {
  const numbered = reviews
    .map((review, index) => `${index + 1}. "${review.content.replaceAll('"', "'")}"`)
    .join("\n");

  return `You are checking a list of product reviews for the SAME product for duplicate or near-duplicate content — reviews that say essentially the same thing, even if reworded differently.

Reviews, in the order they were written:
${numbered}

For each review AFTER the first that is a duplicate or near-duplicate in MEANING of an earlier review in this list (not just similar length or rating — actually restating the same point/experience), report its number and which earlier number it duplicates. Different reviews that happen to be positive/short/about the same product are normal and should NOT be flagged just because they're similar in tone. Only flag genuine restatements.

Respond with ONLY this JSON object, nothing else:
{"duplicates": [{"index": <number>, "duplicateOfIndex": <number>}]}
If there are no duplicates, respond with {"duplicates": []}.`;
}

/** Same red-flag heuristic as ai-generate.ts's looksUnusable — small/free models sometimes emit
 * reasoning text or leftover template syntax instead of following the JSON instruction. */
function looksLikeMetaCommentary(text: string): boolean {
  return /\bwe need to\b|\blet'?s (check|analyze)\b|\bmust (be|output)\b|\bjson only\b/i.test(text);
}

/** Finds balanced top-level {...} substrings by brace-counting rather than regex — the response
 * JSON here is nested ({"duplicates": [{"index":..}]}), and a naive non-greedy regex match stops
 * at the FIRST closing brace (the inner object), producing truncated, unparseable JSON. */
function extractBalancedJsonObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return results;
}

function parseDuplicatesResponse(raw: string, reviewCount: number): { index: number; duplicateOfIndex: number }[] | null {
  const candidates = extractBalancedJsonObjects(raw);
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as { duplicates?: unknown };
      if (!Array.isArray(parsed.duplicates)) continue;
      if (looksLikeMetaCommentary(raw)) return null;

      const pairs: { index: number; duplicateOfIndex: number }[] = [];
      for (const entry of parsed.duplicates) {
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as { index?: unknown }).index === "number" &&
          typeof (entry as { duplicateOfIndex?: unknown }).duplicateOfIndex === "number"
        ) {
          const index = (entry as { index: number }).index;
          const duplicateOfIndex = (entry as { duplicateOfIndex: number }).duplicateOfIndex;
          // Sanity-bound against the model inventing indices outside the actual list, or flagging
          // something as a duplicate of itself or of something written later than it.
          if (
            index >= 1 &&
            index <= reviewCount &&
            duplicateOfIndex >= 1 &&
            duplicateOfIndex <= reviewCount &&
            duplicateOfIndex < index
          ) {
            pairs.push({ index, duplicateOfIndex });
          }
        }
      }
      return pairs;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function callOpenRouter(apiKey: string, model: string, prompt: string): Promise<string | null> {
  // Without a timeout, one hung request stalls the whole concurrent batch it's part of (and thus
  // the entire job — see runAiCheck) since it's awaited via Promise.all. A generous 30s covers slow
  // models without leaving the job frozen indefinitely on a dropped connection.
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/** Detects near-duplicate review content within ONE product's review set using the store's
 * configured AI models — one call per product rather than pairwise, keeping cost proportional to
 * product count rather than review-pair count. Returns null (never throws) on total failure so
 * the caller can fall back to exact-hash matching for this product, per the app's existing
 * "never hard-fail on AI unavailability" pattern (see ai-generate.ts). */
// Free-tier OpenRouter models are frequently rate-limited or unresponsive. With ~30 configured
// models, trying them one at a time (each paying the full request timeout before falling through)
// made a single product's check take minutes in the worst case. Racing a handful concurrently and
// taking whichever answers first bounds per-product latency to ~one timeout instead of N of them.
const MAX_MODEL_ATTEMPTS = 3;

export async function detectAiDuplicates(
  apiKey: string,
  models: string[],
  reviews: DuplicateCandidate[],
): Promise<DetectedDuplicate[] | null> {
  if (reviews.length < 2) return [];

  const prompt = buildPrompt(reviews);
  const candidates = shuffled(models).slice(0, MAX_MODEL_ATTEMPTS);
  const attempts = await Promise.all(
    candidates.map(async (model) => {
      try {
        const raw = await callOpenRouter(apiKey, model, prompt);
        if (!raw) return null;
        return parseDuplicatesResponse(raw, reviews.length);
      } catch {
        return null;
      }
    }),
  );

  const pairs = attempts.find((result) => result !== null) ?? null;
  if (pairs === null) return null;
  return pairs.map(({ index, duplicateOfIndex }) => ({
    reviewId: reviews[index - 1]!.id,
    matchedReviewId: reviews[duplicateOfIndex - 1]!.id,
  }));
}

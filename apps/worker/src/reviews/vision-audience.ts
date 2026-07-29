import type { AudienceGender } from "@ai-shopify/shared";
import { fetchWithTimeout } from "../lib/fetch-with-timeout.js";
import { isModelBlocked, noteModelFailure, noteModelSuccess } from "./model-health.js";

type OpenRouterModel = {
  id: string;
  architecture?: { input_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
};

const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
let cachedVisionModels: { fetchedAt: number; models: string[] } | null = null;

/** Set when a full sweep of vision models finds none usable — suppresses the whole feature for a
 * while rather than repeating the sweep for every product in a bulk run. */
let visionUnavailableUntil = 0;
const VISION_UNAVAILABLE_COOLDOWN_MS = 10 * 60 * 1000;

/** Vision-capable models aren't part of the store's own configured text-generation model list
 * (those are picked for review-writing quality, not guaranteed to support images) — this queries
 * OpenRouter's public model list live and filters for image input support, rather than hardcoding
 * specific model IDs that could stop existing or change pricing over time.
 *
 * Free `:free` models tried first, but they're heavily oversubscribed across all of OpenRouter's
 * users (observed 429s on every free vision model in testing) — falls back to the cheapest paid
 * vision models after that. This only ever runs once per product (cached on Product.detectedAudience
 * after a successful result), so even an all-paid fallback costs a fraction of a cent per product,
 * not per review. */
async function getVisionCapableModels(): Promise<string[]> {
  if (cachedVisionModels && Date.now() - cachedVisionModels.fetchedAt < MODEL_CACHE_TTL_MS) {
    return cachedVisionModels.models;
  }

  const response = await fetchWithTimeout("https://openrouter.ai/api/v1/models", {}, 15_000).catch(() => null);
  if (!response || !response.ok) return cachedVisionModels?.models ?? [];

  const body = (await response.json()) as { data?: OpenRouterModel[] };
  const visionCapable = (body.data ?? []).filter((m) => {
    const prompt = Number(m.pricing?.prompt);
    // Excludes meta-routers like "openrouter/auto" (pricing -1, not a deterministic model) and
    // anything with unparseable pricing.
    return m.architecture?.input_modalities?.includes("image") && Number.isFinite(prompt) && prompt >= 0;
  });

  const free = visionCapable.filter((m) => m.pricing?.prompt === "0" && m.pricing?.completion === "0");
  const paid = visionCapable
    .filter((m) => !(m.pricing?.prompt === "0" && m.pricing?.completion === "0"))
    .sort((a, b) => Number(a.pricing?.prompt) - Number(b.pricing?.prompt));

  const visionModels = [...free, ...paid].map((m) => m.id);
  cachedVisionModels = { fetchedAt: Date.now(), models: visionModels };
  return visionModels;
}

const VALID_AUDIENCES: AudienceGender[] = ["MALE", "FEMALE", "UNISEX"];

function parseAudience(raw: string): AudienceGender | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { audience?: string };
      const upper = parsed.audience?.toUpperCase();
      if (upper && VALID_AUDIENCES.includes(upper as AudienceGender)) return upper as AudienceGender;
    } catch {
      // fall through to plain-text scan below
    }
  }
  const upperRaw = raw.toUpperCase();
  const found = VALID_AUDIENCES.find((a) => upperRaw.includes(a));
  return found ?? null;
}

async function tryModel(apiKey: string, model: string, imageUrl: string): Promise<AudienceGender | null> {
  const response = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Look at this product photo. Based on its styling, is this product most likely marketed toward men, women, or is it unisex/gender-neutral? " +
                'Respond with ONLY this JSON, nothing else: {"audience": "MALE"} or {"audience": "FEMALE"} or {"audience": "UNISEX"}. ' +
                "If you're unsure or the image doesn't give a clear signal, respond with UNISEX.",
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 50,
      temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter vision request failed for ${model}: ${response.status}`);

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error(`OpenRouter returned no content for ${model}`);

  const audience = parseAudience(raw);
  if (!audience) throw new Error(`Unparseable vision response from ${model}: ${raw.slice(0, 100)}`);
  return audience;
}

/** Analyzes a product's primary image to judge its likely gendered audience — supplements the
 * fast title-text heuristic (detectAudienceGender) for products whose name alone doesn't give it
 * away (e.g. a plain "Chain" with no gendered word in it, but styled in a clearly feminine or
 * masculine way). Returns null on any failure (no vision models available, all attempts failed,
 * no image) — callers fall back to the text heuristic rather than blocking generation on this. */
export async function analyzeProductAudienceFromImage(
  apiKey: string,
  imageUrl: string,
): Promise<AudienceGender | null> {
  // Product.detectedAudience caches a *successful* analysis, so when vision is failing outright
  // nothing is ever cached and every product in a 5,000-product run pays the full 10-model walk
  // again for a result that cannot come. This backs the whole feature off for a few minutes once a
  // sweep finds nothing usable, which is the difference between ~10 doomed HTTP calls per product
  // and ~10 per cooldown window.
  if (Date.now() < visionUnavailableUntil) return null;

  const models = await getVisionCapableModels();
  if (models.length === 0) return null;

  // Higher cap than the text-generation retry chain — free vision models are frequently
  // rate-limited (see comment on getVisionCapableModels), so this needs enough attempts to
  // actually fall through into the paid tier rather than giving up while still among free options.
  const candidates = models.slice(0, 10).filter((model) => !isModelBlocked("openrouter", model));
  if (candidates.length === 0) {
    visionUnavailableUntil = Date.now() + VISION_UNAVAILABLE_COOLDOWN_MS;
    return null;
  }

  for (const model of candidates) {
    try {
      const result = await tryModel(apiKey, model, imageUrl);
      noteModelSuccess("openrouter", model);
      return result;
    } catch (error) {
      // tryModel throws with the status embedded in its message; pull it out so a 402/404 backs off
      // for an hour while a 429 retries in ten minutes.
      const status = Number(/\b(\d{3})\b\s*$/.exec(String(error))?.[1] ?? 0);
      noteModelFailure("openrouter", model, status);
      console.error(`[vision-audience] model ${model} failed:`, error);
    }
  }

  visionUnavailableUntil = Date.now() + VISION_UNAVAILABLE_COOLDOWN_MS;
  return null;
}

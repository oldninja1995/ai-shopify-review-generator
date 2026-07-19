import { z } from "zod";

export const aiSettingsSchema = z.object({
  apiKey: z.string().trim().min(1).optional(),
  models: z.array(z.string().trim().min(1)).min(1, "Select at least one model"),
  enabled: z.boolean(),
  visionAudienceEnabled: z.boolean().optional().default(false),
  // Skip a review instead of falling back to the phrase-bank generator once every configured AI
  // provider fails (e.g. daily capacity exhausted). Off by default.
  aiOnlyMode: z.boolean().optional().default(false),
  // Fallback provider, tried after every OpenRouter model fails. Optional — OpenRouter alone is
  // still a valid configuration.
  groqApiKey: z.string().trim().min(1).optional(),
  groqModels: z.array(z.string().trim().min(1)).optional().default([]),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

export type OpenRouterModelOption = {
  id: string;
  name: string;
  isFree: boolean;
};

/** Groq's model-list API requires an existing API key to call, so unlike OpenRouter's public
 * catalog it can't be fetched live for the picker before a key has been saved — hand-maintained
 * against Groq's small, stable set of production (non-preview) chat models instead. All Groq
 * models are usable on their free tier. */
export const GROQ_MODEL_OPTIONS: OpenRouterModelOption[] = [
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", isFree: true },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", isFree: true },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", isFree: true },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", isFree: true },
];

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

/** Ready-made base URLs for OpenAI-compatible providers worth stacking alongside OpenRouter and
 * Groq. Each is a separate account with its own quota — which is the only thing that raises real
 * throughput, since OpenRouter's free models all draw on one account-wide daily allowance.
 *
 * Suggested models are starting points, not a validated list: free tiers and model ids change
 * often, so the form lets you type any id rather than restricting you to these. */
export const AI_PROVIDER_PRESETS: {
  slug: string;
  label: string;
  baseUrl: string;
  suggestedModels: string[];
  note: string;
}[] = [
  {
    slug: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    suggestedModels: ["llama3.1-8b", "llama-3.3-70b"],
    note: "Large free daily allowance and very fast on short outputs.",
  },
  {
    slug: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    suggestedModels: ["gemini-2.0-flash", "gemini-2.0-flash-lite"],
    note: "AI Studio key. Generous free tier via the OpenAI-compatible endpoint.",
  },
  {
    slug: "sambanova",
    label: "SambaNova",
    baseUrl: "https://api.sambanova.ai/v1",
    suggestedModels: ["Meta-Llama-3.3-70B-Instruct", "Meta-Llama-3.1-8B-Instruct"],
    note: "Free tier, fast Llama models.",
  },
  {
    slug: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    suggestedModels: ["deepseek-chat"],
    note: "Paid but very cheap at bulk scale — no rate ceiling to work around.",
  },
  {
    slug: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    suggestedModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    note: "Some free models plus a cheap paid tier.",
  },
];

export const aiProviderCredentialSchema = z.object({
  label: z.string().trim().min(1, "Name is required").max(40),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes only"),
  baseUrl: z
    .string()
    .trim()
    .url("Enter the full API base URL")
    // The client appends /chat/completions, so a trailing slash would produce a double slash.
    .transform((value) => value.replace(/\/+$/, "")),
  /** Omitted on update to keep the stored key — same convention as the OpenRouter/Groq fields. */
  apiKey: z.string().trim().min(1).optional(),
  models: z.array(z.string().trim().min(1)).max(50).default([]),
  enabled: z.boolean().default(true),
});
export type AiProviderCredentialInput = z.infer<typeof aiProviderCredentialSchema>;

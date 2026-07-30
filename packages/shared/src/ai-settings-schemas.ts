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
export type AiProviderPreset = {
  slug: string;
  label: string;
  baseUrl: string;
  suggestedModels: string[];
  note: string;
  /** Whether GET {baseUrl}/models works, so the form can offer live model discovery instead of
   * relying on the hand-written suggestions (which go stale as providers rename ids). */
  supportsModelList: boolean;
  /** Set when the provider does NOT speak the OpenAI chat-completions shape and therefore needs its
   * own adapter in the worker. Everything else runs through the one generic client. */
  adapter?: "cohere";
};

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    slug: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
    note: "AI Studio key. Among the largest free daily request allowances. Flash-Lite is cheapest per review.",
    supportsModelList: true,
  },
  {
    slug: "groq-extra",
    label: "Groq (additional models)",
    baseUrl: "https://api.groq.com/openai/v1",
    suggestedModels: [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "meta-llama/llama-4-maverick-17b-128e-instruct",
      "qwen/qwen3-32b",
      "deepseek-r1-distill-llama-70b",
    ],
    note: "Only needed for models beyond the four in the Groq section above — same key, same quota.",
    supportsModelList: true,
  },
  {
    slug: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    suggestedModels: ["llama-3.3-70b", "qwen-3-32b", "llama3.1-8b"],
    note: "Large free token allowance and very fast on short outputs — a good default for bulk runs.",
    supportsModelList: true,
  },
  {
    slug: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
    note: "Paid but very cheap at bulk scale, with no free-tier ceiling to work around.",
    supportsModelList: true,
  },
  {
    slug: "mistral",
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    suggestedModels: ["mistral-small-latest", "mistral-medium-latest", "magistral-small-latest"],
    note: "Free tier available. Prefer the -latest aliases; bare names like 'mistral-small' are often rejected.",
    supportsModelList: true,
  },
  {
    slug: "zhipu",
    label: "Zhipu AI (GLM)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    suggestedModels: ["glm-4.5-flash", "glm-4.5-air", "glm-4.5"],
    note: "GLM-4.5-Flash is the free tier. OpenAI-compatible endpoint.",
    supportsModelList: false,
  },
  {
    slug: "nvidia",
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    suggestedModels: [
      "meta/llama-3.3-70b-instruct",
      "deepseek-ai/deepseek-r1",
      "nvidia/llama-3.3-nemotron-super-49b-v1",
    ],
    note: "Free credits on build.nvidia.com. Model ids are namespaced by vendor.",
    supportsModelList: true,
  },
  {
    slug: "github-models",
    label: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    suggestedModels: ["openai/gpt-4o-mini", "microsoft/Phi-4", "meta/Llama-3.3-70B-Instruct"],
    note: "Uses a GitHub personal access token with the models scope. Rate limits are per-account and fairly tight.",
    supportsModelList: true,
  },
  {
    slug: "huggingface",
    label: "Hugging Face Inference",
    baseUrl: "https://router.huggingface.co/v1",
    suggestedModels: [
      "meta-llama/Llama-3.3-70B-Instruct",
      "Qwen/Qwen3-32B",
      "mistralai/Mistral-7B-Instruct-v0.3",
      "deepseek-ai/DeepSeek-R1",
    ],
    note: "The router endpoint is OpenAI-compatible. Availability varies by model and provider backing it.",
    supportsModelList: true,
  },
  {
    slug: "sambanova",
    label: "SambaNova",
    baseUrl: "https://api.sambanova.ai/v1",
    suggestedModels: ["Meta-Llama-3.3-70B-Instruct", "Meta-Llama-3.1-8B-Instruct"],
    note: "Free tier, fast Llama models.",
    supportsModelList: true,
  },
  {
    slug: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    suggestedModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    note: "Some free models plus a cheap paid tier.",
    supportsModelList: true,
  },
  {
    slug: "cohere",
    label: "Cohere",
    baseUrl: "https://api.cohere.com/v2",
    suggestedModels: ["command-a-03-2025", "command-r-plus-08-2024", "command-r-08-2024"],
    note: "Not OpenAI-compatible — routed through a dedicated adapter. Trial keys are rate limited but free.",
    supportsModelList: true,
    adapter: "cohere",
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

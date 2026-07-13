import type { OpenRouterModelOption } from "@ai-shopify/shared";

type OpenRouterApiModel = {
  id: string;
  name: string;
  pricing?: { prompt?: string; completion?: string };
};

export async function fetchOpenRouterModels(): Promise<OpenRouterModelOption[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    next: { revalidate: 3600 },
  }).catch(() => null);

  if (!response || !response.ok) return [];

  const body = (await response.json()) as { data?: OpenRouterApiModel[] };
  return (body.data ?? [])
    .map((m) => ({
      id: m.id,
      name: m.name,
      isFree: m.pricing?.prompt === "0" && m.pricing?.completion === "0",
    }))
    .sort((a, b) => {
      if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

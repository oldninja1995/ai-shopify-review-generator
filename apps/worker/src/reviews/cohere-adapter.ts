import { fetchWithTimeout } from "../lib/fetch-with-timeout.js";

/** Cohere is the one provider on the supported list that does not speak OpenAI's chat-completions
 * shape, so it gets a real adapter rather than the generic client.
 *
 * The differences that matter: the endpoint is /chat rather than /chat/completions, the reply text
 * lives under message.content[] as typed blocks instead of choices[0].message.content, and usage is
 * reported as usage.tokens.{input,output} rather than usage.{prompt,completion}_tokens.
 *
 * Everything else — cooldowns, fallback ordering, token accounting — is handled by the shared code
 * paths, so adding a non-compatible provider stays a single small file. */
export type CohereChatResult = {
  content: string;
  promptTokens: number;
  completionTokens: number;
};

type CohereResponse = {
  message?: { content?: { type?: string; text?: string }[] };
  usage?: { tokens?: { input_tokens?: number; output_tokens?: number } };
};

export async function cohereChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number,
): Promise<{ ok: true; result: CohereChatResult } | { ok: false; status: number; body: string; retryAfter?: number }> {
  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, "")}/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 1.0,
    }),
  });

  if (!response.ok) {
    const retryAfterRaw = Number(response.headers.get("retry-after"));
    return {
      ok: false,
      status: response.status,
      body: (await response.text().catch(() => "")).slice(0, 500),
      retryAfter: Number.isFinite(retryAfterRaw) ? retryAfterRaw : undefined,
    };
  }

  const data = (await response.json()) as CohereResponse;
  // content is an array of typed blocks; only the text ones carry the reply.
  const content = (data.message?.content ?? [])
    .filter((block) => !block.type || block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();

  return {
    ok: true,
    result: {
      content,
      promptTokens: data.usage?.tokens?.input_tokens ?? 0,
      completionTokens: data.usage?.tokens?.output_tokens ?? 0,
    },
  };
}

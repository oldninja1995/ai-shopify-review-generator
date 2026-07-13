import type { ApiResult } from "@ai-shopify/shared";

async function toApiResult<T>(response: Response): Promise<ApiResult<T>> {
  if (!response.ok) {
    const parsed = await response.json().catch(() => null);
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      return parsed as ApiResult<T>;
    }
    return {
      success: false,
      error: { message: `Request failed (${response.status})`, code: "REQUEST_FAILED" },
    };
  }
  return (await response.json()) as ApiResult<T>;
}

export async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return toApiResult<T>(response);
}

export async function patchJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return toApiResult<T>(response);
}

export async function putJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return toApiResult<T>(response);
}

export async function deleteJson<T>(url: string): Promise<ApiResult<T>> {
  const response = await fetch(url, { method: "DELETE" });
  return toApiResult<T>(response);
}

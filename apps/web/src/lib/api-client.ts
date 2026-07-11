import type { ApiResult } from "@ai-shopify/shared";

export async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as ApiResult<T>;
}

export async function patchJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as ApiResult<T>;
}

export async function putJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as ApiResult<T>;
}

export async function deleteJson<T>(url: string): Promise<ApiResult<T>> {
  const response = await fetch(url, { method: "DELETE" });
  return (await response.json()) as ApiResult<T>;
}

const SHOPIFY_API_VERSION = "2025-01";
const PAGE_SIZE = 250;

type ShopifyPage<T> = { items: T[]; nextPageInfo: string | null };

async function shopifyGet<T>(
  shop: string,
  accessToken: string,
  path: string,
  key: string,
  searchParams: Record<string, string>,
): Promise<ShopifyPage<T>> {
  const url = new URL(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}${path}`);
  for (const [name, value] of Object.entries(searchParams)) {
    url.searchParams.set(name, value);
  }

  const response = await fetch(url, {
    headers: { "X-Shopify-Access-Token": accessToken },
  });

  if (!response.ok) {
    throw new Error(`Shopify API error ${response.status} for ${path}: ${await response.text()}`);
  }

  const body = (await response.json()) as Record<string, T[]>;
  const items = body[key] ?? [];

  const link = response.headers.get("link");
  const nextUrl = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  const nextPageInfo = nextUrl ? new URL(nextUrl).searchParams.get("page_info") : null;

  return { items, nextPageInfo };
}

/** Follows Shopify's cursor-based `Link` pagination until every page has been fetched. */
export async function fetchAllPages<T>(
  shop: string,
  accessToken: string,
  path: string,
  key: string,
): Promise<T[]> {
  const results: T[] = [];
  let pageInfo: string | null = null;

  do {
    const params: Record<string, string> = { limit: String(PAGE_SIZE) };
    if (pageInfo) params.page_info = pageInfo;
    const page = await shopifyGet<T>(shop, accessToken, path, key, params);
    results.push(...page.items);
    pageInfo = page.nextPageInfo;
  } while (pageInfo);

  return results;
}

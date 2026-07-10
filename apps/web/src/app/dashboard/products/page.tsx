import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma, type Prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ConnectStoreForm } from "@/components/dashboard/connect-store-form";
import { SyncButton } from "@/components/dashboard/sync-button";
import { ProductsTable, type ProductRow } from "@/components/dashboard/products-table";
import { ProductsFilters } from "@/components/dashboard/products-filters";
import { cn } from "@/lib/utils";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_shop: "Enter a valid Shopify store domain.",
  invalid_callback: "Shopify's response could not be verified. Please try connecting again.",
  state_mismatch: "The connection request expired. Please try connecting again.",
  already_connected: "That store is already connected to a different account.",
  shopify_not_configured: "Shopify isn't configured on this deployment yet. Add SHOPIFY_API_KEY and SHOPIFY_API_SECRET, then try again.",
};

const PAGE_SIZE = 50;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    connected?: string;
    page?: string;
    q?: string;
    type?: string;
    collection?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { error, connected, page: pageParam, q, type, collection } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });

  const baseWhere: Prisma.ProductWhereInput = store
    ? {
        storeId: store.id,
        ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
        ...(type ? { productType: type } : {}),
      }
    : { storeId: "" };
  const where: Prisma.ProductWhereInput = {
    ...baseWhere,
    ...(collection ? { collections: { some: { collectionId: collection } } } : {}),
  };

  const [totalCount, categoryRows, collections] = store
    ? await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where: { storeId: store.id },
          select: { productType: true },
          distinct: ["productType"],
        }),
        prisma.collection.findMany({ where: { storeId: store.id }, orderBy: { title: "asc" } }),
      ])
    : [0, [], []];

  const categories = categoryRows
    .map((p) => p.productType)
    .filter((t): t is string => Boolean(t))
    .sort((a, b) => a.localeCompare(b))
    .map((t) => ({ value: t, label: t }));
  const collectionOptions = collections.map((c) => ({
    value: c.id,
    label: c.sortOrder === "best-selling" ? `${c.title} (Best Selling)` : c.title,
  }));

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const productInclude = {
    images: { orderBy: { position: "asc" as const }, take: 1 },
    _count: { select: { variants: true } },
  } satisfies Prisma.ProductInclude;

  function mapProduct(product: {
    id: string;
    title: string;
    productType: string;
    status: string;
    _count: { variants: number };
    images: { url: string }[];
  }): ProductRow {
    return {
      id: product.id,
      title: product.title,
      productType: product.productType,
      status: product.status,
      variantCount: product._count.variants,
      imageUrl: product.images[0]?.url ?? null,
    };
  }

  let products: ProductRow[] = [];
  if (store && collection) {
    // Ordering by position within a specific collection requires querying from the join table
    // directly — Prisma can't `orderBy` a to-many relation's field conditioned on which related
    // row matches a filter. This preserves Shopify's own collection order (e.g. "best-selling"),
    // which we capture during sync instead of discarding it.
    const rows = await prisma.productCollection.findMany({
      where: { collectionId: collection, product: baseWhere },
      include: { product: { include: productInclude } },
      orderBy: { position: "asc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    products = rows.map((row) => mapProduct(row.product));
  } else if (store) {
    const rows = await prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    products = rows.map(mapProduct);
  }

  const filterQuery = new URLSearchParams();
  if (q) filterQuery.set("q", q);
  if (type) filterQuery.set("type", type);
  if (collection) filterQuery.set("collection", collection);
  const filterQueryString = filterQuery.toString();

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams(filterQueryString);
    params.set("page", String(targetPage));
    return `/dashboard/products?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        {store && <SyncButton />}
      </div>

      {error && ERROR_MESSAGES[error] && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {ERROR_MESSAGES[error]}
        </div>
      )}
      {connected && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
          Store connected — the first product sync is running now.
        </div>
      )}

      {!store ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connect your Shopify store</CardTitle>
            <CardDescription>
              Import products, images, descriptions, collections, tags, and variants from your
              store.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectStoreForm />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex items-center justify-between pt-1 text-sm">
              <div>
                <p className="font-medium">{store.shopDomain}</p>
                <p className="text-muted-foreground">
                  {store.lastSyncedAt
                    ? `Last synced ${store.lastSyncedAt.toLocaleString()}`
                    : "Sync in progress — this can take a minute"}
                </p>
              </div>
              <Badge variant={store.lastSyncedAt ? "secondary" : "outline"}>
                {store.lastSyncedAt ? "Synced" : "Syncing"}
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <ProductsFilters categories={categories} collections={collectionOptions} />
            <CardContent className="p-0">
              {products.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {q || type || collection
                    ? "No products match these filters."
                    : "No products synced yet."}
                </p>
              ) : (
                <ProductsTable products={products} />
              )}
            </CardContent>
            {totalCount > 0 && (
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
                <span>
                  Page {currentPage} of {totalPages} — {totalCount} products
                </span>
                <div className="flex gap-2">
                  <Link
                    href={pageHref(currentPage - 1)}
                    aria-disabled={currentPage <= 1}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      currentPage <= 1 && "pointer-events-none opacity-50",
                    )}
                  >
                    Previous
                  </Link>
                  <Link
                    href={pageHref(currentPage + 1)}
                    aria-disabled={currentPage >= totalPages}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      currentPage >= totalPages && "pointer-events-none opacity-50",
                    )}
                  >
                    Next
                  </Link>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

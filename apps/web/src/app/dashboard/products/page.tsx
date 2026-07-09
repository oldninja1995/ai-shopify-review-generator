import { redirect } from "next/navigation";
import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConnectStoreForm } from "@/components/dashboard/connect-store-form";
import { SyncButton } from "@/components/dashboard/sync-button";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_shop: "Enter a valid Shopify store domain.",
  invalid_callback: "Shopify's response could not be verified. Please try connecting again.",
  state_mismatch: "The connection request expired. Please try connecting again.",
  already_connected: "That store is already connected to a different account.",
  shopify_not_configured: "Shopify isn't configured on this deployment yet. Add SHOPIFY_API_KEY and SHOPIFY_API_SECRET, then try again.",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { error, connected } = await searchParams;

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });

  const products = store
    ? await prisma.product.findMany({
        where: { storeId: store.id },
        include: {
          images: { orderBy: { position: "asc" }, take: 1 },
          variants: true,
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

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
            <CardContent className="p-0">
              {products.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No products synced yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Variants</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="flex items-center gap-3">
                          {product.images[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={product.images[0].url}
                              alt={product.title}
                              className="size-8 rounded object-cover"
                            />
                          ) : (
                            <div className="size-8 rounded bg-muted" />
                          )}
                          <span className="font-medium">{product.title}</span>
                        </TableCell>
                        <TableCell>{product.productType || "—"}</TableCell>
                        <TableCell>{product.variants.length}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{product.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

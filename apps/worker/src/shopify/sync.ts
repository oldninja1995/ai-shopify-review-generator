import { prisma } from "@ai-shopify/db";
import { decryptSecret } from "@ai-shopify/shared";
import { env } from "../env.js";
import { fetchAllPages } from "./rest-client.js";
import { logSystemEvent } from "../logging.js";
import type { ShopifyCollection, ShopifyProduct, ShopifyProductVariant } from "./types.js";

const DELETE_CHUNK_SIZE = 3000;
// If more than this fraction of existing products/collections look "missing" from what Shopify
// just returned, treat it as a probable partial/incomplete fetch rather than real deletions and
// skip removing anything — this project has hit a real mass-deletion incident before from
// deleting based on an assumption that didn't hold at real-world scale/reliability, so this
// reconciliation step refuses to fire on a suspiciously large apparent drop.
const MAX_SAFE_DROP_RATIO = 0.5;
const MIN_COUNT_FOR_SAFETY_CHECK = 10;

async function deleteInChunks(ids: string[], deleteFn: (chunk: string[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
    await deleteFn(ids.slice(i, i + DELETE_CHUNK_SIZE));
  }
}

function parseTags(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseVariantOptions(variant: ShopifyProductVariant): Record<string, string> {
  const options: Record<string, string> = {};
  if (variant.option1) options.option1 = variant.option1;
  if (variant.option2) options.option2 = variant.option2;
  if (variant.option3) options.option3 = variant.option3;
  return options;
}

export async function syncShopifyStore(storeId: string): Promise<void> {
  const store = await prisma.shopifyStore.findUniqueOrThrow({ where: { id: storeId } });
  const accessToken = decryptSecret(store.accessTokenEncrypted, env.ENCRYPTION_KEY);

  const [products, customCollections, smartCollections] = await Promise.all([
    fetchAllPages<ShopifyProduct>(store.shopDomain, accessToken, "/products.json", "products"),
    fetchAllPages<ShopifyCollection>(
      store.shopDomain,
      accessToken,
      "/custom_collections.json",
      "custom_collections",
    ),
    fetchAllPages<ShopifyCollection>(
      store.shopDomain,
      accessToken,
      "/smart_collections.json",
      "smart_collections",
    ),
  ]);

  for (const product of products) {
    const dbProduct = await prisma.product.upsert({
      where: { storeId_shopifyProductId: { storeId, shopifyProductId: String(product.id) } },
      create: {
        storeId,
        shopifyProductId: String(product.id),
        handle: product.handle,
        title: product.title,
        description: product.body_html ?? "",
        vendor: product.vendor,
        productType: product.product_type,
        tags: parseTags(product.tags),
        status: product.status,
      },
      update: {
        handle: product.handle,
        title: product.title,
        description: product.body_html ?? "",
        vendor: product.vendor,
        productType: product.product_type,
        tags: parseTags(product.tags),
        status: product.status,
      },
    });

    // Images have no stable natural key in our schema, so each sync replaces them wholesale.
    await prisma.productImage.deleteMany({ where: { productId: dbProduct.id } });
    if (product.images.length > 0) {
      await prisma.productImage.createMany({
        data: product.images.map((image) => ({
          productId: dbProduct.id,
          url: image.src,
          position: image.position,
        })),
      });
    }

    for (const variant of product.variants) {
      await prisma.productVariant.upsert({
        where: {
          productId_shopifyVariantId: {
            productId: dbProduct.id,
            shopifyVariantId: String(variant.id),
          },
        },
        create: {
          productId: dbProduct.id,
          shopifyVariantId: String(variant.id),
          title: variant.title,
          sku: variant.sku,
          price: variant.price,
          options: parseVariantOptions(variant),
        },
        update: {
          title: variant.title,
          sku: variant.sku,
          price: variant.price,
          options: parseVariantOptions(variant),
        },
      });
    }
  }

  // Remove local products no longer present on Shopify (deleted/archived there) — cascades to
  // that product's images/variants/collection-memberships/generated reviews/upload jobs. Guarded
  // by MAX_SAFE_DROP_RATIO: if what Shopify just returned looks like a suspiciously large drop
  // from what we already had, skip deletion entirely rather than risk wiping real data over a
  // transient/partial fetch — everything fetched still gets upserted normally either way.
  const existingProducts = await prisma.product.findMany({
    where: { storeId },
    select: { id: true, shopifyProductId: true },
  });
  const fetchedProductIds = new Set(products.map((p) => String(p.id)));
  const staleProductIds = existingProducts
    .filter((p) => !fetchedProductIds.has(p.shopifyProductId))
    .map((p) => p.id);

  if (staleProductIds.length > 0) {
    const dropRatio = staleProductIds.length / existingProducts.length;
    if (existingProducts.length >= MIN_COUNT_FOR_SAFETY_CHECK && dropRatio > MAX_SAFE_DROP_RATIO) {
      await logSystemEvent(
        "WARN",
        `Shopify sync skipped removing ${staleProductIds.length} apparently-missing product(s) (${Math.round(dropRatio * 100)}% of ${existingProducts.length} existing) — looks like a possible partial/incomplete fetch rather than real deletions on Shopify, so nothing was removed as a safety measure. Products returned by Shopify were still updated normally.`,
        { userId: store.userId, metadata: { storeId, staleCount: staleProductIds.length, existingCount: existingProducts.length } },
      );
    } else {
      await deleteInChunks(staleProductIds, (chunk) =>
        prisma.product.deleteMany({ where: { id: { in: chunk } } }),
      );
      await logSystemEvent(
        "INFO",
        `Shopify sync removed ${staleProductIds.length} product(s) no longer present on Shopify.`,
        { userId: store.userId, metadata: { storeId, deletedCount: staleProductIds.length } },
      );
    }
  }

  const collections = [...customCollections, ...smartCollections];

  for (const collection of collections) {
    const dbCollection = await prisma.collection.upsert({
      where: {
        storeId_shopifyCollectionId: { storeId, shopifyCollectionId: String(collection.id) },
      },
      create: {
        storeId,
        shopifyCollectionId: String(collection.id),
        title: collection.title,
        handle: collection.handle,
        sortOrder: collection.sort_order,
      },
      update: {
        title: collection.title,
        handle: collection.handle,
        sortOrder: collection.sort_order,
      },
    });

    const collectionProducts = await fetchAllPages<{ id: number }>(
      store.shopDomain,
      accessToken,
      `/collections/${collection.id}/products.json`,
      "products",
    );

    const fetchedMemberProductIds: string[] = [];
    for (const [position, collectionProduct] of collectionProducts.entries()) {
      const dbProduct = await prisma.product.findUnique({
        where: {
          storeId_shopifyProductId: { storeId, shopifyProductId: String(collectionProduct.id) },
        },
      });
      if (!dbProduct) continue;
      fetchedMemberProductIds.push(dbProduct.id);

      await prisma.productCollection.upsert({
        where: {
          productId_collectionId: { productId: dbProduct.id, collectionId: dbCollection.id },
        },
        create: { productId: dbProduct.id, collectionId: dbCollection.id, position },
        update: { position },
      });
    }

    // Products removed from this collection on Shopify (while the collection and product both
    // still exist) — scoped to one collection's membership only, not a store-wide delete, so this
    // is lower blast-radius than the product/collection cleanup below, but still guarded the same
    // way against a suspiciously-empty/incomplete fetch for this one collection.
    const existingMemberCount = await prisma.productCollection.count({ where: { collectionId: dbCollection.id } });
    const removedMemberCount = existingMemberCount - fetchedMemberProductIds.length;
    if (removedMemberCount > 0) {
      const dropRatio = removedMemberCount / existingMemberCount;
      if (existingMemberCount >= MIN_COUNT_FOR_SAFETY_CHECK && dropRatio > MAX_SAFE_DROP_RATIO) {
        await logSystemEvent(
          "WARN",
          `Shopify sync skipped updating membership for collection "${collection.title}" — fetched ${fetchedMemberProductIds.length} product(s) vs ${existingMemberCount} existing (a ${Math.round(dropRatio * 100)}% drop), which looks like a possible partial/incomplete fetch.`,
          { userId: store.userId, metadata: { storeId, collectionId: dbCollection.id } },
        );
      } else {
        await prisma.productCollection.deleteMany({
          where: { collectionId: dbCollection.id, productId: { notIn: fetchedMemberProductIds } },
        });
      }
    }
  }

  // Remove local collections no longer present on Shopify — same suspicious-drop safety guard as
  // the product cleanup above.
  const existingCollections = await prisma.collection.findMany({
    where: { storeId },
    select: { id: true, shopifyCollectionId: true },
  });
  const fetchedCollectionIds = new Set(collections.map((c) => String(c.id)));
  const staleCollectionIds = existingCollections
    .filter((c) => !fetchedCollectionIds.has(c.shopifyCollectionId))
    .map((c) => c.id);

  if (staleCollectionIds.length > 0) {
    const dropRatio = staleCollectionIds.length / existingCollections.length;
    if (existingCollections.length >= MIN_COUNT_FOR_SAFETY_CHECK && dropRatio > MAX_SAFE_DROP_RATIO) {
      await logSystemEvent(
        "WARN",
        `Shopify sync skipped removing ${staleCollectionIds.length} apparently-missing collection(s) (${Math.round(dropRatio * 100)}% of ${existingCollections.length} existing) — looks like a possible partial/incomplete fetch rather than real deletions on Shopify, so nothing was removed as a safety measure.`,
        { userId: store.userId, metadata: { storeId, staleCount: staleCollectionIds.length, existingCount: existingCollections.length } },
      );
    } else {
      await deleteInChunks(staleCollectionIds, (chunk) =>
        prisma.collection.deleteMany({ where: { id: { in: chunk } } }),
      );
      await logSystemEvent(
        "INFO",
        `Shopify sync removed ${staleCollectionIds.length} collection(s) no longer present on Shopify.`,
        { userId: store.userId, metadata: { storeId, deletedCount: staleCollectionIds.length } },
      );
    }
  }

  await prisma.shopifyStore.update({
    where: { id: storeId },
    data: { lastSyncedAt: new Date() },
  });
}

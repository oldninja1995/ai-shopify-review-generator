import { prisma } from "@ai-shopify/db";
import { decryptSecret } from "@ai-shopify/shared";
import { env } from "../env.js";
import { fetchAllPages } from "./rest-client.js";
import type { ShopifyCollection, ShopifyProduct, ShopifyProductVariant } from "./types.js";

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

    for (const [position, collectionProduct] of collectionProducts.entries()) {
      const dbProduct = await prisma.product.findUnique({
        where: {
          storeId_shopifyProductId: { storeId, shopifyProductId: String(collectionProduct.id) },
        },
      });
      if (!dbProduct) continue;

      await prisma.productCollection.upsert({
        where: {
          productId_collectionId: { productId: dbProduct.id, collectionId: dbCollection.id },
        },
        create: { productId: dbProduct.id, collectionId: dbCollection.id, position },
        update: { position },
      });
    }
  }

  await prisma.shopifyStore.update({
    where: { id: storeId },
    data: { lastSyncedAt: new Date() },
  });
}

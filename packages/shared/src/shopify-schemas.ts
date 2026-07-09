import { z } from "zod";

/** `my-store` or `my-store.myshopify.com`, normalized to the full `*.myshopify.com` domain. */
export const connectStoreSchema = z.object({
  shop: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter your store's Shopify domain")
    .transform((value) => value.replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .transform((value) => (value.endsWith(".myshopify.com") ? value : `${value}.myshopify.com`))
    .refine(
      (value) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value),
      "Enter a valid Shopify domain, e.g. your-store.myshopify.com",
    ),
});
export type ConnectStoreInput = z.infer<typeof connectStoreSchema>;

export type ShopifySyncJobPayload = {
  storeId: string;
};

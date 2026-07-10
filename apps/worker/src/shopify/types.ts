export type ShopifyProductImage = {
  id: number;
  src: string;
  position: number;
};

export type ShopifyProductVariant = {
  id: number;
  title: string;
  sku: string | null;
  price: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
};

export type ShopifyProduct = {
  id: number;
  handle: string;
  title: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  tags: string;
  status: string;
  images: ShopifyProductImage[];
  variants: ShopifyProductVariant[];
};

export type ShopifyCollection = {
  id: number;
  handle: string;
  title: string;
  sort_order: string;
};

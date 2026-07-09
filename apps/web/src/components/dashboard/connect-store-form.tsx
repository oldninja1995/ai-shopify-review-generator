"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ConnectStoreForm() {
  const [shop, setShop] = useState("");

  return (
    <form action="/api/shopify/connect" method="get" className="flex flex-col gap-3 sm:flex-row">
      <Input
        name="shop"
        placeholder="your-store.myshopify.com"
        value={shop}
        onChange={(event) => setShop(event.target.value)}
        required
        className="sm:max-w-xs"
      />
      <Button type="submit" disabled={shop.trim().length === 0}>
        Connect Shopify store
      </Button>
    </form>
  );
}

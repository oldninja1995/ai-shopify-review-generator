"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api-client";

export function DisconnectStoreButton() {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  async function handleDisconnect() {
    if (!confirm("Disconnect this Shopify store? Synced products and reviews will be removed.")) {
      return;
    }
    setIsDisconnecting(true);
    const result = await postJson("/api/shopify/disconnect", {});
    setIsDisconnecting(false);

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Shopify store disconnected");
    router.refresh();
  }

  return (
    <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={isDisconnecting}>
      {isDisconnecting ? "Disconnecting..." : "Disconnect"}
    </Button>
  );
}

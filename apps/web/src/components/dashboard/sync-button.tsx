"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api-client";

export function SyncButton() {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);

  async function handleSync() {
    setIsSyncing(true);
    const result = await postJson("/api/shopify/sync", {});
    setIsSyncing(false);

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Sync started — products will update shortly");
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
      <RefreshCw className={isSyncing ? "animate-spin" : undefined} />
      {isSyncing ? "Syncing..." : "Sync now"}
    </Button>
  );
}

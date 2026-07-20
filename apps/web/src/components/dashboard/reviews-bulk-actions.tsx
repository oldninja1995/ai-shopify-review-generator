"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api-client";

export function ReviewsBulkActions({ currentStatus }: { currentStatus: string | undefined }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "delete" | null>(null);

  async function approveAll() {
    if (!confirm("Approve every DRAFT review in this store? This can't be undone.")) return;
    setBusy("approve");
    const result = await postJson<{ approvedCount: number }>("/api/reviews/approve-all", {});
    setBusy(null);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`Approved ${result.data.approvedCount} review${result.data.approvedCount === 1 ? "" : "s"}`);
    router.refresh();
  }

  async function deleteAll() {
    const scopeLabel =
      currentStatus === "ALL"
        ? "every review in this store"
        : !currentStatus
          ? "every pending (Draft/Approved) review in this store"
          : `every review matching the "${currentStatus}" filter`;
    if (!confirm(`Delete ${scopeLabel}? This can't be undone.`)) return;
    setBusy("delete");
    const result = await postJson<{ deletedCount: number }>("/api/reviews/delete-all", {
      status: currentStatus,
    });
    setBusy(null);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`Deleted ${result.data.deletedCount} review${result.data.deletedCount === 1 ? "" : "s"}`);
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={busy !== null} onClick={approveAll}>
        {busy === "approve" ? "Approving..." : "Approve all"}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy !== null} onClick={deleteAll}>
        {busy === "delete" ? "Deleting..." : "Delete all"}
      </Button>
    </div>
  );
}

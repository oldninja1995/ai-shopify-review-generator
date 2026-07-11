"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isAutoUploadProvider, type ReviewProviderName } from "@ai-shopify/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { postJson } from "@/lib/api-client";

export function ReviewUploadPanel({
  provider,
  eligibleCount,
}: {
  provider: ReviewProviderName | null;
  eligibleCount: number;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);

  if (!provider) return null;
  const autoUpload = isAutoUploadProvider(provider);

  async function handleUpload() {
    setUploading(true);
    const result = await postJson<{ queued: number }>("/api/review-upload", {});
    setUploading(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success(
      `Queued ${result.data.queued} review${result.data.queued === 1 ? "" : "s"} for upload`,
    );
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{autoUpload ? "Upload reviews" : "Export reviews"}</CardTitle>
        <CardDescription>
          {autoUpload
            ? `${eligibleCount} review${eligibleCount === 1 ? "" : "s"} ready to upload to ${provider}.`
            : `${provider} doesn't support automatic upload — export a CSV and import it there yourself (${eligibleCount} review${eligibleCount === 1 ? "" : "s"} ready).`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {autoUpload ? (
          <Button onClick={handleUpload} disabled={uploading || eligibleCount === 0}>
            {uploading ? "Uploading..." : `Upload to ${provider}`}
          </Button>
        ) : (
          <a href="/api/review-export" className={buttonVariants({ variant: "secondary" })}>
            Export CSV
          </a>
        )}
      </CardContent>
    </Card>
  );
}

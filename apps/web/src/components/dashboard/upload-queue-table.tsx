"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { postJson } from "@/lib/api-client";

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  PENDING: "outline",
  PROCESSING: "secondary",
  SUCCEEDED: "secondary",
  FAILED: "destructive",
};

export type UploadQueueRow = {
  id: string;
  productTitle: string;
  reviewerName: string;
  provider: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

export function UploadQueueTable({ jobs }: { jobs: UploadQueueRow[] }) {
  const router = useRouter();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  async function retry(id: string) {
    setRetryingId(id);
    const result = await postJson(`/api/upload-queue/${id}/retry`, {});
    setRetryingId(null);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Upload retry queued");
    router.refresh();
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead>Reviewer</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Error</TableHead>
          <TableHead>Created</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell className="font-medium">{job.productTitle}</TableCell>
            <TableCell>{job.reviewerName}</TableCell>
            <TableCell>{job.provider}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[job.status] ?? "outline"}>{job.status}</Badge>
            </TableCell>
            <TableCell>{job.attempts}</TableCell>
            <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={job.lastError ?? ""}>
              {job.lastError ?? "—"}
            </TableCell>
            <TableCell>{new Date(job.createdAt).toLocaleString()}</TableCell>
            <TableCell className="text-right">
              {job.status === "FAILED" && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={retryingId === job.id}
                  onClick={() => retry(job.id)}
                >
                  {retryingId === job.id ? "Retrying..." : "Retry"}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

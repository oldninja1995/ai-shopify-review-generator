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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteJson } from "@/lib/api-client";

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  APPROVED: "secondary",
  QUEUED: "secondary",
  UPLOADED: "secondary",
  FAILED: "destructive",
  DUPLICATE_REGENERATED: "destructive",
};

export type ReviewListItem = {
  id: string;
  productTitle: string;
  reviewerName: string;
  reviewerGender: "MALE" | "FEMALE";
  rating: number;
  status: string;
  createdAt: string;
  title: string;
  content: string;
};

export function ReviewList({ reviews }: { reviews: ReviewListItem[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReviewListItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteReview(review: ReviewListItem) {
    if (!confirm(`Delete this review for "${review.productTitle}"? This can't be undone.`)) return;
    setDeletingId(review.id);
    const result = await deleteJson(`/api/reviews/${review.id}`);
    setDeletingId(null);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Review deleted");
    setSelected(null);
    router.refresh();
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Reviewer</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {reviews.map((review) => (
            <TableRow
              key={review.id}
              className="cursor-pointer"
              onClick={() => setSelected(review)}
            >
              <TableCell className="font-medium">{review.productTitle}</TableCell>
              <TableCell>
                {review.reviewerName}{" "}
                <span className="text-muted-foreground">
                  ({review.reviewerGender === "MALE" ? "M" : "F"})
                </span>
              </TableCell>
              <TableCell>{review.rating} / 5</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[review.status] ?? "outline"}>
                  {review.status}
                </Badge>
              </TableCell>
              <TableCell>{new Date(review.createdAt).toLocaleString()}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={deletingId === review.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteReview(review);
                  }}
                >
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.title}</DialogTitle>
                <DialogDescription>
                  {selected.productTitle} — {selected.reviewerName} (
                  {selected.reviewerGender === "MALE" ? "M" : "F"}) — {selected.rating} / 5
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm leading-relaxed">{selected.content}</p>
              <DialogFooter>
                <Button
                  variant="ghost"
                  disabled={deletingId === selected.id}
                  onClick={() => deleteReview(selected)}
                >
                  Delete
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

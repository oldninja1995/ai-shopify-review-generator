"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [selected, setSelected] = useState<ReviewListItem | null>(null);

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
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

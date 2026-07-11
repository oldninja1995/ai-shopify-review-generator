"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { patchJson, deleteJson } from "@/lib/api-client";

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  APPROVED: "secondary",
  QUEUED: "secondary",
  UPLOADED: "secondary",
  FAILED: "destructive",
  DUPLICATE_REGENERATED: "destructive",
};

export type ManagedReview = {
  id: string;
  productTitle: string;
  reviewerName: string;
  rating: number;
  status: string;
  title: string;
  content: string;
  createdAt: string;
};

export function ReviewsManagementTable({ reviews }: { reviews: ManagedReview[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ManagedReview | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editRating, setEditRating] = useState(5);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function openEdit(review: ManagedReview) {
    setEditing(review);
    setEditTitle(review.title);
    setEditContent(review.content);
    setEditRating(review.rating);
  }

  async function approve(review: ManagedReview) {
    setBusyId(review.id);
    const result = await patchJson(`/api/reviews/${review.id}`, { status: "APPROVED" });
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Review approved");
    router.refresh();
  }

  async function discard(review: ManagedReview) {
    if (!confirm(`Discard this review for "${review.productTitle}"? This can't be undone.`)) return;
    setBusyId(review.id);
    const result = await deleteJson(`/api/reviews/${review.id}`);
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Review discarded");
    router.refresh();
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    const result = await patchJson(`/api/reviews/${editing.id}`, {
      title: editTitle,
      content: editContent,
      rating: editRating,
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Review updated");
    setEditing(null);
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
            <TableRow key={review.id}>
              <TableCell className="font-medium">{review.productTitle}</TableCell>
              <TableCell>{review.reviewerName}</TableCell>
              <TableCell>{review.rating} / 5</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[review.status] ?? "outline"}>{review.status}</Badge>
              </TableCell>
              <TableCell>{new Date(review.createdAt).toLocaleString()}</TableCell>
              <TableCell className="flex justify-end gap-1 text-right">
                <Button variant="outline" size="xs" onClick={() => openEdit(review)}>
                  Edit
                </Button>
                {review.status === "DRAFT" && (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busyId === review.id}
                    onClick={() => approve(review)}
                  >
                    Approve
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busyId === review.id}
                  onClick={() => discard(review)}
                >
                  Discard
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit review</DialogTitle>
            <DialogDescription>{editing?.productTitle}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Rating</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="xs"
                    variant={editRating === n ? "default" : "outline"}
                    onClick={() => setEditRating(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" />
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={5}
              placeholder="Review content"
            />
          </div>
          <DialogFooter>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
import { deleteJson } from "@/lib/api-client";

export type ReviewerRow = {
  id: string;
  name: string;
  gender: "MALE" | "FEMALE";
  country: string;
  ageGroup: string;
  occupation: string;
  isVerifiedPurchase: boolean;
  reviewCount: number;
  createdAt: string;
};

export function ReviewersTable({ reviewers }: { reviewers: ReviewerRow[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete reviewer profile "${name}"? This also deletes their generated reviews.`)) {
      return;
    }
    setDeletingId(id);
    const result = await deleteJson(`/api/reviewer-profiles/${id}`);
    setDeletingId(null);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Reviewer profile deleted");
    router.refresh();
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Gender</TableHead>
          <TableHead>Country</TableHead>
          <TableHead>Age group</TableHead>
          <TableHead>Occupation</TableHead>
          <TableHead>Verified</TableHead>
          <TableHead>Reviews</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviewers.map((reviewer) => (
          <TableRow key={reviewer.id}>
            <TableCell className="font-medium">{reviewer.name}</TableCell>
            <TableCell>{reviewer.gender === "MALE" ? "Male" : "Female"}</TableCell>
            <TableCell>{reviewer.country}</TableCell>
            <TableCell>{reviewer.ageGroup}</TableCell>
            <TableCell>{reviewer.occupation}</TableCell>
            <TableCell>
              <Badge variant={reviewer.isVerifiedPurchase ? "secondary" : "outline"}>
                {reviewer.isVerifiedPurchase ? "Verified" : "Unverified"}
              </Badge>
            </TableCell>
            <TableCell>{reviewer.reviewCount}</TableCell>
            <TableCell className="text-right">
              <Button
                variant="ghost"
                size="xs"
                disabled={deletingId === reviewer.id}
                onClick={() => handleDelete(reviewer.id, reviewer.name)}
              >
                {deletingId === reviewer.id ? "Deleting..." : "Delete"}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

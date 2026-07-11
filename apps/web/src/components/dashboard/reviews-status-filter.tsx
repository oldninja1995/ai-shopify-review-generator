"use client";

import { useRouter, useSearchParams } from "next/navigation";

const STATUS_OPTIONS = [
  { value: "", label: "Pending review (Draft/Approved)" },
  { value: "ALL", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "APPROVED", label: "Approved" },
  { value: "QUEUED", label: "Queued" },
  { value: "UPLOADED", label: "Uploaded" },
  { value: "FAILED", label: "Failed" },
  { value: "DUPLICATE_REGENERATED", label: "Duplicate (regenerated)" },
];

export function ReviewsStatusFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      value={searchParams.get("status") ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams);
        if (e.target.value) next.set("status", e.target.value);
        else next.delete("status");
        next.delete("page");
        const query = next.toString();
        router.push(query ? `/dashboard/reviews?${query}` : "/dashboard/reviews");
      }}
      className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    >
      {STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

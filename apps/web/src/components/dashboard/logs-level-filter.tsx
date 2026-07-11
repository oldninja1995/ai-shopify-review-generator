"use client";

import { useRouter, useSearchParams } from "next/navigation";

const LEVEL_OPTIONS = [
  { value: "", label: "All levels" },
  { value: "INFO", label: "Info" },
  { value: "WARN", label: "Warning" },
  { value: "ERROR", label: "Error" },
];

export function LogsLevelFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      value={searchParams.get("level") ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams);
        if (e.target.value) next.set("level", e.target.value);
        else next.delete("level");
        next.delete("page");
        const query = next.toString();
        router.push(query ? `/dashboard/logs?${query}` : "/dashboard/logs");
      }}
      className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    >
      {LEVEL_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

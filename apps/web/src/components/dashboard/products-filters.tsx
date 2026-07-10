"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export type FilterOption = { value: string; label: string };

function buildHref(
  params: URLSearchParams,
  updates: Record<string, string | null>,
): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(updates)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  next.delete("page");
  const query = next.toString();
  return query ? `/dashboard/products?${query}` : "/dashboard/products";
}

export function ProductsFilters({
  categories,
  collections,
}: {
  categories: FilterOption[];
  collections: FilterOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    const current = searchParams.get("q") ?? "";
    if (search === current) return;
    const timeout = setTimeout(() => {
      router.push(buildHref(searchParams, { q: search || null }));
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b p-3">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products..."
          className="pl-7"
        />
      </div>

      <select
        value={searchParams.get("type") ?? ""}
        onChange={(e) =>
          router.push(buildHref(searchParams, { type: e.target.value || null }))
        }
        className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("collection") ?? ""}
        onChange={(e) =>
          router.push(buildHref(searchParams, { collection: e.target.value || null }))
        }
        className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        <option value="">All collections</option>
        {collections.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

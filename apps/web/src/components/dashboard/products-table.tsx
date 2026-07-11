"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  GenerateReviewsDialog,
  type GenerateReviewsTarget,
} from "@/components/dashboard/generate-reviews-dialog";
import { BulkGenerateDialog, type BulkGenerateTarget } from "@/components/dashboard/bulk-generate-dialog";

export type ProductRow = {
  id: string;
  title: string;
  productType: string;
  status: string;
  variantCount: number;
  imageUrl: string | null;
};

export function ProductsTable({ products }: { products: ProductRow[] }) {
  const [target, setTarget] = useState<GenerateReviewsTarget | null>(null);
  const [bulkTarget, setBulkTarget] = useState<BulkGenerateTarget | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(products.map((p) => p.id)) : new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2 text-sm">
          <span>{selected.size} selected</span>
          <Button
            size="sm"
            onClick={() =>
              setBulkTarget({
                scope: "SELECTED",
                productIds: Array.from(selected),
                label: `${selected.size} selected product${selected.size === 1 ? "" : "s"}`,
              })
            }
          >
            <Sparkles />
            Bulk generate reviews
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
            </TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Variants</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.id}>
              <TableCell>
                <Checkbox
                  checked={selected.has(product.id)}
                  onCheckedChange={(checked) => toggleOne(product.id, checked)}
                  aria-label={`Select ${product.title}`}
                />
              </TableCell>
              <TableCell className="flex items-center gap-3">
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageUrl}
                    alt={product.title}
                    className="size-8 rounded object-cover"
                  />
                ) : (
                  <div className="size-8 rounded bg-muted" />
                )}
                <span className="font-medium">{product.title}</span>
              </TableCell>
              <TableCell>{product.productType || "—"}</TableCell>
              <TableCell>{product.variantCount}</TableCell>
              <TableCell>
                <Badge variant="outline">{product.status}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setTarget({ id: product.id, title: product.title, productType: product.productType })
                  }
                >
                  <Sparkles />
                  Generate reviews
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <GenerateReviewsDialog target={target} onOpenChange={(open) => !open && setTarget(null)} />
      <BulkGenerateDialog
        target={bulkTarget}
        onOpenChange={(open) => {
          if (!open) {
            setBulkTarget(null);
            setSelected(new Set());
          }
        }}
      />
    </>
  );
}

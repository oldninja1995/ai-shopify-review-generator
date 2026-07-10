"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
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
  GenerateReviewsDialog,
  type GenerateReviewsTarget,
} from "@/components/dashboard/generate-reviews-dialog";

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

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
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
    </>
  );
}

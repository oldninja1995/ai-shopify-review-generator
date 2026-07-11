"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  bulkGenerateReviewsSchema,
  REVIEW_LENGTHS,
  type BulkGenerateReviewsInput,
  type ReviewLength,
} from "@ai-shopify/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { postJson } from "@/lib/api-client";

const LENGTH_LABELS: Record<ReviewLength, string> = {
  SHORT: "Short",
  MEDIUM: "Medium",
  DETAILED: "Detailed",
};

export type BulkGenerateTarget =
  | { scope: "SELECTED"; productIds: string[]; label: string }
  | { scope: "COLLECTION"; collectionId: string; label: string }
  | { scope: "STORE"; label: string };

/**
 * One shared dialog for every bulk-generation entry point (selected products on the Products
 * page, a single collection, or the whole store) — same pattern as GenerateReviewsDialog: a
 * single controlled instance rather than one per trigger.
 */
export function BulkGenerateDialog({
  target,
  onOpenChange,
}: {
  target: BulkGenerateTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const form = useForm<BulkGenerateReviewsInput>({
    resolver: zodResolver(bulkGenerateReviewsSchema),
    defaultValues: { scope: "STORE", targetIds: [], maleCount: 2, femaleCount: 2, length: "MEDIUM" },
  });

  useEffect(() => {
    if (target) {
      form.reset({
        scope: target.scope,
        targetIds:
          target.scope === "SELECTED"
            ? target.productIds
            : target.scope === "COLLECTION"
              ? [target.collectionId]
              : [],
        maleCount: 2,
        femaleCount: 2,
        length: "MEDIUM",
      });
    }
  }, [target, form]);

  async function onSubmit(values: BulkGenerateReviewsInput) {
    const result = await postJson<{ totalCount: number }>("/api/bulk-generation", values);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success(
      `Queued review generation for ${result.data.totalCount} product${result.data.totalCount === 1 ? "" : "s"}`,
    );
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk generate reviews</DialogTitle>
          <DialogDescription>{target?.label}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="maleCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Male reviewers / product</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={110}
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="femaleCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Female reviewers / product</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={110}
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="length"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Review length</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      {REVIEW_LENGTHS.map((length) => (
                        <Button
                          key={length}
                          type="button"
                          size="sm"
                          variant={field.value === length ? "default" : "outline"}
                          onClick={() => field.onChange(length)}
                        >
                          {LENGTH_LABELS[length]}
                        </Button>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Queuing..." : "Generate"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

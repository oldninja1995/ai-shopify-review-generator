"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  bulkGenerateReviewsSchema,
  DEFAULT_LENGTH_WEIGHTS,
  DEFAULT_RATING_WEIGHTS,
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
import { LengthWeightInputs } from "@/components/dashboard/length-weight-inputs";
import { RatingWeightInputs } from "@/components/dashboard/rating-weight-inputs";
import { postJson } from "@/lib/api-client";

const LENGTH_LABELS: Record<ReviewLength, string> = {
  SHORT: "Short",
  MEDIUM: "Medium",
  DETAILED: "Detailed",
};

export type BulkGenerateTarget =
  | { scope: "SELECTED"; productIds: string[]; label: string; productCount: number }
  | { scope: "COLLECTION"; collectionId: string; label: string; productCount: number }
  | { scope: "STORE"; label: string; productCount: number };

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
    defaultValues: {
      scope: "STORE",
      targetIds: [],
      countMode: "FIXED",
      maleCount: 2,
      femaleCount: 2,
      minPerProduct: 2,
      maxPerProduct: 6,
      lengthMode: "FIXED",
      length: "MEDIUM",
      lengthWeights: DEFAULT_LENGTH_WEIGHTS,
      ratingMode: "DEFAULT",
      ratingWeights: DEFAULT_RATING_WEIGHTS,
    },
  });

  const countMode = useWatch({ control: form.control, name: "countMode" });
  const lengthMode = useWatch({ control: form.control, name: "lengthMode" });
  const ratingMode = useWatch({ control: form.control, name: "ratingMode" });
  const maleCount = useWatch({ control: form.control, name: "maleCount" });
  const femaleCount = useWatch({ control: form.control, name: "femaleCount" });
  const minPerProduct = useWatch({ control: form.control, name: "minPerProduct" });
  const maxPerProduct = useWatch({ control: form.control, name: "maxPerProduct" });

  const productCount = target?.productCount ?? 0;
  const perProductEstimate =
    countMode === "RANDOM"
      ? ((minPerProduct ?? 0) + (maxPerProduct ?? 0)) / 2
      : (maleCount ?? 0) + (femaleCount ?? 0);
  const totalEstimate = Math.round(productCount * perProductEstimate);

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
        countMode: "FIXED",
        maleCount: 2,
        femaleCount: 2,
        minPerProduct: 2,
        maxPerProduct: 6,
        lengthMode: "FIXED",
        length: "MEDIUM",
        lengthWeights: DEFAULT_LENGTH_WEIGHTS,
        ratingMode: "DEFAULT",
        ratingWeights: DEFAULT_RATING_WEIGHTS,
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
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
          {countMode === "RANDOM" ? "~" : ""}
          <span className="font-medium">{totalEstimate}</span> review
          {totalEstimate === 1 ? "" : "s"} will be generated across {productCount} product
          {productCount === 1 ? "" : "s"}
          {countMode === "RANDOM" ? " (estimated — actual count is randomized per product)" : ""}
        </p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="countMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reviews per product</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={field.value === "FIXED" ? "default" : "outline"}
                        onClick={() => field.onChange("FIXED")}
                      >
                        Fixed count
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={field.value === "RANDOM" ? "default" : "outline"}
                        onClick={() => field.onChange("RANDOM")}
                      >
                        Random range
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {countMode === "FIXED" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="minPerProduct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min reviews / product</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={110}
                          {...field}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || 1)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxPerProduct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max reviews / product</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={110}
                          {...field}
                          onChange={(e) => field.onChange(e.target.valueAsNumber || 1)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="lengthMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Review length</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={field.value === "FIXED" ? "default" : "outline"}
                        onClick={() => field.onChange("FIXED")}
                      >
                        One length
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={field.value === "MIXED" ? "default" : "outline"}
                        onClick={() => field.onChange("MIXED")}
                      >
                        Mix of lengths
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {lengthMode === "FIXED" ? (
              <FormField
                control={form.control}
                name="length"
                render={({ field }) => (
                  <FormItem>
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
            ) : (
              <LengthWeightInputs form={form} />
            )}

            <FormField
              control={form.control}
              name="ratingMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rating distribution</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={field.value === "DEFAULT" ? "default" : "outline"}
                        onClick={() => field.onChange("DEFAULT")}
                      >
                        Default
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={field.value === "MIXED" ? "default" : "outline"}
                        onClick={() => field.onChange("MIXED")}
                      >
                        Custom mix
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {ratingMode === "MIXED" && <RatingWeightInputs form={form} />}

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

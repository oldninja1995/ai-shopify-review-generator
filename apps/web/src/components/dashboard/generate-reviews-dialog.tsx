"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  DEFAULT_LENGTH_WEIGHTS,
  DEFAULT_RATING_WEIGHTS,
  generateReviewsSchema,
  REVIEW_LENGTHS,
  type GenerateReviewsInput,
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

export type GenerateReviewsTarget = { id: string; title: string; productType: string };

/**
 * A single, controlled dialog instance shared across the whole Products table — rendered once
 * regardless of row count, rather than mounting a form per row (which was crushing page load
 * with 1500+ products).
 */
export function GenerateReviewsDialog({
  target,
  onOpenChange,
}: {
  target: GenerateReviewsTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const form = useForm<GenerateReviewsInput>({
    resolver: zodResolver(generateReviewsSchema),
    defaultValues: {
      productId: "",
      maleCount: 2,
      femaleCount: 2,
      productType: "",
      lengthMode: "FIXED",
      length: "MEDIUM",
      lengthWeights: DEFAULT_LENGTH_WEIGHTS,
      ratingMode: "DEFAULT",
      ratingWeights: DEFAULT_RATING_WEIGHTS,
    },
  });

  const lengthMode = useWatch({ control: form.control, name: "lengthMode" });
  const ratingMode = useWatch({ control: form.control, name: "ratingMode" });

  useEffect(() => {
    if (target) {
      form.reset({
        productId: target.id,
        maleCount: 2,
        femaleCount: 2,
        productType: target.productType,
        lengthMode: "FIXED",
        length: "MEDIUM",
        lengthWeights: DEFAULT_LENGTH_WEIGHTS,
        ratingMode: "DEFAULT",
        ratingWeights: DEFAULT_RATING_WEIGHTS,
      });
    }
  }, [target, form]);

  async function onSubmit(values: GenerateReviewsInput) {
    const result = await postJson("/api/review-generator/generate", values);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Review generation queued");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate reviews</DialogTitle>
          <DialogDescription>{target?.title}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="maleCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Male reviewers</FormLabel>
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
                    <FormLabel>Female reviewers</FormLabel>
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
              name="productType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product type</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Wireless Earbuds" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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

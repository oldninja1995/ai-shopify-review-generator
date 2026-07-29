"use client";

import { useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { RATING_TIERS, type RatingTier } from "@ai-shopify/shared";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form";

const RATING_LABELS: Record<RatingTier, string> = {
  5: "5 star",
  4: "4 star",
};

type WithRatingWeights = { ratingWeights?: Record<RatingTier, number> };

/** Two weighted inputs (relative, need not sum to 100) that drive a per-review randomized star
 * pick server-side. Only 4-5 stars are offered — this app generates positive reviews only, so the
 * mix is about how often a batch lands on 4 instead of 5, not about seeding bad reviews. Shared by
 * both the single-product and bulk generation dialogs. */
export function RatingWeightInputs<T extends FieldValues & WithRatingWeights>({
  form,
}: {
  form: UseFormReturn<T>;
}) {
  const weights = useWatch({ control: form.control, name: "ratingWeights" as Path<T> }) as
    | Record<RatingTier, number>
    | undefined;
  const total = RATING_TIERS.reduce((sum, tier) => sum + (weights?.[tier] ?? 0), 0);
  const error = (form.formState.errors as Record<string, { message?: string } | undefined>).ratingWeights
    ?.message;

  return (
    <div className="space-y-2">
      <FormLabel>Rating mix (relative weights)</FormLabel>
      <div className="grid grid-cols-2 gap-2">
        {RATING_TIERS.map((tier) => (
          <div key={tier} className="space-y-1">
            <label className="text-xs font-normal text-muted-foreground">{RATING_LABELS[tier]}</label>
            <Input
              type="number"
              min={0}
              max={100}
              {...form.register(`ratingWeights.${tier}` as Path<T>, { valueAsNumber: true })}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {total > 0
          ? `Roughly ${RATING_TIERS.map(
              (tier) => `${Math.round(((weights?.[tier] ?? 0) / total) * 100)}% ${RATING_LABELS[tier]}`,
            ).join(", ")}`
          : "Enter at least one weight greater than 0"}
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

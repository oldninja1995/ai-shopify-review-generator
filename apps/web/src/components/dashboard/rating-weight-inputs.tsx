"use client";

import { useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { RATING_SENTIMENTS, type RatingSentiment } from "@ai-shopify/shared";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form";

const SENTIMENT_LABELS: Record<RatingSentiment, string> = {
  POSITIVE: "Positive (4-5★)",
  NEUTRAL: "Neutral (3★)",
  NEGATIVE: "Negative (1-2★)",
};

type WithRatingWeights = { ratingWeights?: Record<RatingSentiment, number> };

/** Three weighted inputs (relative, need not sum to 100) that drive a per-review randomized
 * sentiment pick server-side instead of this app's fixed default rating distribution. Shared by
 * both the single-product and bulk generation dialogs. */
export function RatingWeightInputs<T extends FieldValues & WithRatingWeights>({
  form,
}: {
  form: UseFormReturn<T>;
}) {
  const weights = useWatch({ control: form.control, name: "ratingWeights" as Path<T> }) as
    | Record<RatingSentiment, number>
    | undefined;
  const total = RATING_SENTIMENTS.reduce((sum, tier) => sum + (weights?.[tier] ?? 0), 0);
  const error = (form.formState.errors as Record<string, { message?: string } | undefined>).ratingWeights
    ?.message;

  return (
    <div className="space-y-2">
      <FormLabel>Rating mix (relative weights)</FormLabel>
      <div className="grid grid-cols-3 gap-2">
        {RATING_SENTIMENTS.map((tier) => (
          <div key={tier} className="space-y-1">
            <label className="text-xs font-normal text-muted-foreground">{SENTIMENT_LABELS[tier]}</label>
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
          ? `Roughly ${RATING_SENTIMENTS.map(
              (tier) => `${Math.round(((weights?.[tier] ?? 0) / total) * 100)}% ${SENTIMENT_LABELS[tier].split(" (")[0]?.toLowerCase()}`,
            ).join(", ")}`
          : "Enter at least one weight greater than 0"}
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

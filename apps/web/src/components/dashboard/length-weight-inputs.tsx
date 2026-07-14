"use client";

import { useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { REVIEW_LENGTHS, type ReviewLength } from "@ai-shopify/shared";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form";

const LENGTH_LABELS: Record<ReviewLength, string> = {
  SHORT: "Short",
  MEDIUM: "Medium",
  DETAILED: "Detailed",
};

type WithLengthWeights = { lengthWeights?: Record<ReviewLength, number> };

/** Three weighted inputs (relative, need not sum to 100) that drive a per-review randomized
 * length pick server-side instead of one fixed length for the whole batch. Shared by both the
 * single-product and bulk generation dialogs. */
export function LengthWeightInputs<T extends FieldValues & WithLengthWeights>({
  form,
}: {
  form: UseFormReturn<T>;
}) {
  const weights = useWatch({ control: form.control, name: "lengthWeights" as Path<T> }) as
    | Record<ReviewLength, number>
    | undefined;
  const total = REVIEW_LENGTHS.reduce((sum, tier) => sum + (weights?.[tier] ?? 0), 0);
  const error = (form.formState.errors as Record<string, { message?: string } | undefined>).lengthWeights
    ?.message;

  return (
    <div className="space-y-2">
      <FormLabel>Length mix (relative weights)</FormLabel>
      <div className="grid grid-cols-3 gap-2">
        {REVIEW_LENGTHS.map((tier) => (
          <div key={tier} className="space-y-1">
            <label className="text-xs font-normal text-muted-foreground">{LENGTH_LABELS[tier]}</label>
            <Input
              type="number"
              min={0}
              max={100}
              {...form.register(`lengthWeights.${tier}` as Path<T>, { valueAsNumber: true })}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {total > 0
          ? `Roughly ${REVIEW_LENGTHS.map(
              (tier) => `${Math.round(((weights?.[tier] ?? 0) / total) * 100)}% ${LENGTH_LABELS[tier].toLowerCase()}`,
            ).join(", ")}`
          : "Enter at least one weight greater than 0"}
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

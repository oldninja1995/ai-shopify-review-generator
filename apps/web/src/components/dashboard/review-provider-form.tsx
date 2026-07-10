"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  REVIEW_PROVIDERS,
  selectProviderSchema,
  type ReviewProviderName,
  type SelectProviderInput,
} from "@ai-shopify/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { putJson } from "@/lib/api-client";

const PROVIDER_INFO: Record<ReviewProviderName, { label: string; description: string }> = {
  JUDGE_ME: {
    label: "Judge.me",
    description: "Fully automatic — reviews upload directly via Judge.me's API.",
  },
  AG_PRODUCT_REVIEWS: {
    label: "AG Product Reviews (Air Reviews)",
    description: "Manual — no public API for creating reviews. Export a CSV and import it yourself.",
  },
  LOOX: {
    label: "Loox",
    description: "Manual — Loox's API is read-only. Export a CSV and import it yourself.",
  },
  FERA: {
    label: "Fera",
    description: "Manual — export a CSV and import it yourself.",
  },
  RYVIU: {
    label: "Ryviu",
    description: "Manual — export a CSV and import it yourself.",
  },
};

export function ReviewProviderForm({ initialProvider }: { initialProvider: ReviewProviderName | null }) {
  const router = useRouter();
  const form = useForm<SelectProviderInput>({
    resolver: zodResolver(selectProviderSchema),
    defaultValues: { provider: initialProvider ?? "JUDGE_ME" },
  });

  async function onSubmit(values: SelectProviderInput) {
    const result = await putJson("/api/review-provider", values);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Review provider saved");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review Provider</CardTitle>
        <CardDescription>
          Choose which app your generated reviews should go to. Only Judge.me supports fully
          automatic upload — the rest export as a CSV you import yourself.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent>
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <div className="space-y-2">
                      {REVIEW_PROVIDERS.map((provider) => (
                        <button
                          key={provider}
                          type="button"
                          onClick={() => field.onChange(provider)}
                          className={`w-full rounded-lg border p-3 text-left transition-colors ${
                            field.value === provider
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          <p className="text-sm font-medium">{PROVIDER_INFO[provider].label}</p>
                          <p className="text-xs text-muted-foreground">
                            {PROVIDER_INFO[provider].description}
                          </p>
                        </button>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving..." : "Save"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

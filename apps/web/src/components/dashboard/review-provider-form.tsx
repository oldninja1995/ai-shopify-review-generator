"use client";

import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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

export function ReviewProviderForm({
  initialProvider,
  hasApiToken = false,
}: {
  initialProvider: ReviewProviderName | null;
  /** Whether a read token is already stored, so the field can show a placeholder instead of the
   * secret and a blank submit can mean "keep what's saved". */
  hasApiToken?: boolean;
}) {
  const router = useRouter();
  const form = useForm<SelectProviderInput>({
    resolver: zodResolver(selectProviderSchema),
    defaultValues: { provider: initialProvider ?? "JUDGE_ME", apiToken: undefined },
  });
  const provider = useWatch({ control: form.control, name: "provider" });

  async function onSubmit(values: SelectProviderInput) {
    const result = await putJson("/api/review-provider", {
      ...values,
      apiToken: values.apiToken?.trim() ? values.apiToken.trim() : undefined,
    });
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

            {provider === "JUDGE_ME" && (
              <FormField
                control={form.control}
                name="apiToken"
                render={({ field }) => (
                  <FormItem className="mt-4">
                    <FormLabel>Judge.me API token (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={hasApiToken ? "•••••••• (saved — leave blank to keep)" : "Private API token"}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Not needed to upload — Judge.me accepts new reviews without auth. It&apos;s
                      required only to <strong>read</strong> your published reviews, which is what
                      the &quot;Scan uploaded reviews&quot; check on the Reviews page uses to find
                      duplicate names or text already live on your storefront. Find it in Judge.me
                      under Settings → General → API token.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
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

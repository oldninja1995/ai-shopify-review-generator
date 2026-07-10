"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { brandSettingsSchema, type BrandSettingsInput } from "@ai-shopify/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { putJson } from "@/lib/api-client";

export function BrandSettingsForm({ initialValues }: { initialValues: BrandSettingsInput }) {
  const form = useForm<BrandSettingsInput>({
    resolver: zodResolver(brandSettingsSchema),
    defaultValues: initialValues,
  });

  async function onSubmit(values: BrandSettingsInput) {
    const result = await putJson("/api/brand-settings", values);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Brand settings saved");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand Settings</CardTitle>
        <CardDescription>
          Used when generating reviews — brand name and category subtly flavor the generated
          text. Brand voice and personality are stored for future use; reviews are currently
          generated in English only regardless of the language set here.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="brandName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brandCategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand category</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Sustainable activewear" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="brandDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand description</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="brandPositioning"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand positioning</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="brandPersonality"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand personality</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="brandVoice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand voice</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="targetAudience"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target audience</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Language</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving..." : "Save changes"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

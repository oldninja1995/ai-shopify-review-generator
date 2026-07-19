"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { OpenRouterModelOption } from "@ai-shopify/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { putJson } from "@/lib/api-client";

export type AiSettingsInitialValues = {
  enabled: boolean;
  models: string[];
  hasApiKey: boolean;
  visionAudienceEnabled: boolean;
  aiOnlyMode: boolean;
  groqModels: string[];
  hasGroqApiKey: boolean;
};

export function AiSettingsForm({
  initialValues,
  models,
  groqModelOptions,
}: {
  initialValues: AiSettingsInitialValues;
  models: OpenRouterModelOption[];
  groqModelOptions: OpenRouterModelOption[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialValues.enabled);
  const [selected, setSelected] = useState<string[]>(initialValues.models);
  const [apiKey, setApiKey] = useState("");
  const [visionAudienceEnabled, setVisionAudienceEnabled] = useState(
    initialValues.visionAudienceEnabled,
  );
  const [aiOnlyMode, setAiOnlyMode] = useState(initialValues.aiOnlyMode);
  const [groqSelected, setGroqSelected] = useState<string[]>(initialValues.groqModels);
  const [groqApiKey, setGroqApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const freeModels = models.filter((m) => m.isFree && !selected.includes(m.id));
  const paidModels = models.filter((m) => !m.isFree && !selected.includes(m.id));
  const nameFor = (id: string) => models.find((m) => m.id === id)?.name ?? id;

  const availableGroqModels = groqModelOptions.filter((m) => !groqSelected.includes(m.id));
  const groqNameFor = (id: string) => groqModelOptions.find((m) => m.id === id)?.name ?? id;

  function addModel(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }
  function removeModel(id: string) {
    setSelected((prev) => prev.filter((m) => m !== id));
  }
  function moveModel(index: number, direction: -1 | 1) {
    setSelected((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target] as string, next[index] as string];
      return next;
    });
  }

  function addGroqModel(id: string) {
    setGroqSelected((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }
  function removeGroqModel(id: string) {
    setGroqSelected((prev) => prev.filter((m) => m !== id));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) {
      toast.error("Select at least one model");
      return;
    }
    setSaving(true);
    const result = await putJson("/api/ai-settings", {
      apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      models: selected,
      enabled,
      visionAudienceEnabled,
      aiOnlyMode,
      groqApiKey: groqApiKey.trim() ? groqApiKey.trim() : undefined,
      groqModels: groqSelected,
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("AI settings saved");
    setApiKey("");
    setGroqApiKey("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Generation</CardTitle>
        <CardDescription>
          Use real AI models (via OpenRouter) to write reviews instead of the built-in phrase-bank
          generator — produces more natural, non-repetitive text. Add multiple models in priority
          order: if the first one fails (rate limit, error, etc.) the next one is tried
          automatically. If every model fails, generation falls back to the phrase-bank generator.
          Requires an OpenRouter API key (openrouter.ai); several models are free to use.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={enabled ? "default" : "outline"}
              onClick={() => setEnabled(true)}
            >
              Enabled
            </Button>
            <Button
              type="button"
              size="sm"
              variant={!enabled ? "default" : "outline"}
              onClick={() => setEnabled(false)}
            >
              Disabled
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Fallback order (tried top to bottom)</Label>
            {selected.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                No models selected yet — add one below.
              </p>
            ) : (
              <div className="space-y-1.5">
                {selected.map((id, index) => (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{index + 1}</Badge>
                      <span>{nameFor(id)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={index === 0}
                        onClick={() => moveModel(index, -1)}
                        aria-label="Move up"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={index === selected.length - 1}
                        onClick={() => moveModel(index, 1)}
                        aria-label="Move down"
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => removeModel(id)}
                        aria-label="Remove"
                      >
                        <X />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Add a model</Label>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
              {models.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">Could not load models from OpenRouter.</p>
              )}
              {freeModels.length > 0 && (
                <div>
                  <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Free</p>
                  {freeModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => addModel(m.id)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                    >
                      <span>{m.name}</span>
                      <Plus className="size-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
              {paidModels.length > 0 && (
                <div>
                  <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Paid</p>
                  {paidModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => addModel(m.id)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                    >
                      <span>{m.name}</span>
                      <Plus className="size-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-api-key">OpenRouter API key</Label>
            <Input
              id="ai-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={initialValues.hasApiKey ? "•••••••• (saved — leave blank to keep)" : "sk-or-..."}
            />
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <Label>Groq fallback (optional)</Label>
            <p className="text-sm text-muted-foreground">
              Tried only after every OpenRouter model above has failed — useful when OpenRouter&apos;s
              shared free-tier daily limit is exhausted, since Groq draws from a separate account
              and quota. Requires a free Groq API key (console.groq.com).
            </p>

            {groqSelected.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {groqSelected.map((id) => (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"
                  >
                    <span>{groqNameFor(id)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => removeGroqModel(id)}
                      aria-label="Remove"
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {availableGroqModels.length > 0 && (
              <div className="space-y-1 rounded-lg border p-2">
                {availableGroqModels.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => addGroqModel(m.id)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                  >
                    <span>{m.name}</span>
                    <Plus className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-2 pt-1">
              <Label htmlFor="groq-api-key">Groq API key</Label>
              <Input
                id="groq-api-key"
                type="password"
                value={groqApiKey}
                onChange={(e) => setGroqApiKey(e.target.value)}
                placeholder={
                  initialValues.hasGroqApiKey ? "•••••••• (saved — leave blank to keep)" : "gsk_..."
                }
              />
            </div>
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <Label>Image-based audience detection</Label>
            <p className="text-sm text-muted-foreground">
              For products the title/type can&apos;t clearly tell are male, female, or unisex,
              look at the product photo (via an AI vision model) to decide instead — improves
              reviewer-gender matching and gift framing. Checked once per product and cached, not
              on every generation. Uses one extra AI call per product the first time; free vision
              models on OpenRouter are sometimes rate-limited, in which case this silently falls
              back to the title/type guess.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant={visionAudienceEnabled ? "default" : "outline"}
                onClick={() => setVisionAudienceEnabled(true)}
              >
                Enabled
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!visionAudienceEnabled ? "default" : "outline"}
                onClick={() => setVisionAudienceEnabled(false)}
              >
                Disabled
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <Label>AI-only mode</Label>
            <p className="text-sm text-muted-foreground">
              By default, once every configured AI model/provider above fails or runs out of daily
              capacity, remaining reviews are still generated using the built-in phrase-bank
              generator instead of AI. Turn this on to stop generating instead, the moment that
              happens — the rest of that batch is skipped rather than continuing with phrase-bank
              content, and you&apos;ll get a warning that the AI limit was hit.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant={aiOnlyMode ? "default" : "outline"}
                onClick={() => setAiOnlyMode(true)}
              >
                Enabled
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!aiOnlyMode ? "default" : "outline"}
                onClick={() => setAiOnlyMode(false)}
              >
                Disabled
              </Button>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

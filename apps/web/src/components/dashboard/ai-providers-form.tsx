"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { AI_PROVIDER_PRESETS } from "@ai-shopify/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getJson, postJson } from "@/lib/api-client";

type ProviderDto = {
  id: string;
  label: string;
  slug: string;
  baseUrl: string;
  hasApiKey: boolean;
  models: string[];
  enabled: boolean;
};

const EMPTY = { label: "", slug: "", baseUrl: "", apiKey: "", models: "" };

/** Lets a store stack additional OpenAI-compatible providers on top of OpenRouter and Groq.
 *
 * This matters because provider capacity, not model choice, is what limits bulk generation:
 * OpenRouter's free models all draw on a single account-wide daily allowance, so adding more of
 * them changes nothing. Each provider added here is a separate account with its own quota, and
 * their allowances add up. */
export function AiProvidersForm() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderDto[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<{ id: string; isFree?: boolean }[] | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await getJson<{ providers: ProviderDto[] }>("/api/ai-providers");
      if (result.success) setProviders(result.data.providers);
      setLoaded(true);
    })();
  }, []);

  function applyPreset(slug: string) {
    const preset = AI_PROVIDER_PRESETS.find((p) => p.slug === slug);
    if (!preset) return;
    setForm({
      label: preset.label,
      slug: preset.slug,
      baseUrl: preset.baseUrl,
      apiKey: "",
      models: preset.suggestedModels.join(", "),
    });
  }

  /** Asks the provider what it can actually run today, rather than trusting the preset list — ids
   * get renamed and retired constantly, which is how a configured model ends up 404-ing. */
  async function discoverModels() {
    setDiscovering(true);
    setDiscovered(null);
    const result = await postJson<{ models: { id: string; isFree?: boolean }[]; freeCount: number }>(
      "/api/ai-providers/models",
      { slug: form.slug, baseUrl: form.baseUrl, apiKey: form.apiKey.trim() || undefined },
    );
    setDiscovering(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    setDiscovered(result.data.models);
    toast.success(
      result.data.freeCount > 0
        ? `${result.data.models.length} models (${result.data.freeCount} free)`
        : `${result.data.models.length} models available`,
    );
  }

  function addDiscovered(ids: string[]) {
    const current = form.models
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const merged = [...new Set([...current, ...ids])];
    setForm((f) => ({ ...f, models: merged.join(", ") }));
  }

  async function save() {
    setSaving(true);
    const result = await postJson<{ provider: ProviderDto }>("/api/ai-providers", {
      label: form.label,
      slug: form.slug,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey.trim() ? form.apiKey.trim() : undefined,
      models: form.models
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean),
      enabled: true,
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    setProviders((prev) => {
      const without = prev.filter((p) => p.slug !== result.data.provider.slug);
      return [...without, result.data.provider];
    });
    setForm(EMPTY);
    toast.success(`${result.data.provider.label} saved`);
    router.refresh();
  }

  async function remove(slug: string, label: string) {
    const response = await fetch(`/api/ai-providers?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(`Could not remove ${label}`);
      return;
    }
    setProviders((prev) => prev.filter((p) => p.slug !== slug));
    toast.success(`${label} removed`);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Additional AI providers</CardTitle>
        <CardDescription>
          Any OpenAI-compatible endpoint, tried after OpenRouter and Groq. Each one is a separate
          account with its own quota — stacking them is the only thing that actually raises daily
          throughput, since OpenRouter&apos;s free models all share a single account-wide allowance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loaded && providers.length > 0 && (
          <div className="space-y-2">
            {providers.map((p) => (
              <div key={p.slug} className="flex items-start justify-between gap-2 rounded-lg border p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {p.label} <span className="font-normal text-muted-foreground">({p.slug})</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{p.baseUrl}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.models.length > 0 ? p.models.join(", ") : "No models — this provider is inert"}
                  </p>
                </div>
                <Button variant="ghost" size="xs" onClick={() => remove(p.slug, p.label)} aria-label="Remove">
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 rounded-lg border border-dashed p-3">
          <div className="flex flex-wrap gap-2">
            {AI_PROVIDER_PRESETS.map((preset) => (
              <Button key={preset.slug} type="button" variant="outline" size="xs" onClick={() => applyPreset(preset.slug)}>
                <Plus />
                {preset.label}
              </Button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="prov-label">Name</Label>
              <Input
                id="prov-label"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Cerebras"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prov-slug">Id</Label>
              <Input
                id="prov-slug"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="cerebras"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prov-url">API base URL</Label>
            <Input
              id="prov-url"
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              placeholder="https://api.cerebras.ai/v1"
            />
            <p className="text-xs text-muted-foreground">
              Without <code>/chat/completions</code> — that gets appended automatically.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prov-key">API key</Label>
            <Input
              id="prov-key"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={
                providers.some((p) => p.slug === form.slug && p.hasApiKey)
                  ? "•••••••• (saved — leave blank to keep)"
                  : "sk-..."
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prov-models">Models</Label>
            <Input
              id="prov-models"
              value={form.models}
              onChange={(e) => setForm((f) => ({ ...f, models: e.target.value }))}
              placeholder="llama3.1-8b, llama-3.3-70b"
            />
            <p className="text-xs text-muted-foreground">
              Comma separated, tried in order. A provider with no models is never called.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={discovering || !form.baseUrl}
                onClick={discoverModels}
              >
                {discovering ? "Loading..." : "Load models from provider"}
              </Button>
              {discovered && discovered.some((m) => m.isFree) && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => addDiscovered(discovered.filter((m) => m.isFree).map((m) => m.id))}
                >
                  Add all free ({discovered.filter((m) => m.isFree).length})
                </Button>
              )}
              {discovered && (
                <Button type="button" variant="ghost" size="xs" onClick={() => setDiscovered(null)}>
                  Hide list
                </Button>
              )}
            </div>

            {discovered && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
                {discovered.length === 0 && (
                  <p className="text-xs text-muted-foreground">Provider returned no models.</p>
                )}
                {discovered.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => addDiscovered([m.id])}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted/50"
                  >
                    <span className="truncate">{m.id}</span>
                    {m.isFree === true && <span className="shrink-0 text-emerald-600">free</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button onClick={save} disabled={saving || !form.label || !form.slug || !form.baseUrl}>
            {saving ? "Saving..." : "Save provider"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { enhance } from "$app/forms";
  import { toast } from "svelte-sonner";
  import { invalidateAll } from "$app/navigation";

  import { WalletIcon, SaveIcon, AlertTriangleIcon } from "$lib/icons/index.js";
  import type { CurrencyCode } from "$lib/utils/currencies.js";

  let { form, data } = $props();

  // local state seeded from server
  let defaultCurrency = $state<CurrencyCode>(data.defaultCurrency);
  // mutable rate map keyed by currency code (string for input)
  let rates = $state<Record<string, string>>(
    Object.fromEntries(
      Object.entries(data.rates).map(([k, v]) => [k, String(v)])
    )
  );
  let recalcBdt = $state(true);
  let isSubmitting = $state(false);

  function isOverridden(code: CurrencyCode): boolean {
    if (code === "USD") return false;
    return Number(rates[code]) !== data.defaults[code];
  }

  function resetField(code: CurrencyCode) {
    rates[code] = String(data.defaults[code]);
  }
</script>

<div class="space-y-6">
  <div class="flex items-center gap-3">
    <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-md">
      <WalletIcon class="w-5 h-5 text-white" />
    </div>
    <div>
      <h2 class="text-xl font-bold">Currency Settings</h2>
      <p class="text-sm text-muted-foreground">
        Configure FX rates and the default display currency for the pricing page.
      </p>
    </div>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900/50 p-3 flex items-start gap-2">
      <AlertTriangleIcon class="w-4 h-4 text-red-600 mt-0.5" />
      <p class="text-sm text-red-700 dark:text-red-300">{form.error}</p>
    </div>
  {/if}

  {#if form?.success}
    <div class="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900/50 p-3 text-sm text-emerald-700 dark:text-emerald-300">
      ✓ {form.message || "Saved"}
    </div>
  {/if}

  <form
    method="POST"
    action="?/update"
    use:enhance={() => {
      isSubmitting = true;
      return async ({ result, update }) => {
        await update();
        isSubmitting = false;
        if (result.type === "success") {
          toast.success((result.data as any)?.message || "Currency settings saved");
          await invalidateAll();
        } else if (result.type === "failure") {
          toast.error((result.data as any)?.error || "Failed to save");
        }
      };
    }}
    class="space-y-6"
  >
    <!-- Default currency -->
    <Card.Root>
      <Card.Header>
        <Card.Title>Default display currency</Card.Title>
        <Card.Description>The currency users see by default on the pricing page.</Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {#each data.currencies as c}
            <button
              type="button"
              onclick={() => (defaultCurrency = c.code)}
              class={`cursor-pointer flex flex-col items-center gap-1 px-3 py-3 rounded-xl border transition ${
                defaultCurrency === c.code
                  ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                  : "border-border hover:border-foreground/30 hover:bg-accent/50"
              }`}
            >
              <span class="text-2xl leading-none">{c.flag}</span>
              <span class="text-sm font-bold">{c.code}</span>
              <span class="text-xs text-muted-foreground">{c.symbol}</span>
            </button>
          {/each}
        </div>
        <input type="hidden" name="defaultCurrency" value={defaultCurrency} />
      </Card.Content>
    </Card.Root>

    <!-- Exchange rates -->
    <Card.Root>
      <Card.Header>
        <Card.Title>Exchange rates (1 USD = ?)</Card.Title>
        <Card.Description>
          How many units of each currency equal 1 US Dollar. USD is fixed at 1.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="space-y-3">
          {#each data.currencies as c}
            <div class="grid grid-cols-[auto_1fr_auto] items-center gap-3 p-3 rounded-lg border border-border/60 bg-muted/20">
              <div class="flex items-center gap-2 min-w-[140px]">
                <span class="text-xl">{c.flag}</span>
                <div>
                  <div class="font-bold text-sm">{c.code}</div>
                  <div class="text-xs text-muted-foreground">{c.label}</div>
                </div>
              </div>

              {#if c.code === "USD"}
                <div class="flex items-center gap-2">
                  <span class="text-sm text-muted-foreground">1 USD =</span>
                  <Input value="1" disabled class="max-w-[140px] font-mono" />
                  <span class="text-sm text-muted-foreground">USD (fixed)</span>
                </div>
                <span></span>
              {:else}
                <div class="flex items-center gap-2 flex-wrap">
                  <Label for={`rate_${c.code}`} class="text-sm text-muted-foreground whitespace-nowrap">1 USD =</Label>
                  <Input
                    id={`rate_${c.code}`}
                    name={`rate_${c.code}`}
                    type="number"
                    step="any"
                    min="0.0001"
                    bind:value={rates[c.code]}
                    class="max-w-[140px] font-mono"
                    required
                  />
                  <span class="text-sm text-muted-foreground">{c.code}</span>
                  {#if isOverridden(c.code)}
                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold">
                      OVERRIDDEN
                    </span>
                  {/if}
                </div>
                <button
                  type="button"
                  onclick={() => resetField(c.code)}
                  class="cursor-pointer text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline whitespace-nowrap"
                  title={`Reset to default (${data.defaults[c.code]})`}
                >
                  Reset
                </button>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Recalc BDT toggle -->
        <div class="mt-6 flex items-start gap-3 p-4 rounded-lg border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-900/40">
          <Switch bind:checked={recalcBdt} id="recalcBdt" name="recalcBdt" />
          <div class="flex-1">
            <Label for="recalcBdt" class="text-sm font-semibold cursor-pointer">
              Also recalculate BDT plan prices in the database
            </Label>
            <p class="text-xs text-muted-foreground mt-1 leading-relaxed">
              When enabled, all paid plans' <code class="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">priceAmountBdt</code>
              field is rewritten using the new BDT rate. This is what Opaybd actually charges customers.
              Disable only if you maintain BDT prices manually under <a href="/admin/settings/plans" class="underline">Pricing Plans</a>.
            </p>
          </div>
        </div>
      </Card.Content>
    </Card.Root>

    <div class="flex items-center gap-3">
      <Button type="submit" disabled={isSubmitting || data.isDemoMode} class="gap-2">
        {#if isSubmitting}
          <div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
          Saving...
        {:else}
          <SaveIcon class="w-4 h-4" />
          Save Currency Settings
        {/if}
      </Button>

      {#if data.isDemoMode}
        <span class="text-xs text-muted-foreground">Demo mode — saving is disabled</span>
      {/if}
    </div>
  </form>

  <!-- Separate form (cannot be nested) for Reset action -->
  <form
    method="POST"
    action="?/reset"
    use:enhance={() => {
      return async ({ result, update }) => {
        await update();
        if (result.type === "success") {
          toast.success("Reset to default rates");
          rates = Object.fromEntries(
            Object.entries(data.defaults).map(([k, v]) => [k, String(v)])
          );
          await invalidateAll();
        }
      };
    }}
  >
    <Button type="submit" variant="ghost" disabled={data.isDemoMode} class="text-muted-foreground hover:text-foreground">
      Reset all rates to defaults
    </Button>
  </form>
</div>

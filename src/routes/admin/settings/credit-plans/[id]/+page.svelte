<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { goto } from "$app/navigation";
  import { enhance } from "$app/forms";

  let { data, form } = $props();

  let isSubmitting = $state(false);
  let isDeleting = $state(false);

  // Initial selection: form-rebound value if a previous submit failed,
  // otherwise the plan's stored array, otherwise the legacy single-type
  // column wrapped in an array.
  let selectedCreditTypes = $state<string[]>(
    form && "creditTypes" in form && Array.isArray((form as any).creditTypes)
      ? ((form as any).creditTypes as string[])
      : data.plan.creditTypes && data.plan.creditTypes.length > 0
        ? data.plan.creditTypes
        : [data.plan.creditType],
  );
  // Per-type credit amount map. Initialize from form-rebound, or stored
  // creditAmounts, or fallback to legacy single creditAmount for every type.
  function initialAmounts(): Record<string, string> {
    if (form && "creditAmounts" in form && (form as any).creditAmounts && typeof (form as any).creditAmounts === "object") {
      return Object.fromEntries(
        Object.entries((form as any).creditAmounts as Record<string, number>).map(([k, v]) => [k, String(v)]),
      );
    }
    const stored = (data.plan as any).creditAmounts as Record<string, number> | null | undefined;
    if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
      return Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, String(v)]));
    }
    // Legacy: same amount for every selected type
    const legacy: Record<string, string> = {};
    for (const t of selectedCreditTypes) legacy[t] = String(data.plan.creditAmount);
    return legacy;
  }
  let creditAmountsMap = $state<Record<string, string>>(initialAmounts());
  let currency = $state(form?.currency || data.plan.currency);

  const creditTypeOptions = [
    { value: "text", label: "Text" },
    { value: "image", label: "Image" },
    { value: "video", label: "Video" },
    { value: "audio", label: "Audio" },
  ];

  const currencyOptions = [
    { value: "usd", label: "USD ($)" },
    { value: "bdt", label: "BDT (৳)" },
  ];

  const currencyTriggerContent = $derived(
    currencyOptions.find((c) => c.value === currency)?.label ?? "USD",
  );

  function toggleCreditType(value: string, checked: boolean) {
    if (checked) {
      if (!selectedCreditTypes.includes(value)) {
        selectedCreditTypes = [...selectedCreditTypes, value];
      }
    } else {
      selectedCreditTypes = selectedCreditTypes.filter((v) => v !== value);
    }
  }
</script>

<svelte:head>
  <title>Edit Credit Plan - Admin Settings</title>
</svelte:head>

<div class="space-y-6">
  {#if data.isDemoMode}
    <div
      class="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-md"
    >
      <div class="flex items-center gap-2">
        <div class="flex-shrink-0">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clip-rule="evenodd"
            ></path>
          </svg>
        </div>
        <div>
          <p class="font-medium">Demo Mode Active</p>
          <p class="text-sm">
            All modifications are disabled. This is a read-only demonstration of
            the admin interface.
          </p>
        </div>
      </div>
    </div>
  {/if}

  <div class="flex justify-between items-center">
    <div>
      <h1 class="text-3xl font-bold tracking-tight">Edit Credit Plan</h1>
      <p class="text-muted-foreground">
        Modify the credit plan details below.
      </p>
    </div>
    <Button
      variant="outline"
      onclick={() => goto("/admin/settings/credit-plans")}
    >
      Back to Credit Plans
    </Button>
  </div>

  <Card.Root class="max-w-2xl">
    <Card.Header>
      <Card.Title>Credit Plan Details</Card.Title>
      <Card.Description>
        Update the information below to modify the credit plan. A plan can
        grant credits across multiple categories at once.
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <form
        method="POST"
        action="?/update"
        use:enhance={() => {
          isSubmitting = true;
          return async ({ update }) => {
            await update();
            isSubmitting = false;
          };
        }}
        class="space-y-6"
      >
        {#if form?.error}
          <div
            class="p-3 text-sm text-destructive-foreground bg-destructive/10 border border-destructive/20 rounded-md"
          >
            {form.error}
          </div>
        {/if}

        <div class="space-y-2">
          <Label for="name">Plan Name</Label>
          <Input
            id="name"
            name="name"
            placeholder="e.g., 100 Mixed Credits"
            value={form?.name || data.plan.name}
            required
          />
        </div>

        <div class="space-y-2">
          <Label>Credit Types</Label>
          <p class="text-xs text-muted-foreground">
            Select one or more. The credit amount below is granted to each
            selected type when a user buys this plan.
          </p>
          <div class="grid grid-cols-2 gap-3 pt-1">
            {#each creditTypeOptions as opt (opt.value)}
              <label
                class="flex items-center gap-2 p-2 rounded-md border cursor-pointer hover:bg-accent"
              >
                <input
                  type="checkbox"
                  name="creditTypes"
                  value={opt.value}
                  checked={selectedCreditTypes.includes(opt.value)}
                  onchange={(e) =>
                    toggleCreditType(
                      opt.value,
                      (e.currentTarget as HTMLInputElement).checked,
                    )}
                  class="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
                />
                <span class="text-sm font-medium">{opt.label}</span>
              </label>
            {/each}
          </div>
          {#if selectedCreditTypes.length === 0}
            <p class="text-xs text-muted-foreground">
              Select at least one credit type.
            </p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            placeholder="Describe what this credit plan includes..."
            value={form?.description || data.plan.description || ""}
            rows={3}
          />
        </div>

        {#if selectedCreditTypes.length > 0}
          <div class="space-y-3 p-3 rounded-md border bg-muted/30">
            <div>
              <Label class="text-sm font-semibold">Credit Amount per Type</Label>
              <p class="text-xs text-muted-foreground">
                Set how many credits each selected category gets when a user buys this plan.
              </p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {#each creditTypeOptions.filter((o) => selectedCreditTypes.includes(o.value)) as opt (opt.value)}
                <div class="space-y-1.5">
                  <Label for={"ca-"+opt.value} class="text-xs">
                    {opt.label} credits
                  </Label>
                  <Input
                    id={"ca-"+opt.value}
                    name={"creditAmount_"+opt.value}
                    type="number"
                    placeholder="100"
                    min="1"
                    bind:value={creditAmountsMap[opt.value]}
                    required
                  />
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Dual price entry: USD ($) for non-BDT users (manual gateways), BDT (৳) for BDT users (Opaybd) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <Label for="priceAmount">Price USD ($)</Label>
            <Input
              id="priceAmount"
              name="priceAmount"
              type="number"
              step="0.01"
              placeholder="9.99"
              min="0"
              value={form?.priceAmount ?? priceWholeUnits}
              required
            />
            <p class="text-xs text-muted-foreground">Direct USD amount. Shown to non-BDT users.</p>
          </div>
          <div class="space-y-2">
            <Label for="priceAmountBdt">Price BDT (৳)</Label>
            <Input
              id="priceAmountBdt"
              name="priceAmountBdt"
              type="number"
              step="1"
              placeholder="1100"
              min="0"
              value={form?.priceAmountBdt ?? priceBdtWholeUnits}
              required
            />
            <p class="text-xs text-muted-foreground">Direct BDT amount. Shown to BDT users via Opaybd.</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <Label for="currency">Currency</Label>
            <Select.Root type="single" name="currency" bind:value={currency}>
              <Select.Trigger>
                {currencyTriggerContent}
              </Select.Trigger>
              <Select.Content>
                {#each currencyOptions as option (option.value)}
                  <Select.Item value={option.value} label={option.label}>
                    {option.label}
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </div>

        <div class="space-y-2">
          <div class="flex items-center space-x-2">
            <Switch
              id="isActive"
              name="isActive"
              checked={form?.isActive ?? data.plan.isActive}
            />
            <Label for="isActive">Plan is Active</Label>
          </div>
          <p class="text-xs text-muted-foreground">
            Toggle to activate or deactivate this credit plan
          </p>
        </div>

        <div class="space-y-2">
          <div class="flex justify-end">
            <div class="flex space-x-2">
              <Button
                type="button"
                variant="outline"
                onclick={() => goto("/admin/settings/credit-plans")}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting ||
                  data.isDemoMode ||
                  selectedCreditTypes.length === 0}
              >
                {isSubmitting
                  ? "Updating..."
                  : data.isDemoMode
                    ? "Demo Mode - Read Only"
                    : "Update Credit Plan"}
              </Button>
            </div>
          </div>
          {#if data.isDemoMode}
            <p class="text-xs text-muted-foreground text-right">
              Updates are disabled in demo mode. This is a read-only
              demonstration.
            </p>
          {/if}
        </div>
      </form>

      <div class="mt-4 pt-4 border-t">
        <form
          method="POST"
          action="?/delete"
          use:enhance={() => {
            if (!confirm("Are you sure you want to delete this credit plan? This action cannot be undone.")) {
              return ({ cancel }) => cancel();
            }
            isDeleting = true;
            return async ({ update }) => {
              await update();
              isDeleting = false;
            };
          }}
        >
          <Button
            type="submit"
            variant="destructive"
            disabled={isDeleting || data.isDemoMode}
          >
            {isDeleting ? "Deleting..." : "Delete Plan"}
          </Button>
        </form>
      </div>
    </Card.Content>
  </Card.Root>
</div>

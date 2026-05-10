<script lang="ts">
  import * as Table from "$lib/components/ui/table/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { goto } from "$app/navigation";
  import { enhance } from "$app/forms";
  import { CirclePlusIcon } from "$lib/icons/index.js";

  let { data, form } = $props();

  let isSubmitting = $state(false);
  let showCreateForm = $state(false);

  // Multi-select credit types — defaults to whatever the form sent back on
  // validation failure, otherwise empty.
  let selectedCreditTypes = $state<string[]>(
    (form && "creditTypes" in form && Array.isArray((form as any).creditTypes)
      ? ((form as any).creditTypes as string[])
      : []),
  );
  // Per-type credit amount map: { text: 100, image: 50, ... }
  let creditAmountsMap = $state<Record<string, string>>(
    (form && "creditAmounts" in form && (form as any).creditAmounts && typeof (form as any).creditAmounts === "object"
      ? Object.fromEntries(
          Object.entries((form as any).creditAmounts as Record<string, number>).map(
            ([k, v]) => [k, String(v)],
          ),
        )
      : {}),
  );
  let currency = $state("usd");

  const creditTypeOptions = [
    { value: "text", label: "Text" },
    { value: "image", label: "Image" },
    { value: "video", label: "Video" },
    { value: "audio", label: "Audio" },
  ];

  const currencyOptions = [
    { value: "usd", label: "USD" },
    { value: "eur", label: "EUR" },
    { value: "gbp", label: "GBP" },
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

  function formatPrice(amountInCents: number, curr: string) {
    const amount = amountInCents / 100;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr.toUpperCase(),
    }).format(amount);
  }

  function formatCreditType(type: string) {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  // Show every type a plan grants — falls back to the legacy single-type
  // column for older rows created before multi-select existed.
  function planTypes(plan: { creditType: string; creditTypes: string[] | null }): string[] {
    if (plan.creditTypes && plan.creditTypes.length > 0) return plan.creditTypes;
    return [plan.creditType];
  }
</script>

<svelte:head>
  <title>Credit Plans - Admin Settings</title>
</svelte:head>

<div class="space-y-4">
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
      <h1 class="text-xl font-semibold tracking-tight flex items-center gap-2">
        <CirclePlusIcon class="w-6 h-6" />
        Credit Plans
      </h1>
      <p class="text-muted-foreground">
        Create, edit, and manage extra credit plans that users can purchase.
      </p>
    </div>
    <Button
      onclick={() => (showCreateForm = !showCreateForm)}
      disabled={data.isDemoMode}
    >
      {showCreateForm ? "Cancel" : "Create Credit Plan"}
    </Button>
  </div>

  {#if showCreateForm}
    <Card.Root class="max-w-2xl">
      <Card.Header>
        <Card.Title>New Credit Plan</Card.Title>
        <Card.Description>
          Fill in the information below. A plan can grant credits across
          multiple categories at once — pick all that apply.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <form
          method="POST"
          action="?/create"
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
              value={form?.name || ""}
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
              value={form?.description || ""}
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

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="priceAmount">Price (in cents)</Label>
              <Input
                id="priceAmount"
                name="priceAmount"
                type="number"
                placeholder="999"
                min="0"
                value={form?.priceAmount || ""}
                required
              />
              <p class="text-xs text-muted-foreground">
                Enter price in cents (e.g., 999 = $9.99)
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="priceAmountBdt">Price BDT (in paisa)</Label>
              <Input
                id="priceAmountBdt"
                name="priceAmountBdt"
                type="number"
                placeholder="50000"
                min="0"
                value={form?.priceAmountBdt || ""}
              />
              <p class="text-xs text-muted-foreground">
                For Opaybd payments (e.g., 50000 = ৳500)
              </p>
            </div>

            <div class="space-y-2">
              <Label for="currency">Currency</Label>
              <Select.Root
                type="single"
                name="currency"
                bind:value={currency}
              >
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

          <div class="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onclick={() => (showCreateForm = false)}
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
                ? "Creating..."
                : data.isDemoMode
                  ? "Demo Mode - Read Only"
                  : "Create Credit Plan"}
            </Button>
          </div>
        </form>
      </Card.Content>
    </Card.Root>
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>All Credit Plans</Card.Title>
      <Card.Description>
        {#if data.creditPlans.length === 0}
          No credit plans created
        {:else}
          {data.creditPlans.length} credit plan{data.creditPlans.length === 1
            ? ""
            : "s"}
        {/if}
      </Card.Description>
    </Card.Header>
    <Card.Content class="space-y-4">
      {#if data.creditPlans.length === 0}
        <div class="flex flex-col items-center justify-center py-12 space-y-4">
          <p class="text-muted-foreground">No credit plans found.</p>
          <Button
            onclick={() => (showCreateForm = true)}
            disabled={data.isDemoMode}
          >
            Create your first credit plan
          </Button>
        </div>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Name</Table.Head>
              <Table.Head>Types</Table.Head>
              <Table.Head>Credits</Table.Head>
              <Table.Head>Price</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head>Actions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.creditPlans as plan}
              <Table.Row>
                <Table.Cell class="font-medium">
                  {plan.name}
                </Table.Cell>
                <Table.Cell>
                  <div class="flex flex-wrap gap-1">
                    {#each planTypes(plan) as t}
                      <Badge variant="outline">{formatCreditType(t)}</Badge>
                    {/each}
                  </div>
                </Table.Cell>
                <Table.Cell class="font-mono">
                  {plan.creditAmount.toLocaleString()}
                </Table.Cell>
                <Table.Cell class="font-mono">
                  {formatPrice(plan.priceAmount, plan.currency)}
                </Table.Cell>
                <Table.Cell>
                  <form
                    method="POST"
                    action="?/toggleActive"
                    use:enhance={() => {
                      return async ({ update }) => {
                        await update();
                      };
                    }}
                  >
                    <input type="hidden" name="planId" value={plan.id} />
                    <div class="flex items-center space-x-2">
                      <button type="submit" disabled={data.isDemoMode}>
                        <Switch
                          checked={plan.isActive}
                          disabled={data.isDemoMode}
                        />
                      </button>
                      <Badge
                        variant={plan.isActive ? "default" : "secondary"}
                      >
                        {plan.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </form>
                </Table.Cell>
                <Table.Cell>
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={() =>
                      goto(`/admin/settings/credit-plans/${plan.id}`)}
                    disabled={data.isDemoMode}
                  >
                    Edit
                  </Button>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</div>

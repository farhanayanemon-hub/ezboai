<script lang="ts">
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { ArrowLeftIcon, CopyIcon, CheckIcon, LoaderIcon } from '$lib/icons/index.js';
  import { toast } from 'svelte-sonner';

  let { data } = $props();
  const { plan, gateways } = data;

  let selectedId = $state<string>(gateways[0]?.id || '');
  let txnReference = $state('');
  let senderInfo = $state('');
  let userNotes = $state('');
  let submitting = $state(false);
  let copied = $state<string | null>(null);

  const selected = $derived(gateways.find((g) => g.id === selectedId));
  const priceUsd = $derived((plan.priceAmount / 100).toFixed(2));

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = key;
      setTimeout(() => (copied = null), 1500);
    } catch {
      toast.error('Could not copy');
    }
  }

  async function submitOrder() {
    if (!selected) return toast.error('Select a payment method');
    if (!txnReference.trim()) return toast.error('Transaction reference is required');
    submitting = true;
    try {
      const res = await fetch('/api/checkout/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: plan.id,
          gateway: selected.id,
          txnReference: txnReference.trim(),
          senderInfo: senderInfo.trim() || null,
          userNotes: userNotes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to submit');
      toast.success('Order submitted! We will verify and activate within a few hours.');
      goto(`/checkout/manual/success?orderId=${json.orderId}`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to submit order');
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>Manual Checkout · {plan.name}</title></svelte:head>

<div class="min-h-screen bg-background">
  <div class="max-w-4xl mx-auto px-4 py-6 sm:py-10">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
      onclick={() => goto('/pricing')}
    >
      <ArrowLeftIcon class="size-4" /> Back to pricing
    </button>

    <h1 class="text-2xl sm:text-3xl font-bold mb-2">Manual Checkout</h1>
    <p class="text-muted-foreground mb-6 text-sm">
      Subscribe to <strong class="text-foreground">{plan.name}</strong> — ${priceUsd} {plan.currency.toUpperCase()} / {plan.billingInterval}
    </p>

    {#if gateways.length === 0}
      <Card.Root>
        <Card.Content class="py-10 text-center text-muted-foreground">
          No manual payment methods are currently enabled. Please contact support or use the regular checkout.
        </Card.Content>
      </Card.Root>
    {:else}
      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Left: gateway picker -->
        <div class="lg:col-span-1 space-y-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Payment method</p>
          {#each gateways as g}
            <button
              type="button"
              onclick={() => (selectedId = g.id)}
              class="w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left {selectedId === g.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'}"
            >
              <span class="text-2xl">{g.icon}</span>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-sm">{g.displayName || g.name}</div>
                <div class="text-xs text-muted-foreground truncate">Manual transfer</div>
              </div>
              {#if selectedId === g.id}<CheckIcon class="size-4 text-primary" />{/if}
            </button>
          {/each}
        </div>

        <!-- Right: instructions + submit form -->
        <div class="lg:col-span-2 space-y-4">
          {#if selected}
            <Card.Root>
              <Card.Header>
                <Card.Title class="flex items-center gap-2">
                  <span class="text-2xl">{selected.icon}</span>
                  Pay with {selected.displayName || selected.name}
                </Card.Title>
              </Card.Header>
              <Card.Content class="space-y-4">
                <div>
                  <Label class="text-xs">Amount to send</Label>
                  <div class="flex items-center gap-2 mt-1">
                    <code class="flex-1 font-mono text-lg p-3 rounded-md bg-muted">${priceUsd} {plan.currency.toUpperCase()}</code>
                    <Button variant="outline" size="sm" onclick={() => copyToClipboard(priceUsd, 'amt')}>
                      {#if copied === 'amt'}<CheckIcon class="size-4" />{:else}<CopyIcon class="size-4" />{/if}
                    </Button>
                  </div>
                </div>

                <div>
                  <Label class="text-xs">Send to (our {selected.name} account)</Label>
                  <div class="flex items-center gap-2 mt-1">
                    <code class="flex-1 font-mono text-sm p-3 rounded-md bg-muted break-all">{selected.accountInfo || '(not configured)'}</code>
                    <Button variant="outline" size="sm" onclick={() => copyToClipboard(selected.accountInfo, 'acc')} disabled={!selected.accountInfo}>
                      {#if copied === 'acc'}<CheckIcon class="size-4" />{:else}<CopyIcon class="size-4" />{/if}
                    </Button>
                  </div>
                </div>

                {#if selected.instructions}
                  <div class="text-sm p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100 whitespace-pre-wrap">
                    {selected.instructions}
                  </div>
                {/if}
              </Card.Content>
            </Card.Root>

            <Card.Root>
              <Card.Header>
                <Card.Title>Submit your payment proof</Card.Title>
                <Card.Description>After sending the payment, fill in the details below so we can verify and activate your subscription.</Card.Description>
              </Card.Header>
              <Card.Content class="space-y-4">
                <div>
                  <Label for="txn">Transaction ID / Reference <span class="text-destructive">*</span></Label>
                  <Input id="txn" bind:value={txnReference} placeholder="e.g. 7HW84920A1234567X" disabled={submitting} />
                </div>
                <div>
                  <Label for="sender">Sender name / email / wallet (optional)</Label>
                  <Input id="sender" bind:value={senderInfo} placeholder="Your {selected.name} account name or email" disabled={submitting} />
                </div>
                <div>
                  <Label for="notes">Notes for admin (optional)</Label>
                  <Textarea id="notes" bind:value={userNotes} placeholder="Anything else we should know?" rows={3} disabled={submitting} />
                </div>
                <Button class="w-full" onclick={submitOrder} disabled={submitting || !txnReference.trim()}>
                  {#if submitting}<LoaderIcon class="size-4 mr-2 animate-spin" /> Submitting...{:else}Submit Order{/if}
                </Button>
                <p class="text-xs text-muted-foreground text-center">
                  Your subscription will be activated after we verify the payment (usually within a few hours).
                </p>
              </Card.Content>
            </Card.Root>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

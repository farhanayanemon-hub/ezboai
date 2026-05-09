<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { UploadIcon, XIcon } from '$lib/icons/index.js';
  let { data, form } = $props();
</script>

<div class="space-y-6 min-w-0">
  <div>
    <h1 class="text-3xl font-bold">Manual Payment Gateways</h1>
    <p class="text-muted-foreground">
      Configure manual payment methods. When enabled, users will see them on the checkout page,
      submit a transaction reference, and the order will appear in
      <a href="/admin/orders?tab=new" class="underline">Orders → New Orders</a>
      for you to verify and approve manually.
    </p>
  </div>

  {#if form?.success}
    <div class="p-3 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 text-sm">
      ✓ Saved {form.savedId}
    </div>
  {/if}
  {#if form?.error}
    <div class="p-3 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 text-sm">
      ✗ {form.error}
    </div>
  {/if}

  <div class="grid gap-4">
    {#each data.gateways as g}
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-3">
            {#if g.iconUrl}
              <img src={g.iconUrl} alt={g.name} class="size-8 rounded object-contain bg-white border p-0.5" />
            {:else}
              <span class="text-2xl">{g.icon}</span>
            {/if}
            <span>{g.name}</span>
            {#if g.enabled}<span class="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">Active</span>
            {:else}<span class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Disabled</span>{/if}
          </Card.Title>
        </Card.Header>
        <Card.Content>
          <form method="POST" action="?/save" enctype="multipart/form-data" use:enhance class="space-y-4">
            <input type="hidden" name="id" value={g.id} />

            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="enabled" checked={g.enabled} />
              <span class="text-sm font-medium">Enable {g.name} as a payment option</span>
            </label>

            <!-- Icon / Logo upload -->
            <div class="space-y-2">
              <Label>Logo / Icon (optional — uploaded image overrides the default emoji)</Label>
              <div class="flex items-center gap-4 flex-wrap">
                <div class="size-16 border rounded-lg flex items-center justify-center bg-muted shrink-0 overflow-hidden">
                  {#if g.iconUrl}
                    <img src={g.iconUrl} alt={g.name} class="max-w-full max-h-full object-contain" />
                  {:else}
                    <span class="text-3xl">{g.icon}</span>
                  {/if}
                </div>
                <div class="flex-1 min-w-0 space-y-1">
                  <Input
                    type="file"
                    name="iconFile"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    class="cursor-pointer"
                  />
                  <p class="text-xs text-muted-foreground">PNG, JPG, SVG or WebP (recommended: square, 128x128 or larger).</p>
                  {#if g.iconUrl}
                    <label class="inline-flex items-center gap-1.5 text-xs text-destructive cursor-pointer mt-1">
                      <input type="checkbox" name="removeIcon" />
                      <XIcon class="size-3" /> Remove uploaded logo (use default emoji)
                    </label>
                  {/if}
                </div>
              </div>
            </div>

            <div class="grid lg:grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label for={'dn-'+g.id}>Display Name (shown to users)</Label>
                <Input id={'dn-'+g.id} name="displayName" value={g.displayName} placeholder="e.g. Pay with PayPal" />
              </div>
              <div class="space-y-2">
                <Label for={'ai-'+g.id}>
                  Your Account / Wallet
                  <span class="text-xs text-muted-foreground font-normal">(email, wallet address, UID)</span>
                </Label>
                <Input id={'ai-'+g.id} name="accountInfo" value={g.accountInfo} placeholder={g.id === 'binance' ? 'TRC20: TXxxxxxxxx...' : 'your-email@example.com'} />
              </div>
            </div>

            <div class="space-y-2">
              <Label for={'in-'+g.id}>Payment Instructions (English) — shown to users at checkout</Label>
              <Textarea id={'in-'+g.id} name="instructions" rows={5} value={g.instructions} />
              <p class="text-xs text-muted-foreground">Tell users exactly what to do: amount, network, where to send, what to copy back, expected wait time.</p>
            </div>

            <div class="flex justify-end">
              <Button type="submit">Save {g.name}</Button>
            </div>
          </form>
        </Card.Content>
      </Card.Root>
    {/each}
  </div>
</div>

<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { CheckCircleIcon } from '$lib/icons/index.js';
  const orderId = $derived($page.url.searchParams.get('orderId') || '');
</script>

<svelte:head><title>Order submitted</title></svelte:head>

<div class="min-h-screen bg-background flex items-center justify-center px-4">
  <Card.Root class="max-w-md w-full">
    <Card.Content class="py-10 text-center space-y-4">
      <div class="mx-auto w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
        <CheckCircleIcon class="size-8 text-emerald-600 dark:text-emerald-400" />
      </div>
      <h1 class="text-2xl font-bold">Order submitted!</h1>
      <p class="text-muted-foreground text-sm">
        Thanks — we received your payment proof. Our team will verify it and activate your subscription within a few hours. You'll receive an email once it's done.
      </p>
      {#if orderId}
        <p class="text-xs text-muted-foreground">Order ID: <code class="font-mono">{orderId.slice(0, 8)}</code></p>
      {/if}
      <div class="flex gap-2 justify-center pt-2">
        <Button variant="outline" onclick={() => goto('/')}>Go to chat</Button>
        <Button onclick={() => goto('/settings/billing')}>View billing</Button>
      </div>
    </Card.Content>
  </Card.Root>
</div>

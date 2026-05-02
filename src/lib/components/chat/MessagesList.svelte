<script lang="ts">
  import * as Carousel from "$lib/components/ui/carousel/index.js";
  import type { AIMessage } from "$lib/ai/types.js";

  // AI Elements components
  import {
    Message,
    MessageContent,
    MessageResponse,
    MessageActions,
    MessageAction,
    MessageAttachment,
    MessageAttachments,
  } from "$lib/components/ai-elements/new-message";

  // Tool components for function calling display
  import {
    Tool,
    ToolHeader,
    ToolContent,
    ToolInput,
    ToolOutput,
    type ToolUIPartState,
  } from "$lib/components/ai-elements/tool/index.js";

  // Custom components
  import MessageVideo from "./MessageVideo.svelte";
  import MessageLoading from "./MessageLoading.svelte";

  // Utilities
  import {
    getImageCount,
    getAllImages,
    imageToFileUIPart,
    getSingleImageUrl,
  } from "$lib/components/chat-utils/message-adapters.js";
  import { copyToClipboard } from "$lib/utils/clipboard.js";

  // Icons
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Pencil from "@lucide/svelte/icons/pencil";
  import {
    ImageIcon,
    VideoIcon,
    MoreHorizontalIcon,
    AudioLinesIcon,
    Music2Icon,
    Volume2Icon,
    VolumeXIcon,
    LoaderIcon,
    PauseIcon,
    PlayIcon,
  } from "$lib/icons/index.js";

  // Read Aloud state
  import { ReadAloudState } from "./read-aloud-state.svelte.js";

  // UI components
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";

  // Navigation
  import { goto } from "$app/navigation";

  // i18n
  import * as m from "$lib/../paraglide/messages.js";

  // Type for tool invocation
  type ToolInvocation = {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    state: ToolUIPartState;
    result?: unknown;
    error?: string;
  };

  interface Props {
    messages: AIMessage[];
    isLoading: boolean;
    isStreamingContent: boolean;
    error: string | null;
    getModelDisplayName: (modelName: string) => string;
    selectedModel: string;
    activeToolInvocations?: Map<string, ToolInvocation>;
    onRetryMessage?: (messageIndex: number) => void;
    retryingMessageIndex?: number | null;
    onBranchMessage?: (messageIndex: number) => void;
    isBranch?: boolean;
    branchAtIndex?: number | null;
    branchSourceId?: string | null;
    branchSourceTitle?: string | null;
    // Edit message props
    editingMessageIndex?: number | null;
    editingMessageContent?: string;
    onStartEdit?: (messageIndex: number) => void;
    onCancelEdit?: () => void;
    onUpdateEditContent?: (content: string) => void;
    onSaveEdit?: () => void;
    // Chat ID for Read Aloud caching
    chatId?: string | null;
  }

  let {
    messages,
    isLoading,
    isStreamingContent,
    error,
    getModelDisplayName,
    selectedModel,
    activeToolInvocations,
    onRetryMessage,
    retryingMessageIndex,
    onBranchMessage,
    isBranch = false,
    branchAtIndex = null,
    branchSourceId = null,
    branchSourceTitle = null,
    // Edit message props
    editingMessageIndex = null,
    editingMessageContent = "",
    onStartEdit,
    onCancelEdit,
    onUpdateEditContent,
    onSaveEdit,
    // Chat ID for Read Aloud caching
    chatId = null,
  }: Props = $props();

  // Track copy state per message for feedback
  let copiedMessageIndex = $state<number | null>(null);

  // Read Aloud state (single instance for all messages)
  const readAloudState = new ReadAloudState();

  // Clear read aloud cache when chatId changes (prevents stale cache from previous chat)
  $effect(() => {
    // Track chatId dependency
    const _chatId = chatId;
    // Clear the cache when chat changes (this runs on mount and when chatId changes)
    readAloudState.clearCache();
  });

  // Cleanup read aloud resources on component unmount
  $effect(() => {
    return () => {
      readAloudState.cleanup();
    };
  });

  async function handleCopy(content: string, index: number) {
    const success = await copyToClipboard(content || "");
    if (success) {
      copiedMessageIndex = index;
      setTimeout(() => {
        copiedMessageIndex = null;
      }, 2000);
    }
  }

  // Check if a message has images
  function hasImages(message: AIMessage): boolean {
    return !!(
      message.imageId ||
      message.imageUrl ||
      message.imageData ||
      message.imageIds?.length ||
      message.images?.length
    );
  }

  // Navigate to image-video page with prompt pre-filled
  function generateMedia(content: string, type: "image" | "video") {
    const truncatedContent = content.slice(0, 4000);
    const encodedPrompt = encodeURIComponent(truncatedContent);
    goto(`/image-video?prompt=${encodedPrompt}&tab=${type}`);
  }

  // Navigate to audio page with prompt pre-filled
  function generateAudio(content: string, type: "tts" | "music") {
    const truncatedContent = content.slice(0, 4000);
    const encodedPrompt = encodeURIComponent(truncatedContent);
    goto(`/audio?prompt=${encodedPrompt}&tab=${type}`);
  }
</script>

<div class="w-full xl:max-w-4xl mx-auto p-6">
  <div class="space-y-6">
    {#each messages as message, index (index)}
      {#if message.role === "user"}
        <!-- User message -->
        <Message from="user">
          <MessageContent>
            <div
              class="text-sm font-medium mb-1 text-slate-600 dark:text-slate-400 italic"
            >
              You
            </div>

            {#if editingMessageIndex === index}
              <!-- Edit Mode -->
              <div class="space-y-3">
                <textarea
                  class="w-full min-h-24 p-3 rounded-lg border border-input bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                  value={editingMessageContent}
                  oninput={(e) =>
                    onUpdateEditContent?.(
                      (e.target as HTMLTextAreaElement).value,
                    )}
                  disabled={isLoading}
                ></textarea>
                <div class="flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onclick={() => onSaveEdit?.()}
                    disabled={isLoading || !editingMessageContent.trim()}
                  >
                    {#if isLoading}
                      <RefreshCw class="size-4 animate-spin mr-1.5" />
                      {m["chat.regenerating"]()}
                    {:else}
                      {m["chat.save_and_regenerate"]()}
                    {/if}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => onCancelEdit?.()}
                    disabled={isLoading}
                  >
                    {m["chat.cancel"]()}
                  </Button>
                </div>
              </div>
            {:else}
              <!-- Normal View -->
              <MessageResponse content={message.content || ""} />
            {/if}
          </MessageContent>

          <!-- User message actions (Copy, Edit) - only show in normal mode, visible on hover -->
          {#if editingMessageIndex !== index && message.content}
            <MessageActions
              class="justify-end opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MessageAction
                tooltip="Copy"
                onclick={() => handleCopy(message.content || "", index)}
              >
                {#if copiedMessageIndex === index}
                  <Check class="size-4" />
                {:else}
                  <Copy class="size-4" />
                {/if}
              </MessageAction>
              <MessageAction
                tooltip={m["chat.edit"]()}
                onclick={() => onStartEdit?.(index)}
                disabled={isLoading || isStreamingContent}
              >
                <Pencil class="size-4" />
              </MessageAction>
            </MessageActions>
          {/if}

          <!-- User message image attachments (outside bubble) -->
          {#if message.type === "image" && hasImages(message)}
            {@const imageCount = getImageCount(message)}
            {@const allImages = getAllImages(message)}

            {#if imageCount >= 2}
              <!-- Multiple images - use carousel -->
              <div class="ml-auto flex items-center gap-2">
                <Carousel.Root class="w-24">
                  <Carousel.Content class="ml-0">
                    {#each allImages as image, imgIndex (imgIndex)}
                      <Carousel.Item class="pl-0">
                        <MessageAttachment data={imageToFileUIPart(image)} />
                      </Carousel.Item>
                    {/each}
                  </Carousel.Content>
                  <Carousel.Previous class="-left-10" />
                  <Carousel.Next class="-right-10" />
                </Carousel.Root>
              </div>
            {:else if imageCount === 1}
              <!-- Single image -->
              <MessageAttachments>
                <MessageAttachment
                  data={{
                    type: "file",
                    mediaType: message.mimeType || "image/png",
                    url: getSingleImageUrl(message),
                  }}
                />
              </MessageAttachments>
            {/if}
          {/if}
        </Message>
      {:else}
        <!-- AI message - full width -->
        <Message from="assistant" class="max-w-full">
          <!-- Model name above each AI response is intentionally hidden so the user only sees the EzboAI brand. The read-aloud controls below are kept and rendered only when audio is active. -->
          {#if (message.content || (!isLoading && !isStreamingContent)) && readAloudState.currentlyReadingMessageIndex === index && (readAloudState.isPlaying || readAloudState.isGenerating || readAloudState.audioElement)}
            <div class="text-sm font-medium mb-2 flex items-center">
              <span class="inline-flex items-center gap-1">
                {#if readAloudState.isGenerating}
                  <LoaderIcon class="w-3 h-3 animate-spin text-muted-foreground" />
                {:else}
                  <Volume2Icon
                    class="w-3 h-3 text-primary {readAloudState.isPlaying ? 'animate-pulse' : ''}"
                  />
                  <button
                    type="button"
                    class="p-0.5 rounded hover:bg-muted transition-colors"
                    onclick={() => readAloudState.togglePlayPause()}
                    title={readAloudState.isPlaying ? "Pause" : "Resume"}
                  >
                    {#if readAloudState.isPlaying}
                      <PauseIcon class="w-4 h-4 text-primary" />
                    {:else}
                      <PlayIcon class="w-4 h-4 text-primary" />
                    {/if}
                  </button>
                {/if}
              </span>
            </div>
          {/if}

          <!-- Tool invocations UI -->
          <!-- Show active tools during streaming (last message only) OR persisted tools from message -->
          {@const messageTools = (message as any).toolInvocations || []}
          {@const activeTools =
            activeToolInvocations && index === messages.length - 1
              ? [...activeToolInvocations.values()]
              : []}
          {@const allTools =
            activeTools.length > 0 ? activeTools : messageTools}

          {#if allTools.length > 0}
            <div class="mb-4 space-y-2">
              {#each allTools as toolInvocation (toolInvocation.toolCallId)}
                <Tool>
                  <ToolHeader
                    type={toolInvocation.toolName}
                    state={toolInvocation.state}
                  />
                  <ToolContent>
                    <ToolInput input={toolInvocation.args} />
                    <ToolOutput
                      output={toolInvocation.result}
                      errorText={toolInvocation.error}
                    />
                  </ToolContent>
                </Tool>
              {/each}
            </div>
          {/if}

          <MessageContent>
            {#if message.type === "image" && hasImages(message)}
              {@const imageCount = getImageCount(message)}
              {@const allImages = getAllImages(message)}

              <!-- Image message -->
              <div class="space-y-3">
                <MessageResponse content={message.content || ""} />

                {#if imageCount >= 2}
                  <!-- Multiple images - use carousel -->
                  <Carousel.Root class="w-full max-w-lg">
                    <Carousel.Content>
                      {#each allImages as image, imgIndex (imgIndex)}
                        <Carousel.Item>
                          <div class="border rounded-lg overflow-hidden">
                            <img
                              src={imageToFileUIPart(image).url}
                              alt=""
                              class="w-full h-auto"
                              loading="eager"
                            />
                          </div>
                        </Carousel.Item>
                      {/each}
                    </Carousel.Content>
                    <Carousel.Previous />
                    <Carousel.Next />
                  </Carousel.Root>
                {:else if imageCount === 1}
                  <!-- Single image -->
                  <div class="border rounded-lg overflow-hidden max-w-lg">
                    <img
                      src={getSingleImageUrl(message)}
                      alt=""
                      class="w-full h-auto"
                      loading="eager"
                    />
                  </div>
                {/if}
              </div>
            {:else if message.type === "video" && message.videoId}
              <!-- Video message -->
              <div class="space-y-3">
                <MessageResponse content={message.content || ""} />
                <MessageVideo videoId={message.videoId} />
              </div>
            {:else}
              <!-- Text message -->
              {#if message.content}
                <MessageResponse content={message.content || ""} />
              {:else if isLoading && !isStreamingContent}
                <!-- Show loading indicator for empty assistant message -->
                <MessageLoading />
              {/if}
            {/if}
          </MessageContent>

          <!-- Action buttons (only show when there's content) -->
          {#if message.content}
            <MessageActions>
              <MessageAction
                tooltip="Copy"
                onclick={() => handleCopy(message.content || "", index)}
              >
                {#if copiedMessageIndex === index}
                  <Check class="size-4" />
                {:else}
                  <Copy class="size-4" />
                {/if}
              </MessageAction>
              <MessageAction
                tooltip="Retry"
                onclick={() => onRetryMessage?.(index)}
                disabled={isLoading || retryingMessageIndex === index}
              >
                <RefreshCw
                  class="size-4 {retryingMessageIndex === index
                    ? 'animate-spin'
                    : ''}"
                />
              </MessageAction>
              <MessageAction
                tooltip="Branch"
                onclick={() => onBranchMessage?.(index)}
                disabled={isLoading}
              >
                <GitBranch class="size-4" />
              </MessageAction>
              <!-- More actions dropdown -->
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <MessageAction
                      {...props}
                      tooltip={m["chat.more_actions"]()}
                    >
                      <MoreHorizontalIcon class="size-4" />
                    </MessageAction>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" class="w-48">
                  <DropdownMenu.Item
                    class="cursor-pointer"
                    disabled={readAloudState.isGenerating &&
                      readAloudState.currentlyReadingMessageIndex !== index}
                    onclick={() =>
                      readAloudState.startReadAloud(
                        index,
                        message.content || "",
                        chatId,
                      )}
                  >
                    {#if readAloudState.currentlyReadingMessageIndex === index && readAloudState.isGenerating}
                      <LoaderIcon class="w-4 h-4 me-2 animate-spin" />
                      {m["chat.read_aloud_generating"]()}
                    {:else if readAloudState.currentlyReadingMessageIndex === index && readAloudState.isPlaying}
                      <VolumeXIcon class="w-4 h-4 me-2" />
                      {m["chat.read_aloud_stop"]()}
                    {:else}
                      <Volume2Icon class="w-4 h-4 me-2" />
                      {m["chat.read_aloud"]()}
                    {/if}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    class="cursor-pointer"
                    onclick={() =>
                      generateMedia(message.content || "", "image")}
                  >
                    <ImageIcon class="w-4 h-4 me-2" />
                    {m["chat.generate_image"]()}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    class="cursor-pointer"
                    onclick={() =>
                      generateMedia(message.content || "", "video")}
                  >
                    <VideoIcon class="w-4 h-4 me-2" />
                    {m["chat.generate_video"]()}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    class="cursor-pointer"
                    onclick={() => generateAudio(message.content || "", "tts")}
                  >
                    <AudioLinesIcon class="w-4 h-4 me-2" />
                    {m["chat.generate_tts"]()}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    class="cursor-pointer"
                    onclick={() =>
                      generateAudio(message.content || "", "music")}
                  >
                    <Music2Icon class="w-4 h-4 me-2" />
                    {m["chat.generate_music"]()}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </MessageActions>
          {/if}
        </Message>
      {/if}

      <!-- Branch separator after the branch point -->
      {#if isBranch && branchAtIndex !== null && index === branchAtIndex}
        <div class="flex items-center gap-3 my-6">
          <div
            class="flex-1 border-t border-dashed border-muted-foreground/40"
          ></div>
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitBranch class="w-3.5 h-3.5" />
            <span>{m["chat.branched_from"]()}</span>
            {#if branchSourceId}
              <a
                href="/chat/{branchSourceId}"
                class="font-medium underline hover:text-foreground transition-colors max-w-48 truncate"
                >{branchSourceTitle || m["chat.original_conversation"]()}</a
              >
            {:else}
              <span>{m["chat.original_conversation"]()}</span>
            {/if}
          </div>
          <div
            class="flex-1 border-t border-dashed border-muted-foreground/40"
          ></div>
        </div>
      {/if}
    {/each}

    <!-- Errors are shown as toast popups via svelte-sonner (see chat-state.svelte.ts and hooks.client.ts). No inline error block. -->

  </div>
</div>

import { goto } from "$app/navigation";
import { browser } from "$app/environment";
import type { AIModelConfig, AIMessage, AIResponse } from "$lib/ai/types.js";
import { isMultimodal } from "$lib/ai/types.js";
import { toast } from "svelte-sonner";
import { GUEST_MESSAGE_LIMIT, GUEST_ALLOWED_MODELS } from "$lib/constants/guest-limits.js";
import { supportsWebSearch, appendWebSearchSuffix, removeWebSearchSuffix } from "$lib/constants/web-search.js";
import { isTextFileMimeType } from "$lib/utils/file-types.js";

// File attachment types
export interface AttachedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  dataUrl?: string;
  content?: string; // For text files
  uploadedImageId?: string; // After upload to server
  uploadedImageUrl?: string; // Public URL after upload (presigned R2 URL or static path)
}

export class ChatState {
  // Chat state
  prompt = $state("");
  // Default selected model is XBrainPro's own brand. Available to free users, guests,
  // and paid users. The user can change it from the model picker at any time.
  selectedModel = $state("ezbo/ezbo-1.0");
  isLoading = $state(false);
  isStreamingContent = $state(false);
  messages = $state<AIMessage[]>([]);
  error = $state<string | null>(null);
  models = $state<AIModelConfig[]>([]);
  currentChatId = $state<string | null>(null);
  currentProjectId = $state<string | null>(null);
  userId = $state<string | null>(null);
  chatHistory = $state<
    Array<{
      id: string;
      title: string;
      model: string;
      pinned: boolean;
      isBranch: boolean;
      projectId?: string | null;
      createdAt: string;
      updatedAt: string;
    }>
  >([]);

  // Branch state for current chat
  currentChatIsBranch = $state(false);
  currentChatBranchAtIndex = $state<number | null>(null);
  currentChatBranchSourceId = $state<string | null>(null);
  currentChatBranchSourceTitle = $state<string | null>(null);

  // Loading states
  isLoadingChat = $state(false);
  isLoadingChatData = $state(false);
  isLoadingModels = $state(true); // Add loading state for models

  // UI states
  editingChatId = $state<string | null>(null);
  editingTitle = $state("");
  deletingChatId = $state<string | null>(null);
  showModelChangeDialog = $state(false);
  pendingModelChange = $state<string | null>(null);

  // Track previous model to detect changes
  previousModel = $state<string | null>(null);

  // File attachment state
  attachedFiles = $state<AttachedFile[]>([]);

  // Guest user limitations
  guestMessageCount = $state(0);

  // Tool selection
  selectedTool = $state<string | undefined>(undefined);

  // Track fresh chat creation to preserve tool selection
  isFreshChat = $state(false);

  // Web search toggle state
  webSearchEnabled = $state(false);

  // Favorite models state
  favoriteModels = $state<Set<string>>(new Set());
  isLoadingFavorites = $state(false);

  // Track active tool invocations during streaming
  activeToolInvocations = $state<Map<string, {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
    result?: unknown;
    error?: string;
  }>>(new Map());

  // Track which message is being retried
  retryingMessageIndex = $state<number | null>(null);

  // Edit message state
  editingMessageIndex = $state<number | null>(null);
  editingMessageContent = $state("");

  constructor() {
    // Auto-load models when state is created
    if (browser) {
      this.loadModels();
      this.loadGuestMessageCount();
      // Note: chat history will be loaded when session is established
    }
  }

  // Set up session reactivity - call this from the layout when session changes
  setupSessionReactivity(getSession: () => any) {
    if (!browser) return;

    let previousSessionId: string | null = null;

    $effect(() => {
      const session = getSession();
      const currentSessionId = session?.user?.id || null;

      // Update userId state
      this.userId = currentSessionId;

      // Only reload if session actually changed
      if (currentSessionId !== previousSessionId) {
        previousSessionId = currentSessionId;
        if (currentSessionId) {
          // User logged in, load chat history and reset guest count
          this.loadChatHistory();
          this.resetGuestMessageCount();
          this.loadModels(); // Reload models to get full access
          this.loadFavorites(); // Load user's favorite models
        } else {
          // User logged out, clear chat history and load guest count
          this.chatHistory = [];
          this.favoriteModels = new Set(); // Clear favorites for guests
          this.loadGuestMessageCount();
          this.loadModels(); // Reload models to get restricted access
        }
      }
    });
  }

  // Function to clean and normalize message content while preserving code blocks
  cleanMessageContent(content: string): string {
    if (!content) return '';

    // Split content into code blocks and non-code segments
    // Match fenced code blocks (```...```) with optional language specifier
    const codeBlockRegex = /(```[\s\S]*?```)/g;
    const segments = content.split(codeBlockRegex);

    // Process each segment - only clean non-code segments
    const processedSegments = segments.map((segment, index) => {
      // Odd indices are code blocks (captured groups)
      const isCodeBlock = segment.startsWith('```') && segment.endsWith('```');

      if (isCodeBlock) {
        // Preserve code blocks exactly as-is
        return segment;
      }

      // Clean non-code text
      return segment
        .replace(/[ \t]{3,}/g, " ")    // Replace 3+ consecutive spaces/tabs with single space
        .replace(/\n{3,}/g, "\n\n")    // Replace 3+ consecutive newlines with double newline
        .replace(/[ \t]+\n/g, "\n");   // Remove trailing spaces before newlines
        // NOTE: Removed the regex that strips leading whitespace after newlines
        // as it was destroying code indentation and nested markdown structures
    });

    return processedSegments.join('').trim();
  }

  // Load models from API
  async loadModels() {
    try {
      this.isLoadingModels = true;
      const response = await fetch("/api/models");
      if (response.ok) {
        const data = await response.json();
        this.models = data.models;

        // Set default model based on user login status
        if (this.models.length > 0) {
          if (!this.userId) {
            // Non-logged in user: try to use first configured guest model
            const firstConfiguredGuestModel = GUEST_ALLOWED_MODELS.find(modelName =>
              this.models.some(m => m.name === modelName)
            );

            if (firstConfiguredGuestModel) {
              this.selectedModel = firstConfiguredGuestModel;
            } else {
              // Fallback: find first guest-allowed model from the models list
              const firstGuestAllowed = this.models.find(m => m.isGuestAllowed);
              if (firstGuestAllowed) {
                this.selectedModel = firstGuestAllowed.name;
                console.warn(`Configured guest models not found, using fallback: ${firstGuestAllowed.name}`);
              } else {
                // Last resort: use first available model but log warning
                this.selectedModel = this.models[0].name;
                console.warn(`No guest-allowed models found, using fallback: ${this.models[0].name}`);
              }
            }
          } else if (!this.selectedModel) {
            // Logged in user: prefer XBrainPro's own model as the default if it
            // is in the available list, otherwise fall back to the first model.
            const ezboDefault = this.models.find(m => m.name === "ezbo/ezbo-1.0");
            this.selectedModel = ezboDefault ? ezboDefault.name : this.models[0].name;
          }
        }
      }
    } catch (err) {
      console.error("Failed to load models:", err);
    } finally {
      // Add a small delay to ensure model enrichment completes
      setTimeout(() => {
        this.isLoadingModels = false;
      }, 1500); // Wait for OpenRouter enrichment to complete
    }
  }

  // Load favorite models from API
  async loadFavorites() {
    if (!this.userId) {
      this.favoriteModels = new Set();
      return;
    }

    try {
      this.isLoadingFavorites = true;
      const response = await fetch('/api/models/favorites');
      if (response.ok) {
        const data = await response.json();
        this.favoriteModels = new Set(data.favorites);
      }
    } catch (err) {
      console.error('Failed to load favorites:', err);
    } finally {
      this.isLoadingFavorites = false;
    }
  }

  // Toggle favorite status for a model
  async toggleFavorite(modelName: string) {
    if (!this.userId) {
      toast.error('Sign in to save favorite models');
      return;
    }

    try {
      const response = await fetch(`/api/models/${encodeURIComponent(modelName)}/favorite`, {
        method: 'PATCH'
      });

      if (response.ok) {
        const { isFavorite, modelName: name } = await response.json();
        if (isFavorite) {
          this.favoriteModels = new Set([...this.favoriteModels, name]);
          toast.success('Model added to favorites');
        } else {
          const newFavorites = new Set(this.favoriteModels);
          newFavorites.delete(name);
          this.favoriteModels = newFavorites;
          toast.success('Model removed from favorites');
        }
      } else {
        toast.error('Failed to update favorites');
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      toast.error('Failed to update favorites');
    }
  }

  // Check if a model is favorited
  isFavorite(modelName: string): boolean {
    return this.favoriteModels.has(modelName);
  }

  // Load guest message count from sessionStorage
  loadGuestMessageCount() {
    if (!browser || this.userId) return;

    try {
      const stored = sessionStorage.getItem('guestMessageCount');
      this.guestMessageCount = stored ? parseInt(stored, 10) : 0;
    } catch (err) {
      console.warn('Failed to load guest message count:', err);
      this.guestMessageCount = 0;
    }
  }

  // Save guest message count to sessionStorage
  saveGuestMessageCount() {
    if (!browser || this.userId) return;

    try {
      sessionStorage.setItem('guestMessageCount', this.guestMessageCount.toString());
    } catch (err) {
      console.warn('Failed to save guest message count:', err);
    }
  }

  // Check if guest has reached message limit
  canGuestSendMessage(): boolean {
    if (this.userId) return true; // Logged in users have no limit
    return this.guestMessageCount < GUEST_MESSAGE_LIMIT;
  }

  // Increment guest message count
  incrementGuestMessageCount() {
    if (!this.userId) {
      this.guestMessageCount++;
      this.saveGuestMessageCount();
    }
  }

  // Reset guest message count (when user logs in)
  resetGuestMessageCount() {
    this.guestMessageCount = 0;
    if (browser) {
      try {
        sessionStorage.removeItem('guestMessageCount');
      } catch (err) {
        console.warn('Failed to clear guest message count:', err);
      }
    }
  }

  // Validate model selection using server-provided flags
  validateModelSelection(modelName: string): boolean {
    // Strip :online suffix if present (web search enabled models)
    const baseModelName = removeWebSearchSuffix(modelName);
    const model = this.models.find(m => m.name === baseModelName);
    if (!model) {
      console.warn(`Model ${modelName} not found in available models`);
      return false;
    }

    // Use the isLocked flag that's set by the server based on user status and demo mode
    return !model.isLocked;
  }

  // Safe model selection with validation
  selectModel(modelName: string): boolean {
    if (!this.validateModelSelection(modelName)) {
      const model = this.models.find(m => m.name === modelName);
      let errorMsg: string;

      if (!this.userId) {
        // Guest user error message
        errorMsg = "Guest users can only use the allowed guest models. Please sign up for access to all models.";
      } else if (this.userId && model?.isDemoMode) {
        // Demo mode error message (logged in user in demo mode)
        errorMsg = "This model is not available in Demo Mode. Contact administrator for full access.";
      } else {
        // Fallback error message
        errorMsg = "This model is not available with your current access level.";
      }

      this.error = errorMsg;
      toast.error(errorMsg);
      return false;
    }

    this.selectedModel = modelName;
    this.error = null;

    // Clear web search if new model doesn't support it
    this.clearWebSearchIfUnsupported();

    return true;
  }

  // Load chat history from API
  async loadChatHistory() {
    try {
      const response = await fetch("/api/chats");
      if (response.ok) {
        const data = await response.json();
        this.chatHistory = data.chats;
      } else if (response.status === 401) {
        // User not authenticated, clear chat history
        this.chatHistory = [];
      }
    } catch (err) {
      console.error("Failed to load chat history:", err);
    }
  }

  // Refresh chat history (useful when auth state changes)
  async refreshChatHistory() {
    await this.loadChatHistory();
  }

  // Generate chat title from first message
  generateChatTitle(content: string): string {
    const words = content.trim().split(" ").slice(0, 6);
    return (
      words.join(" ") + (content.trim().split(" ").length > 6 ? "..." : "")
    );
  }

  // Format date for display (shows in user's local timezone)
  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    // Normalize dates to start of day for accurate comparison
    const normalizeDate = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const normalizedDate = normalizeDate(date);
    const normalizedToday = normalizeDate(today);
    const normalizedYesterday = normalizeDate(yesterday);

    if (normalizedDate.getTime() === normalizedToday.getTime()) {
      return "Today";
    } else if (normalizedDate.getTime() === normalizedYesterday.getTime()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString();
    }
  }

  // Load chat from URL (no URL update needed)
  async loadChatFromId(chatId: string) {
    if (this.isLoadingChat) return;

    try {
      this.isLoadingChat = true;
      this.isLoadingChatData = true;

      const response = await fetch(`/api/chats/${chatId}`);
      if (response.ok) {
        const data = await response.json();

        // Clear current state first for smooth transition
        this.messages = [];
        this.error = null;
        this.currentChatId = chatId;
        this.clearSelectedTool(); // Clear tool selection when loading existing chat
        this.resetFreshChatFlag(); // Reset fresh chat flag for existing chat loads

        // Small delay to ensure smooth transition
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Detect if the stored model had web search enabled (has :online suffix)
        const storedModel = data.chat.model;
        const hadWebSearchEnabled = storedModel.endsWith(':online');

        // Set model first, then messages to avoid triggering the dialog
        // Strip :online suffix if present (web search enabled chats store model with suffix)
        this.selectedModel = removeWebSearchSuffix(storedModel);
        this.previousModel = removeWebSearchSuffix(storedModel); // Update previous model to match

        // Restore web search state based on stored model
        // Only enable if both: stored model had :online AND current model still supports it
        this.webSearchEnabled = hadWebSearchEnabled && supportsWebSearch(this.selectedModel);
        // Clean all message content when loading from database
        this.messages = data.chat.messages.map((msg: AIMessage) => ({
          ...msg,
          content: this.cleanMessageContent(msg.content || ''),
        }));

        // Set branch state for current chat
        this.currentChatIsBranch = data.chat.isBranch || false;
        this.currentChatBranchAtIndex = data.chat.branchAtIndex ?? null;
        this.currentChatBranchSourceId = data.chat.branchSourceChatId ?? null;
        // Look up source chat title from chat history if available
        if (data.chat.branchSourceChatId) {
          const sourceChat = this.chatHistory.find(c => c.id === data.chat.branchSourceChatId);
          this.currentChatBranchSourceTitle = sourceChat?.title ?? null;
        } else {
          this.currentChatBranchSourceTitle = null;
        }

        // Set project association
        this.currentProjectId = data.chat.projectId || null;

        // Refresh chat history to show updated order
        this.loadChatHistory();
        return true;
      } else {
        return false; // Chat not found or unauthorized
      }
    } catch (err) {
      console.error("Failed to load chat:", err);
      this.error = "Failed to load chat";
      toast.error("Failed to load chat");
      return false;
    } finally {
      this.isLoadingChat = false;
      this.isLoadingChatData = false;
    }
  }

  // Load chat and update URL (for navigation from sidebar)
  async loadChat(chatId: string) {
    // Skip loading if this chat is already active
    if (this.currentChatId === chatId) {
      // Still ensure URL is correct
      goto(`/chat/${chatId}`, { replaceState: true, noScroll: true });
      return;
    }

    const success = await this.loadChatFromId(chatId);
    if (success) {
      // Update URL to new route structure
      goto(`/chat/${chatId}`, { replaceState: true, noScroll: true });
    }
  }

  // Start new chat
  startNewChat() {
    // Set loading flag to prevent model change dialog
    this.isLoadingChatData = true;
    // Clear chat state
    this.currentChatId = null;
    this.currentProjectId = null;
    this.messages = [];
    this.error = null;
    this.clearSelectedTool(); // Clear tool selection when starting new chat
    this.resetFreshChatFlag(); // Reset fresh chat flag when starting new chat
    this.webSearchEnabled = false; // Reset web search toggle for new chats
    // Reset branch state for new chat
    this.currentChatIsBranch = false;
    this.currentChatBranchAtIndex = null;
    this.currentChatBranchSourceId = null;
    this.currentChatBranchSourceTitle = null;
    // Sync previous model with current selection
    this.previousModel = this.selectedModel;
    // Navigate to new chat page
    goto("/newchat", { replaceState: true, noScroll: true });
    // Reset loading flag
    this.isLoadingChatData = false;
  }

  /**
   * Prepare ChatState for starting a new chat within a project.
   * Called from the project detail page before handleSubmit.
   */
  startProjectChat(projectId: string) {
    this.currentProjectId = projectId;
    this.currentChatId = null;
    this.messages = [];
    this.error = null;
    this.clearSelectedTool();
    this.resetFreshChatFlag();
  }

  // Save or update chat
  async saveChat() {
    if (this.messages.length === 0) return;

    try {
      const title = this.generateChatTitle(this.messages[0].content || 'Untitled Chat');

      if (this.currentChatId) {
        // Update existing chat
        const response = await fetch(`/api/chats/${this.currentChatId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            model: this.selectedModel,
            messages: this.messages,
          }),
        });

        if (response.ok) {
          const updatedChat = await response.json();

          // Update the chat in local state immediately for better UX
          const chatIndex = this.chatHistory.findIndex(
            (chat) => chat.id === this.currentChatId
          );
          if (chatIndex !== -1) {
            // Update the existing chat and move it to the top
            const updated = { ...this.chatHistory[chatIndex], ...updatedChat.chat };
            this.chatHistory = [
              updated,
              ...this.chatHistory.filter((chat) => chat.id !== this.currentChatId),
            ];
          }
          // Also refresh from server to ensure consistency
          this.loadChatHistory();
        }
      } else {
        // Create new chat
        const response = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            model: this.selectedModel,
            messages: this.messages
          }),
        });

        if (response.ok) {
          const data = await response.json();
          this.currentChatId = data.chat.id;
          this.markAsFreshChat(); // Mark as fresh chat to preserve tool selection
          // Update URL to reflect the new chat with new route structure
          goto(`/chat/${data.chat.id}`, {
            replaceState: true,
            noScroll: true,
          });
          this.loadChatHistory(); // Refresh chat history
        }
      }
    } catch (err) {
      console.error("Failed to save chat:", err);
    }
  }

  // Save or update a specific chat by ID (used to prevent race conditions)
  async saveChatById(chatId: string | null, messages: AIMessage[], model: string): Promise<{ chatId: string | null }> {
    if (messages.length === 0) return { chatId };

    try {
      const title = this.generateChatTitle(messages[0].content || 'Untitled Chat');

      if (chatId) {
        // Update existing chat
        const response = await fetch(`/api/chats/${chatId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            model,
            messages,
          }),
        });

        if (response.ok) {
          const updatedChat = await response.json();

          // Only update local state if this is still the current chat
          if (this.currentChatId === chatId) {
            const chatIndex = this.chatHistory.findIndex(
              (chat) => chat.id === chatId
            );
            if (chatIndex !== -1) {
              const updated = { ...this.chatHistory[chatIndex], ...updatedChat.chat };
              this.chatHistory = [
                updated,
                ...this.chatHistory.filter((chat) => chat.id !== chatId),
              ];
            }
          }

          // Refresh chat history for consistency
          this.loadChatHistory();
          return { chatId };
        }
      } else {
        // Create new chat
        const response = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            model,
            messages,
            projectId: this.currentProjectId || undefined,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const newChatId = data.chat.id;

          // Only update current state if user hasn't navigated away
          if (this.currentChatId === null) {
            this.currentChatId = newChatId;
            this.markAsFreshChat();
            goto(`/chat/${newChatId}`, {
              replaceState: true,
              noScroll: true,
            });
          }

          this.loadChatHistory();
          return { chatId: newChatId };
        }
      }

      return { chatId };
    } catch (err) {
      console.error("Failed to save chat by ID:", err);
      return { chatId };
    }
  }

  // Start delete process - show confirmation dialog
  startDeleteChat(chatId: string) {
    this.deletingChatId = chatId;
  }

  // Cancel delete process
  cancelDelete() {
    this.deletingChatId = null;
  }

  // Handle model change confirmation
  confirmModelChange() {
    if (this.pendingModelChange) {
      this.selectedModel = this.pendingModelChange;
      this.previousModel = this.pendingModelChange;
      this.startNewChat();
    }
    this.showModelChangeDialog = false;
    this.pendingModelChange = null;
  }

  // Cancel model change
  cancelModelChange() {
    this.showModelChangeDialog = false;
    this.pendingModelChange = null;
  }

  // Confirm and delete chat
  async confirmDeleteChat() {
    if (!this.deletingChatId) return;

    try {
      const response = await fetch(`/api/chats/${this.deletingChatId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        // Show success toast
        toast.success("Chat deleted successfully");

        // If deleting current chat, clear state and go to new chat
        if (this.currentChatId === this.deletingChatId) {
          this.currentChatId = null;
          this.messages = [];
          this.error = null;
          goto("/newchat", { replaceState: true, noScroll: true });
        }
        this.loadChatHistory();
      } else {
        // Show error toast for failed deletion
        toast.error("Failed to delete chat");
      }
    } catch (err) {
      console.error("Failed to delete chat:", err);
      toast.error("Failed to delete chat");
    } finally {
      this.deletingChatId = null;
    }
  }

  // Toggle pin status for a chat
  async toggleChatPin(chatId: string) {
    try {
      const response = await fetch(`/api/chats/${chatId}/pin`, {
        method: "PATCH",
      });

      if (response.ok) {
        const { chat } = await response.json();
        // Show success toast
        toast.success(chat.pinned ? "Chat pinned" : "Chat unpinned");
        // Refresh chat history to reflect changes
        this.loadChatHistory();
      } else {
        toast.error("Failed to update pin status");
      }
    } catch (err) {
      console.error("Failed to toggle pin:", err);
      toast.error("Failed to update pin status");
    }
  }

  // Derived state for pinned chats
  get pinnedChats() {
    return this.chatHistory.filter(chat => chat.pinned);
  }

  // Derived state for unpinned chats (recent chats)
  get recentChats() {
    return this.chatHistory.filter(chat => !chat.pinned);
  }

  // Start editing chat title
  startEditingTitle(chatId: string, currentTitle: string) {
    this.editingChatId = chatId;
    this.editingTitle = currentTitle;
  }

  // Cancel editing
  cancelEditing() {
    this.editingChatId = null;
    this.editingTitle = "";
  }

  // Save renamed chat title
  async saveRenamedTitle(chatId: string) {
    if (!this.editingTitle.trim()) return;

    try {
      // Get the full chat data first
      const chatResponse = await fetch(`/api/chats/${chatId}`);
      if (!chatResponse.ok) {
        toast.error("Failed to rename chat");
        return;
      }

      const chatData = await chatResponse.json();

      const response = await fetch(`/api/chats/${chatId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: this.editingTitle.trim(),
          model: chatData.chat.model,
          messages: chatData.chat.messages,
        }),
      });

      if (response.ok) {
        toast.success("Chat renamed successfully");
        this.cancelEditing();
        this.loadChatHistory();
      } else {
        toast.error("Failed to rename chat");
      }
    } catch (err) {
      console.error("Failed to rename chat:", err);
      toast.error("Failed to rename chat");
    }
  }

  // File attachment methods
  addAttachedFiles(files: AttachedFile[]) {
    this.attachedFiles = [...this.attachedFiles, ...files];
  }

  removeAttachedFile(fileId: string) {
    this.attachedFiles = this.attachedFiles.filter(f => f.id !== fileId);
  }

  clearAttachedFiles() {
    this.attachedFiles = [];
  }

  // Check if selected model supports image input
  selectedModelSupportsImageInput(): boolean {
    const model = this.models.find(m => m.name === this.selectedModel);
    return model?.supportsImageInput === true;
  }

  // Check if any attached files are images
  hasImageAttachments(): boolean {
    return this.attachedFiles.some(f => f.type.startsWith('image/'));
  }

  // Check if any attached files are text
  hasTextAttachments(): boolean {
    return this.attachedFiles.some(f =>
      f.type.startsWith('text/') || f.type === 'application/json'
    );
  }

  // Tool selection methods
  /**
   * Set the selected tool for the current chat session.
   */
  setSelectedTool(tool: string | undefined) {
    this.selectedTool = tool;
  }

  /**
   * Clear the currently selected tool.
   */
  clearSelectedTool() {
    this.selectedTool = undefined;
  }

  /**
   * Mark the current chat as freshly created to preserve tool selection during navigation.
   * This flag is used to distinguish between new chat creation (tool persists) and
   * existing chat navigation (tool clears).
   */
  markAsFreshChat() {
    this.isFreshChat = true;
  }

  /**
   * Reset the fresh chat flag. This should be called after handling the fresh chat state
   * or when navigating to ensure the flag doesn't persist incorrectly.
   */
  resetFreshChatFlag() {
    this.isFreshChat = false;
  }

  // Web search methods
  /**
   * Toggle web search for the current chat session.
   */
  toggleWebSearch() {
    this.webSearchEnabled = !this.webSearchEnabled;
  }

  /**
   * Check if the currently selected model supports web search.
   */
  isWebSearchAvailable(): boolean {
    return supportsWebSearch(this.selectedModel);
  }

  /**
   * Clear web search if the current model doesn't support it.
   * Should be called when model changes.
   */
  clearWebSearchIfUnsupported() {
    if (!this.isWebSearchAvailable()) {
      this.webSearchEnabled = false;
    }
  }

  // Submit chat message
  async handleSubmit(providedFiles?: AttachedFile[]) {
    // Use provided files (from PromptInput) if available, otherwise fall back to internal state
    const filesToUse = providedFiles && providedFiles.length > 0
      ? providedFiles
      : this.attachedFiles;

    if ((!this.prompt && filesToUse.length === 0) || this.isLoading) return;

    // Capture the current chat ID and model at the start of the request
    // This ensures we save to the correct chat even if the user navigates away
    const requestChatId = this.currentChatId;
    // Apply web search suffix if enabled and supported
    const requestModel = this.webSearchEnabled && this.isWebSearchAvailable()
      ? appendWebSearchSuffix(this.selectedModel)
      : this.selectedModel;
    let actualChatId = requestChatId; // Will be updated if a new chat is created

    // Use the ChatState's selectedTool
    const toolToUse = this.selectedTool;

    // Check if using web search (for synthetic tool UI)
    const isUsingWebSearch = requestModel.endsWith(':online');
    const webSearchToolCallId = isUsingWebSearch ? `web_search_${Date.now()}` : null;

    // Check guest message limits
    if (!this.canGuestSendMessage()) {
      this.error = `You've reached the ${GUEST_MESSAGE_LIMIT} message limit for guest users. Please sign up for an account to continue chatting.`;
      toast.error(this.error);
      return;
    }

    // Check if user is trying to use a locked model
    const selectedModelData = this.models.find(m => m.name === this.selectedModel);
    if (selectedModelData?.isLocked) {
      let errorMsg: string;
      if (!this.userId) {
        errorMsg = "Guest users can only use the allowed guest models. Please sign up for access to all models.";
      } else if (selectedModelData?.isDemoMode) {
        errorMsg = "This model is not available in Demo Mode. Contact administrator for full access.";
      } else {
        errorMsg = "This model is not available with your current access level.";
      }
      this.error = errorMsg;
      toast.error(errorMsg);
      return;
    }

    const cleanedPrompt = this.cleanMessageContent(this.prompt);
    // Don't submit if cleaned content is empty and no files attached
    if (!cleanedPrompt && filesToUse.length === 0) return;

    try {
      // Upload image files that have dataUrl but no uploadedImageId yet
      const imageFilesNeedingUpload = filesToUse.filter(f =>
        f.type.startsWith('image/') && !f.uploadedImageId
      );

      for (const file of imageFilesNeedingUpload) {
        try {
          let base64Data: string;

          if (file.dataUrl) {
            // Use existing dataUrl (from PromptInput)
            base64Data = file.dataUrl.split(',')[1]; // Remove data URL prefix
          } else if (file.file && file.file.size > 0) {
            // Fallback: read from File object
            const reader = new FileReader();
            base64Data = await new Promise<string>((resolve, reject) => {
              reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1]);
              };
              reader.onerror = reject;
              reader.readAsDataURL(file.file);
            });
          } else {
            console.warn(`Skipping ${file.name}: no dataUrl or valid File object`);
            continue;
          }

          const response = await fetch('/api/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData: base64Data,
              mimeType: file.type,
              filename: file.name,
              chatId: this.currentChatId
            })
          });

          if (response.ok) {
            const result = await response.json();
            file.uploadedImageId = result.imageId;
            file.uploadedImageUrl = result.imageUrl;
          } else {
            console.error(`Failed to upload ${file.name}:`, await response.text());
          }
        } catch (uploadError) {
          console.error(`Error uploading ${file.name}:`, uploadError);
        }
      }

      // Create user message with attachments
      let messageContent = cleanedPrompt;

      // Add text file content to the message if present
      const textAttachments = filesToUse.filter(f => isTextFileMimeType(f.type));
      if (textAttachments.length > 0) {
        const fileContents = textAttachments.map(f =>
          `\n\n---\nFile: ${f.name} (${f.type})\n---\n${f.content || ''}`
        ).join('');
        messageContent = cleanedPrompt + fileContents;
      }

      const userMessage: AIMessage = {
        role: "user",
        content: messageContent,
        type: filesToUse.some(f => f.type.startsWith('image/')) ? "image" : "text"
      };

      // Add image attachments to message (support multiple images)
      const imageAttachments = filesToUse.filter(f => f.type.startsWith('image/'));
      if (imageAttachments.length > 0) {
        // Handle multiple images
        if (imageAttachments.length === 1) {
          // Single image - use backwards compatible fields
          const imageAttachment = imageAttachments[0];
          if (imageAttachment?.uploadedImageId) {
            userMessage.imageId = imageAttachment.uploadedImageId;
            userMessage.mimeType = imageAttachment.type;
          } else if (imageAttachment?.dataUrl && imageAttachment.type) {
            // Fallback to base64 - this shouldn't happen normally (upload should have succeeded)
            console.warn('Image upload failed or was skipped, falling back to base64 storage for:', imageAttachment.name);
            const base64Data = imageAttachment.dataUrl.split(',')[1]; // Remove data URL prefix
            userMessage.imageData = base64Data;
            userMessage.mimeType = imageAttachment.type;
          }
        } else {
          // Multiple images - use new array fields
          const uploadedImages = imageAttachments.filter(img => img.uploadedImageId);
          const dataImages = imageAttachments.filter(img => !img.uploadedImageId && img.dataUrl);

          if (uploadedImages.length > 0) {
            userMessage.imageIds = uploadedImages.map(img => img.uploadedImageId!);
          }

          if (dataImages.length > 0 || uploadedImages.length > 0) {
            userMessage.images = imageAttachments.map(img => {
              if (img.uploadedImageId) {
                return {
                  imageId: img.uploadedImageId,
                  mimeType: img.type
                };
              } else if (img.dataUrl) {
                const base64Data = img.dataUrl.split(',')[1]; // Remove data URL prefix
                return {
                  imageData: base64Data,
                  mimeType: img.type
                };
              }
              return {
                mimeType: img.type
              };
            }).filter(img => img.imageId || img.imageData); // Filter out incomplete entries
          }
        }
      }

      // Create a local copy of messages for this request to avoid race conditions
      let requestMessages = [...this.messages, userMessage];

      // Add user message to conversation (only if still viewing this chat)
      if (this.currentChatId === requestChatId) {
        this.messages = requestMessages;
      }

      // Increment guest message count for non-logged users
      this.incrementGuestMessageCount();

      this.prompt = "";
      this.clearAttachedFiles(); // Clear attachments after sending
      this.isLoading = true;
      this.isStreamingContent = false; // Reset streaming state for new request
      this.error = null;

      // Add synthetic web search tool invocation for UI (OpenRouter doesn't emit tool events for web search)
      if (isUsingWebSearch && webSearchToolCallId) {
        this.activeToolInvocations.set(webSearchToolCallId, {
          toolCallId: webSearchToolCallId,
          toolName: 'web_search',
          args: { query: cleanedPrompt },
          state: 'input-available'  // Shows "Running" badge
        });
        this.activeToolInvocations = new Map(this.activeToolInvocations);  // Trigger reactivity
      }

      // Save chat immediately after user message to prevent loss on refresh
      // Use the captured requestChatId to ensure it's saved to the correct chat
      try {
        const saveResult = await this.saveChatById(requestChatId, requestMessages, requestModel);
        // Update actualChatId if a new chat was created
        if (saveResult.chatId) {
          actualChatId = saveResult.chatId;
        }
      } catch (saveError) {
        console.warn("Failed to save chat after user message:", saveError);
        // Continue with AI request even if initial save fails
      }

      // Check model capabilities using the captured requestModel to avoid race conditions
      // This ensures we evaluate capabilities for the model that was selected when the request started
      const selectedModelConfig = this.models.find(m => m.name === requestModel);
      const isModelMultimodal = selectedModelConfig ? isMultimodal(selectedModelConfig) : false;
      const isVideoGenerationModel = selectedModelConfig?.supportsVideoGeneration;
      const hasImageInput = selectedModelConfig?.supportsImageInput;
      const hasImageAttachments = userMessage.imageId || (userMessage.imageIds && userMessage.imageIds.length > 0) || (userMessage.images && userMessage.images.length > 0) || userMessage.type === "image";

      // Image generation models with image input support (i2i models like flux-kontext, gemini-2.5-flash-image)
      const isImageGenerationWithImageInput =
        selectedModelConfig?.supportsImageGeneration &&
        selectedModelConfig?.supportsImageInput &&
        hasImageAttachments;

      // Multimodal text chat (vision models that analyze images and return text)
      const isMultimodalTextChat = isModelMultimodal && hasImageAttachments;

      // Use multimodal chat API only for text-based multimodal models
      const useMultimodalApi = isMultimodalTextChat;

      // Use image generation API for pure image gen OR i2i models
      const useImageGenerationApi =
        (selectedModelConfig?.supportsImageGeneration && !isModelMultimodal) ||
        isImageGenerationWithImageInput;

      if (useMultimodalApi && !isVideoGenerationModel) {
        console.log('🔀 Using MULTIMODAL CHAT API path');
        console.log('Reason: hasImageAttachments =', hasImageAttachments);

        // Log frontend message structure before sending
        console.log('📤 [FRONTEND] About to send to /api/chat:');
        console.log('  - Total messages:', requestMessages.length);
        console.log('  - userId:', this.userId);
        console.log('  - Messages with image data:');
        requestMessages.forEach((msg, idx) => {
          if (msg.imageId || msg.imageData || msg.imageIds || msg.images) {
            console.log(`    Message ${idx} (${msg.role}):`, {
              hasImageId: !!msg.imageId,
              hasImageData: !!msg.imageData,
              hasImageIds: !!msg.imageIds,
              imageIdsLength: msg.imageIds?.length || 0,
              hasImages: !!msg.images,
              imagesLength: msg.images?.length || 0,
              imagesDetail: msg.images?.map(img => ({
                hasImageId: !!(img as any).imageId,
                hasImageData: !!(img as any).imageData,
                mimeType: (img as any).mimeType
              }))
            });
          }
        });
        console.log('  - Full request structure:', JSON.stringify({
          model: requestModel,
          messagesCount: requestMessages.length,
          userId: this.userId,
          chatId: actualChatId
        }, null, 2));

        console.log('🔀 Using MULTIMODAL STREAMING path');

        // Create a placeholder assistant message for better UX
        const assistantMessage: AIMessage = {
          role: "assistant" as const,
          content: "",
          model: requestModel,
          type: "text"
        };

        // Add placeholder message to UI immediately
        if (this.currentChatId === actualChatId) {
          this.messages = [...this.messages, assistantMessage];
        }

        // Use streaming chat API for multimodal (same as text-only)
        const response = await fetch("/api/chat-stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: requestModel,
            messages: requestMessages,
            maxTokens: 4096,
            temperature: 0.7,
            userId: this.userId,
            chatId: actualChatId,
            selectedTool: toolToUse,
            projectId: this.currentProjectId || undefined,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to get multimodal streaming response");
        }

        // Process streaming response (same as text-only streaming)
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedContent = "";

        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    console.log('✓ Multimodal streaming completed');
                    continue;
                  }

                  try {
                    const parsed = JSON.parse(data);

                    if (parsed.error) {
                      throw new Error(parsed.error);
                    }

                    if (parsed.content) {
                      // Set streaming content flag on first content arrival
                      if (!this.isStreamingContent) {
                        this.isStreamingContent = true;
                      }

                      // Accumulate the content
                      accumulatedContent += parsed.content;

                      // Update the last message in the UI with accumulated content
                      if (this.currentChatId === actualChatId) {
                        const messagesCopy = [...this.messages];
                        const lastMessage = messagesCopy[messagesCopy.length - 1];

                        if (lastMessage && lastMessage.role === 'assistant' && lastMessage.type === 'text') {
                          lastMessage.content = accumulatedContent;
                          this.messages = messagesCopy;
                        }
                      }
                    }

                    // Handle stream completion with final data
                    if (parsed.done) {
                      console.log('✓ Multimodal stream done, final content length:', accumulatedContent.length);
                      break;
                    }
                  } catch (parseError) {
                    console.error('Failed to parse streaming chunk:', parseError);
                  }
                }
              }
            }
          } finally {
            reader.releaseLock();
          }
        }

        // Update assistantMessage with final content for saving
        assistantMessage.content = accumulatedContent || "No response received";

        // Add to request messages for saving
        requestMessages = [...requestMessages, assistantMessage];
      } else if (useImageGenerationApi) {
        console.log('🖼️ Using IMAGE GENERATION API path');

        // Create a placeholder assistant message for better UX
        const assistantMessage: AIMessage = {
          role: "assistant" as const,
          content: "",
          model: requestModel,
          type: "image"
        };

        // Add placeholder message to UI immediately
        if (this.currentChatId === actualChatId) {
          this.messages = [...this.messages, assistantMessage];
        }

        // Extract imageUrl from the first image attachment for i2i models
        // Use the uploaded image URL (presigned R2 URL or static path) instead of /api/images/[id]
        const imageUrl = imageAttachments.length > 0 && imageAttachments[0].uploadedImageUrl
          ? imageAttachments[0].uploadedImageUrl
          : undefined;

        // Use image generation API for pure image models (Imagen) or i2i models (flux-kontext, gemini-2.5-flash-image)
        const response = await fetch("/api/image-generation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: requestModel,
            prompt: cleanedPrompt,
            chatId: actualChatId,
            imageUrl: imageUrl, // Pass imageUrl for i2i models
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to generate image");
        }

        const imageResponse = await response.json();

        // Update the placeholder assistant message with actual content
        // Use copy-mutate-reassign pattern to trigger Svelte 5 reactivity
        if (this.currentChatId === actualChatId) {
          const messagesCopy = [...this.messages];
          const lastMessage = messagesCopy[messagesCopy.length - 1];

          if (lastMessage && lastMessage.role === 'assistant' && lastMessage.type === 'image') {
            lastMessage.content = `Generated image for: "${cleanedPrompt}"`;
            lastMessage.imageId = imageResponse.imageId;
            lastMessage.imageUrl = imageResponse.imageUrl; // Keep for backwards compatibility
            lastMessage.imageData = imageResponse.imageData; // Keep for backwards compatibility
            lastMessage.mimeType = imageResponse.mimeType;
            this.messages = messagesCopy;
          }
        }

        // Add to request messages for saving with updated content
        assistantMessage.content = `Generated image for: "${cleanedPrompt}"`;
        assistantMessage.imageId = imageResponse.imageId;
        assistantMessage.imageUrl = imageResponse.imageUrl;
        assistantMessage.imageData = imageResponse.imageData;
        assistantMessage.mimeType = imageResponse.mimeType;
        requestMessages = [...requestMessages, assistantMessage];
      } else if (isVideoGenerationModel) {
        // Create a placeholder assistant message for better UX
        const assistantMessage: AIMessage = {
          role: "assistant" as const,
          content: "",
          model: requestModel,
          type: "video"
        };

        // Add placeholder message to UI immediately
        if (this.currentChatId === actualChatId) {
          this.messages = [...this.messages, assistantMessage];
        }

        // Use chat API for video generation (handles video generation internally)
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: requestModel,
            messages: requestMessages,
            maxTokens: 4096,
            temperature: 0.7,
            userId: this.userId,
            chatId: actualChatId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to generate video");
        }

        const videoResponse = await response.json();

        // Update the placeholder assistant message with actual content
        // Use copy-mutate-reassign pattern to trigger Svelte 5 reactivity
        if (this.currentChatId === actualChatId) {
          const messagesCopy = [...this.messages];
          const lastMessage = messagesCopy[messagesCopy.length - 1];

          if (lastMessage && lastMessage.role === 'assistant' && lastMessage.type === 'video') {
            lastMessage.content = `Generated video for: "${cleanedPrompt}"`;
            lastMessage.videoId = videoResponse.videoId;
            lastMessage.mimeType = videoResponse.mimeType;
            this.messages = messagesCopy;
          }
        }

        // Add to request messages for saving with updated content
        assistantMessage.content = `Generated video for: "${cleanedPrompt}"`;
        assistantMessage.videoId = videoResponse.videoId;
        assistantMessage.mimeType = videoResponse.mimeType;
        requestMessages = [...requestMessages, assistantMessage];
      } else {
        // Enhanced error recovery with retry logic
        const MAX_RETRIES = 3;
        const STREAM_TIMEOUT_MS = 30000; // 30 seconds
        let retryCount = 0;
        let accumulatedContent = "";
        let streamSuccessful = false;

        // Create a placeholder assistant message that we'll update as we stream
        const assistantMessage: AIMessage = {
          role: "assistant" as const,
          content: "",
          model: requestModel,
          type: "text"
        };

        // Add the placeholder message to the UI immediately
        if (this.currentChatId === actualChatId) {
          this.messages = [...this.messages, assistantMessage];
        }

        while (retryCount < MAX_RETRIES && !streamSuccessful) {
          try {
            // Create AbortController for timeout detection
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), STREAM_TIMEOUT_MS);

            // Use streaming text chat API
            const response = await fetch("/api/chat-stream", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: requestModel,
                messages: requestMessages,
                maxTokens: 4096,
                temperature: 0.7,
                userId: this.userId,
                chatId: actualChatId,
                selectedTool: toolToUse, // Pass selected tool for function calling
                projectId: this.currentProjectId || undefined,
              }),
              signal: abortController.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || "Failed to get response");
            }

            // Handle streaming response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    streamSuccessful = true;
                    break;
                  }

                  // Decode the chunk
                  const chunk = decoder.decode(value, { stream: true });
                  const lines = chunk.split('\n');

                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      const data = line.slice(6); // Remove 'data: ' prefix

                      if (data === '[DONE]') {
                        // Stream completed successfully
                        streamSuccessful = true;
                        break;
                      }

                      try {
                        const parsed = JSON.parse(data);

                        if (parsed.error) {
                          throw new Error(parsed.error);
                        }

                        // Handle tool call events - update activeToolInvocations for UI
                        if (parsed.type === 'tool-call' && parsed.toolCall) {
                          const { toolCallId, toolName, args } = parsed.toolCall;
                          console.log(`Tool invoked: ${toolName}`);

                          // Add to active tool invocations with 'input-available' (running) state
                          this.activeToolInvocations.set(toolCallId, {
                            toolCallId,
                            toolName,
                            args: args || {},
                            state: 'input-available'
                          });
                          // Trigger reactivity by reassigning the Map
                          this.activeToolInvocations = new Map(this.activeToolInvocations);
                        }

                        // Handle tool result events - update tool state and append result to content
                        if (parsed.type === 'tool-result' && parsed.toolResult) {
                          const { toolCallId, result } = parsed.toolResult;

                          // Update the tool invocation with result
                          const existing = this.activeToolInvocations.get(toolCallId);
                          if (existing) {
                            existing.state = 'output-available';
                            existing.result = result;
                            this.activeToolInvocations = new Map(this.activeToolInvocations);
                          }

                          // Also append string results to accumulated content for backwards compatibility
                          if (result && typeof result === 'string') {
                            // Set streaming content flag
                            if (!this.isStreamingContent) {
                              this.isStreamingContent = true;
                            }

                            // Append tool result to accumulated content
                            accumulatedContent += result;

                            // Update UI with tool result
                            if (this.currentChatId === actualChatId) {
                              const messagesCopy = [...this.messages];
                              const lastMessage = messagesCopy[messagesCopy.length - 1];

                              if (lastMessage && lastMessage.role === 'assistant' && lastMessage.type === 'text') {
                                lastMessage.content = accumulatedContent;
                                this.messages = messagesCopy;
                              }
                            }
                          }
                        }

                        // Handle regular text content
                        if (parsed.content) {
                          // Set streaming content flag on first content arrival
                          if (!this.isStreamingContent) {
                            this.isStreamingContent = true;
                          }

                          // Accumulate the content
                          accumulatedContent += parsed.content;

                          // Update the last message in the UI with the accumulated content
                          if (this.currentChatId === actualChatId) {
                            const messagesCopy = [...this.messages];
                            const lastMessage = messagesCopy[messagesCopy.length - 1];

                            // Check if placeholder message exists and is correct type
                            if (lastMessage && lastMessage.role === 'assistant' && lastMessage.type === 'text') {
                              lastMessage.content = accumulatedContent;
                              this.messages = messagesCopy;
                            } else {
                              // Defensive recovery: If placeholder was lost (navigation race condition), re-add it
                              console.warn('Streaming placeholder message was lost, recreating...');
                              this.messages = [...this.messages, {
                                role: "assistant" as const,
                                content: accumulatedContent,
                                model: requestModel,
                                type: "text"
                              }];
                            }
                          }
                        }
                      } catch (parseError) {
                        // Ignore parse errors for incomplete chunks (SyntaxError is expected)
                        if (!(parseError instanceof SyntaxError)) {
                          console.error('Error parsing stream chunk:', parseError);
                        }
                      }
                    }
                  }
                }
              } catch (streamError) {
                console.error(`Stream error (attempt ${retryCount + 1}/${MAX_RETRIES}):`, streamError);

                // Don't retry if we already have partial content (preserve it)
                if (accumulatedContent) {
                  console.log('Preserving partial content from interrupted stream');
                  streamSuccessful = true;
                  break;
                }

                // Increment retry count for next attempt
                retryCount++;

                // Exponential backoff: wait before retrying
                if (retryCount < MAX_RETRIES) {
                  const backoffMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
                  console.log(`Retrying in ${backoffMs}ms...`);
                  await new Promise(resolve => setTimeout(resolve, backoffMs));
                }
              } finally {
                reader.releaseLock();
              }
            }
          } catch (fetchError) {
            console.error(`Fetch error (attempt ${retryCount + 1}/${MAX_RETRIES}):`, fetchError);

            // Classify and handle different error types
            if (fetchError instanceof Error) {
              if (fetchError.name === 'AbortError') {
                this.error = "Request timed out. Please try again.";
              } else if (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('network')) {
                this.error = "Network error. Please check your connection and try again.";
              } else {
                this.error = fetchError.message;
              }
              if (this.error) toast.error(this.error);
            }

            // Don't retry if we have partial content
            if (accumulatedContent) {
              console.log('Preserving partial content despite error');
              streamSuccessful = true;
              break;
            }

            retryCount++;

            // Exponential backoff
            if (retryCount < MAX_RETRIES) {
              const backoffMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
          }
        }

        // Update the assistant message with final content (accumulated or partial)
        assistantMessage.content = accumulatedContent || "No response received";

        // If we exhausted all retries and got no content, throw error
        if (!streamSuccessful && !accumulatedContent) {
          throw new Error(this.error || "Failed to get response after multiple attempts");
        }

        // Clear any transient errors if we got content
        if (accumulatedContent) {
          this.error = null;
        }

        // If no content was received during streaming, ensure streaming flag is reset
        if (!accumulatedContent) {
          this.isStreamingContent = false;
        }

        // Add to request messages for saving
        requestMessages = [...requestMessages, assistantMessage];
      }

      // Save chat after successful AI response to the correct chat ID
      // Use actualChatId to ensure response is saved to the original chat
      try {
        await this.saveChatById(actualChatId, requestMessages, requestModel);
      } catch (saveError) {
        console.error("Failed to save chat after AI response:", saveError);
        // Don't throw - we successfully got the AI response, just failed to save
      }
    } catch (err) {
      console.error("Chat error:", err);
      this.error = err instanceof Error ? err.message : "An error occurred";
      // Remove the user message on error (only if still viewing this chat and AI request failed)
      if (this.currentChatId === actualChatId) {
        // Count how many messages were added (user + potential placeholder)
        // For media generation, we add both user message and placeholder assistant message
        // Check if last message is an empty placeholder assistant message
        const messagesToRemove = this.messages.length > 0 &&
          this.messages[this.messages.length - 1].role === 'assistant' &&
          this.messages[this.messages.length - 1].content === '' ? 2 : 1;
        this.messages = this.messages.slice(0, -messagesToRemove);
        // Restore the prompt
        this.prompt = cleanedPrompt;
      }
    } finally {
      this.isLoading = false;
      this.isStreamingContent = false; // Reset streaming state

      // Mark web search tool as completed (synthetic tool for OpenRouter web search)
      if (webSearchToolCallId && this.activeToolInvocations.has(webSearchToolCallId)) {
        const webSearchTool = this.activeToolInvocations.get(webSearchToolCallId);
        if (webSearchTool) {
          webSearchTool.state = 'output-available';  // Shows "Completed" badge
          webSearchTool.result = { status: 'Web search completed' };
          this.activeToolInvocations = new Map(this.activeToolInvocations);  // Trigger reactivity
        }
      }

      // Copy tool invocations to the last assistant message before clearing
      // This ensures tool UI persists after streaming ends with "Completed" state
      if (this.activeToolInvocations.size > 0) {
        const messagesCopy = [...this.messages];
        const lastMessage = messagesCopy[messagesCopy.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          // Store tool invocations on the message for persistence
          lastMessage.toolInvocations = [...this.activeToolInvocations.values()];
          this.messages = messagesCopy;
        }
      }

      // Now safe to clear active tool invocations
      this.activeToolInvocations.clear();
      this.activeToolInvocations = new Map(); // Trigger reactivity
    }
  }

  // Helper function to get model display name
  getModelDisplayName(modelName: string): string {
    if (!this.models) return modelName || "Select model";
    // Strip :online suffix if present (web search enabled models)
    const baseModelName = removeWebSearchSuffix(modelName);
    const model = this.models.find((m) => m.name === baseModelName);
    return model?.displayName || "Select model";
  }

  // Retry an assistant message (regenerate the response)
  async retryMessage(assistantMessageIndex: number) {
    // Validation: ensure valid index
    if (assistantMessageIndex < 0 || assistantMessageIndex >= this.messages.length) {
      console.error('Invalid message index for retry');
      return;
    }

    const messageToRetry = this.messages[assistantMessageIndex];

    // Validation: ensure this is an assistant message
    if (messageToRetry.role !== 'assistant') {
      console.error('Can only retry assistant messages');
      return;
    }

    // Prevent retry during active loading
    if (this.isLoading) {
      toast.error('Please wait for the current response to complete');
      return;
    }

    // Check guest message limits (retry counts as a new API call)
    if (!this.canGuestSendMessage()) {
      this.error = `You've reached the ${GUEST_MESSAGE_LIMIT} message limit for guest users. Please sign up for an account to continue chatting.`;
      toast.error(this.error);
      return;
    }

    // Store original message for error recovery
    const originalMessage = { ...messageToRetry };

    // Set retry state
    this.retryingMessageIndex = assistantMessageIndex;

    // Capture current state for the request
    const requestChatId = this.currentChatId;

    // Use the model from the original message or current selection
    const baseModel = removeWebSearchSuffix(messageToRetry.model || this.selectedModel);
    const requestModel = this.webSearchEnabled && supportsWebSearch(baseModel)
      ? appendWebSearchSuffix(baseModel)
      : baseModel;

    let actualChatId = requestChatId;

    // Check if using web search (for synthetic tool UI)
    const isUsingWebSearch = requestModel.endsWith(':online');
    const webSearchToolCallId = isUsingWebSearch ? `web_search_${Date.now()}` : null;

    // Truncate messages to remove the assistant message being retried
    // This keeps all messages up to but not including the assistant message
    const messagesBeforeRetry = this.messages.slice(0, assistantMessageIndex);
    this.messages = messagesBeforeRetry;

    // Build request messages for the API (same as truncated messages)
    let requestMessages = [...messagesBeforeRetry];

    // Increment guest message count for non-logged users
    this.incrementGuestMessageCount();

    try {
      this.isLoading = true;
      this.isStreamingContent = false;
      this.error = null;

      // Add synthetic web search tool invocation for UI
      if (isUsingWebSearch && webSearchToolCallId) {
        // Find the last user message to get the query
        const lastUserMessage = messagesBeforeRetry.filter(m => m.role === 'user').pop();
        this.activeToolInvocations.set(webSearchToolCallId, {
          toolCallId: webSearchToolCallId,
          toolName: 'web_search',
          args: { query: lastUserMessage?.content || '' },
          state: 'input-available'
        });
        this.activeToolInvocations = new Map(this.activeToolInvocations);
      }

      // Create placeholder assistant message
      const assistantMessage: AIMessage = {
        role: "assistant" as const,
        content: "",
        model: requestModel,
        type: originalMessage.type || "text"
      };

      // Add placeholder to UI
      if (this.currentChatId === actualChatId) {
        this.messages = [...this.messages, assistantMessage];
      }

      // Use streaming API
      const response = await fetch("/api/chat-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: requestModel,
          messages: requestMessages,
          maxTokens: 4096,
          temperature: 0.7,
          userId: this.userId,
          chatId: actualChatId,
          selectedTool: this.selectedTool,
          projectId: this.currentProjectId || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";

      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);

                if (data === '[DONE]') {
                  break;
                }

                try {
                  const parsed = JSON.parse(data);

                  if (parsed.error) {
                    throw new Error(parsed.error);
                  }

                  // Handle tool call events
                  if (parsed.type === 'tool-call' && parsed.toolCall) {
                    const { toolCallId, toolName, args } = parsed.toolCall;
                    this.activeToolInvocations.set(toolCallId, {
                      toolCallId,
                      toolName,
                      args: args || {},
                      state: 'input-available'
                    });
                    this.activeToolInvocations = new Map(this.activeToolInvocations);
                  }

                  // Handle tool result events
                  if (parsed.type === 'tool-result' && parsed.toolResult) {
                    const { toolCallId, result } = parsed.toolResult;
                    const existing = this.activeToolInvocations.get(toolCallId);
                    if (existing) {
                      existing.state = 'output-available';
                      existing.result = result;
                      this.activeToolInvocations = new Map(this.activeToolInvocations);
                    }

                    if (result && typeof result === 'string') {
                      if (!this.isStreamingContent) {
                        this.isStreamingContent = true;
                      }
                      accumulatedContent += result;

                      if (this.currentChatId === actualChatId) {
                        const messagesCopy = [...this.messages];
                        const lastMessage = messagesCopy[messagesCopy.length - 1];
                        if (lastMessage && lastMessage.role === 'assistant') {
                          lastMessage.content = accumulatedContent;
                          this.messages = messagesCopy;
                        }
                      }
                    }
                  }

                  // Handle regular text content
                  if (parsed.content) {
                    if (!this.isStreamingContent) {
                      this.isStreamingContent = true;
                    }

                    accumulatedContent += parsed.content;

                    if (this.currentChatId === actualChatId) {
                      const messagesCopy = [...this.messages];
                      const lastMessage = messagesCopy[messagesCopy.length - 1];
                      if (lastMessage && lastMessage.role === 'assistant') {
                        lastMessage.content = accumulatedContent;
                        this.messages = messagesCopy;
                      }
                    }
                  }
                } catch (parseError) {
                  if (!(parseError instanceof SyntaxError)) {
                    console.error('Error parsing stream chunk:', parseError);
                  }
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      }

      // Update assistant message with final content
      assistantMessage.content = accumulatedContent || "No response received";

      // Add to request messages for saving
      requestMessages = [...requestMessages, assistantMessage];

      // Save chat after successful retry
      try {
        await this.saveChatById(actualChatId, requestMessages, requestModel);
      } catch (saveError) {
        console.error("Failed to save chat after retry:", saveError);
      }

    } catch (err) {
      console.error("Retry error:", err);
      this.error = err instanceof Error ? err.message : "Retry failed";

      // Restore the original assistant message on error
      if (this.currentChatId === requestChatId) {
        // Remove the placeholder and restore original
        this.messages = [...messagesBeforeRetry, originalMessage];
      }
    } finally {
      this.isLoading = false;
      this.isStreamingContent = false;
      this.retryingMessageIndex = null;

      // Mark web search tool as completed
      if (webSearchToolCallId && this.activeToolInvocations.has(webSearchToolCallId)) {
        const webSearchTool = this.activeToolInvocations.get(webSearchToolCallId);
        if (webSearchTool) {
          webSearchTool.state = 'output-available';
          webSearchTool.result = { status: 'Web search completed' };
          this.activeToolInvocations = new Map(this.activeToolInvocations);
        }
      }

      // Copy tool invocations to the last assistant message
      if (this.activeToolInvocations.size > 0) {
        const messagesCopy = [...this.messages];
        const lastMessage = messagesCopy[messagesCopy.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          lastMessage.toolInvocations = [...this.activeToolInvocations.values()];
          this.messages = messagesCopy;
        }
      }

      // Clear active tool invocations
      this.activeToolInvocations.clear();
      this.activeToolInvocations = new Map();
    }
  }

  /**
   * Create a new chat branching from a specific message.
   * Copies messages[0..messageIndex] (inclusive) to a new chat.
   *
   * @param messageIndex - The index of the last message to include in the branch
   */
  async branchFromMessage(messageIndex: number) {
    // Validation: ensure valid index
    if (messageIndex < 0 || messageIndex >= this.messages.length) {
      console.error('Invalid message index for branch');
      return;
    }

    // Prevent branching during active loading/streaming
    if (this.isLoading || this.isStreamingContent) {
      toast.error('Please wait for the current response to complete');
      return;
    }

    // Require authenticated user (guests can't save chats)
    if (!this.userId) {
      toast.error('Sign in to create a branch');
      return;
    }

    // Require existing chat (can't branch from unsaved)
    if (!this.currentChatId) {
      toast.error('Save the chat first before branching');
      return;
    }

    try {
      // Call API to create branch
      const response = await fetch('/api/chats/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChatId: this.currentChatId,
          branchAtIndex: messageIndex
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create branch');
      }

      const { chat: newChat } = await response.json();

      // Show success feedback
      toast.success('Branched conversation created');

      // Navigate to new chat (don't replace state so user can go back)
      await goto(`/chat/${newChat.id}`, { replaceState: false, noScroll: true });

      // Refresh chat history in sidebar
      this.loadChatHistory();
    } catch (err) {
      console.error('Branch error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create branch');
    }
  }

  /**
   * Start editing a user message.
   * @param messageIndex - The index of the user message to edit
   */
  startEditMessage(messageIndex: number): void {
    if (messageIndex < 0 || messageIndex >= this.messages.length) return;
    if (this.messages[messageIndex].role !== 'user') return;
    if (this.isLoading || this.isStreamingContent) return;

    this.editingMessageIndex = messageIndex;
    this.editingMessageContent = this.messages[messageIndex].content || "";
  }

  /**
   * Cancel edit mode without changes.
   */
  cancelEditMessage(): void {
    this.editingMessageIndex = null;
    this.editingMessageContent = "";
  }

  /**
   * Update editing content as user types.
   */
  updateEditingContent(content: string): void {
    this.editingMessageContent = content;
  }

  /**
   * Save edited message and regenerate AI response.
   * Similar to retryMessage() but modifies user content first.
   */
  async saveAndRegenerateMessage(): Promise<void> {
    const messageIndex = this.editingMessageIndex;

    // Validation
    if (messageIndex === null || messageIndex < 0) return;
    if (!this.editingMessageContent.trim()) {
      toast.error('Message cannot be empty');
      return;
    }
    if (this.isLoading) {
      toast.error('Please wait for the current response to complete');
      return;
    }

    // Check guest message limits
    if (!this.canGuestSendMessage()) {
      this.error = `You've reached the ${GUEST_MESSAGE_LIMIT} message limit for guest users. Please sign up for an account to continue chatting.`;
      toast.error(this.error);
      return;
    }

    const originalMessage = this.messages[messageIndex];
    const cleanedContent = this.cleanMessageContent(this.editingMessageContent);

    // Capture request context
    const requestChatId = this.currentChatId;
    const baseModel = removeWebSearchSuffix(this.selectedModel);
    const requestModel = this.webSearchEnabled && supportsWebSearch(baseModel)
      ? appendWebSearchSuffix(baseModel)
      : baseModel;
    let actualChatId = requestChatId;

    // Check if using web search (for synthetic tool UI)
    const isUsingWebSearch = requestModel.endsWith(':online');
    const webSearchToolCallId = isUsingWebSearch ? `web_search_${Date.now()}` : null;

    // Exit edit mode, enter loading state
    this.editingMessageIndex = null;
    this.editingMessageContent = "";
    this.isLoading = true;
    this.isStreamingContent = false;
    this.error = null;

    try {
      // Create updated user message (preserve attachments)
      const updatedUserMessage: AIMessage = {
        ...originalMessage,
        content: cleanedContent,
      };

      // Truncate messages: keep all before edited message + updated message
      const messagesUpToEdit = this.messages.slice(0, messageIndex);
      let requestMessages = [...messagesUpToEdit, updatedUserMessage];

      // Update UI immediately
      this.messages = requestMessages;

      // Increment guest count
      this.incrementGuestMessageCount();

      // Add synthetic web search tool invocation for UI
      if (isUsingWebSearch && webSearchToolCallId) {
        this.activeToolInvocations.set(webSearchToolCallId, {
          toolCallId: webSearchToolCallId,
          toolName: 'web_search',
          args: { query: cleanedContent },
          state: 'input-available'
        });
        this.activeToolInvocations = new Map(this.activeToolInvocations);
      }

      // Add placeholder assistant message
      const assistantMessage: AIMessage = {
        role: "assistant",
        content: "",
        model: requestModel,
        type: "text"
      };

      if (this.currentChatId === actualChatId) {
        this.messages = [...this.messages, assistantMessage];
      }

      // Stream response
      const response = await fetch("/api/chat-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: requestModel,
          messages: requestMessages,
          maxTokens: 4096,
          temperature: 0.7,
          userId: this.userId,
          chatId: actualChatId,
          selectedTool: this.selectedTool,
          projectId: this.currentProjectId || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to regenerate response");
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";

      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);

                if (data === '[DONE]') {
                  break;
                }

                try {
                  const parsed = JSON.parse(data);

                  if (parsed.error) {
                    throw new Error(parsed.error);
                  }

                  // Handle tool call events
                  if (parsed.type === 'tool-call' && parsed.toolCall) {
                    const { toolCallId, toolName, args } = parsed.toolCall;
                    this.activeToolInvocations.set(toolCallId, {
                      toolCallId,
                      toolName,
                      args: args || {},
                      state: 'input-available'
                    });
                    this.activeToolInvocations = new Map(this.activeToolInvocations);
                  }

                  // Handle tool result events
                  if (parsed.type === 'tool-result' && parsed.toolResult) {
                    const { toolCallId, result } = parsed.toolResult;
                    const existing = this.activeToolInvocations.get(toolCallId);
                    if (existing) {
                      existing.state = 'output-available';
                      existing.result = result;
                      this.activeToolInvocations = new Map(this.activeToolInvocations);
                    }

                    if (result && typeof result === 'string') {
                      if (!this.isStreamingContent) {
                        this.isStreamingContent = true;
                      }
                      accumulatedContent += result;

                      if (this.currentChatId === actualChatId) {
                        const messagesCopy = [...this.messages];
                        const lastMessage = messagesCopy[messagesCopy.length - 1];
                        if (lastMessage && lastMessage.role === 'assistant') {
                          lastMessage.content = accumulatedContent;
                          this.messages = messagesCopy;
                        }
                      }
                    }
                  }

                  // Handle regular text content
                  if (parsed.content) {
                    if (!this.isStreamingContent) {
                      this.isStreamingContent = true;
                    }

                    accumulatedContent += parsed.content;

                    if (this.currentChatId === actualChatId) {
                      const messagesCopy = [...this.messages];
                      const lastMessage = messagesCopy[messagesCopy.length - 1];
                      if (lastMessage && lastMessage.role === 'assistant') {
                        lastMessage.content = accumulatedContent;
                        this.messages = messagesCopy;
                      }
                    }
                  }
                } catch (parseError) {
                  if (!(parseError instanceof SyntaxError)) {
                    console.error('Error parsing stream chunk:', parseError);
                  }
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      }

      // Update assistant message with final content
      assistantMessage.content = accumulatedContent || "No response received";

      // Add to request messages for saving
      requestMessages = [...requestMessages, assistantMessage];

      // Save chat after successful edit regeneration
      try {
        await this.saveChatById(actualChatId, requestMessages, requestModel);
      } catch (saveError) {
        console.error("Failed to save chat after edit:", saveError);
      }

    } catch (err) {
      console.error("Edit regeneration error:", err);
      this.error = err instanceof Error ? err.message : "Failed to regenerate response";
      toast.error(this.error);
    } finally {
      this.isLoading = false;
      this.isStreamingContent = false;

      // Mark web search tool as completed
      if (webSearchToolCallId && this.activeToolInvocations.has(webSearchToolCallId)) {
        const webSearchTool = this.activeToolInvocations.get(webSearchToolCallId);
        if (webSearchTool) {
          webSearchTool.state = 'output-available';
          webSearchTool.result = { status: 'Web search completed' };
          this.activeToolInvocations = new Map(this.activeToolInvocations);
        }
      }

      // Copy tool invocations to the last assistant message
      if (this.activeToolInvocations.size > 0) {
        const messagesCopy = [...this.messages];
        const lastMessage = messagesCopy[messagesCopy.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          lastMessage.toolInvocations = [...this.activeToolInvocations.values()];
          this.messages = messagesCopy;
        }
      }

      // Clear active tool invocations
      this.activeToolInvocations.clear();
      this.activeToolInvocations = new Map();
    }
  }

  // Setup model change detection effect
  setupModelChangeDetection() {
    $effect(() => {
      if (
        this.previousModel !== null &&
        this.selectedModel !== this.previousModel &&
        this.messages.length > 0 &&
        !this.isLoadingChatData
      ) {
        // Store the pending model change and revert the selection temporarily
        this.pendingModelChange = this.selectedModel;
        this.selectedModel = this.previousModel;
        this.showModelChangeDialog = true;
      } else {
        this.previousModel = this.selectedModel;
      }
    });
  }
}
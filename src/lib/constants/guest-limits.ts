/**
 * Guest user limitation constants
 * Centralized configuration for non-logged in user restrictions
 */

// Guests can no longer send any messages without an account. The chat UI
// intercepts the very first send and surfaces a branded sign-up / log-in
// popup, and the server enforces the same rule (any user message from a
// guest causes a 403 with type "guest_limit_exceeded").
export const GUEST_MESSAGE_LIMIT = 0;
export const GUEST_ALLOWED_MODELS = [
    // XBrainPro's own free model — listed first so it becomes the default for guests
    "ezbo/ezbo-1.0",
    "google/gemma-3-27b-it:free",
    "openai/gpt-oss-20b:free",
    "moonshotai/kimi-k2:free"
];

// Helper function to check if a model is allowed for guests
export function isModelAllowedForGuests(modelName: string): boolean {
    return GUEST_ALLOWED_MODELS.includes(modelName);
}
import type { AIProvider, AIModelConfig } from './types.js';
import { ezboaiProvider } from './providers/ezboai.js';
import { openRouterProvider } from './providers/openrouter.js';
import { replicateProvider } from './providers/replicate.js';
import { elevenlabsProvider } from './providers/elevenlabs.js';
import { removeWebSearchSuffix } from '$lib/constants/web-search.js';

// IMPORTANT: ezboaiProvider must be listed BEFORE openRouterProvider so that
// getModelProvider() matches "ezbo/*" model names against the XBrainPro router
// instead of falling through to OpenRouter.
export const AI_PROVIDERS: AIProvider[] = [
        ezboaiProvider,
        openRouterProvider,
        replicateProvider,
        elevenlabsProvider
];

export function getAllModels(): AIModelConfig[] {
        return AI_PROVIDERS.flatMap(provider => provider.models);
}

export function getProvider(providerName: string): AIProvider | undefined {
        return AI_PROVIDERS.find(provider => provider.name === providerName);
}

export function getModelProvider(modelName: string): AIProvider | undefined {
        // Handle OpenRouter web search suffix (:online) by checking base model name
        const baseModelName = removeWebSearchSuffix(modelName);
        return AI_PROVIDERS.find(provider =>
                provider.models.some(model => model.name === baseModelName)
        );
}

export * from './types.js';
export { ezboaiProvider } from './providers/ezboai.js';
export { openRouterProvider } from './providers/openrouter.js';
export { replicateProvider } from './providers/replicate.js';
export { elevenlabsProvider } from './providers/elevenlabs.js';
// Re-export client-safe constants from the constants file (single source of truth)
export { ELEVENLABS_VOICES } from '$lib/constants/elevenlabs.js';
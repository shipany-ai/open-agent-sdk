/**
 * LLM Provider Factory
 *
 * Creates the appropriate provider based on API type configuration.
 */

export type { ApiType, LLMProvider, CreateMessageParams, CreateMessageResponse, NormalizedMessageParam, NormalizedContentBlock, NormalizedTool, NormalizedResponseBlock, ResponseFormat } from './types.js'

export { AnthropicProvider } from './anthropic.js'
export { OpenAIProvider } from './openai.js'

import type { ApiType, LLMProvider } from './types.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'

/**
 * Create an LLM provider based on the API type.
 *
 * @param apiType - 'anthropic-messages' or 'openai-completions'
 * @param opts - API credentials
 */
export function createProvider(
  apiType: ApiType,
  opts: { apiKey?: string; baseURL?: string },
): LLMProvider {
  switch (apiType) {
    case 'anthropic-messages':
      return new AnthropicProvider(opts)
    case 'openai-completions':
      return new OpenAIProvider(opts)
    default:
      throw new Error(`Unsupported API type: ${apiType}. Use 'anthropic-messages' or 'openai-completions'.`)
  }
}

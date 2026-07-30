/**
 * Context Compression / Auto-Compaction
 *
 * Summarizes long conversation histories when context window fills up.
 * Three-tier system:
 * 1. Auto-compact: triggered when tokens exceed threshold
 * 2. Micro-compact: cache-aware per-request optimization
 * 3. Session memory compaction: consolidates across sessions
 */

import type { LLMProvider } from '../providers/types.js'
import type { NormalizedMessageParam } from '../providers/types.js'
import {
  estimateMessagesTokens,
  getAutoCompactThreshold,
} from './tokens.js'

/**
 * State for tracking auto-compaction across turns.
 */
export interface AutoCompactState {
  compacted: boolean
  turnCounter: number
  consecutiveFailures: number
}

/**
 * Create initial auto-compact state.
 */
export function createAutoCompactState(): AutoCompactState {
  return {
    compacted: false,
    turnCounter: 0,
    consecutiveFailures: 0,
  }
}

/**
 * Check if auto-compaction should trigger.
 */
export function shouldAutoCompact(
  messages: any[],
  model: string,
  state: AutoCompactState,
  contextWindowSize?: number,
): boolean {
  if (state.consecutiveFailures >= 3) return false

  const estimatedTokens = estimateMessagesTokens(messages)
  const threshold = getAutoCompactThreshold(model, contextWindowSize)

  return estimatedTokens >= threshold
}

/**
 * Compact conversation by summarizing with the LLM.
 *
 * Sends the entire conversation to the LLM for summarization,
 * then replaces the history with a compact summary.
 */
export async function compactConversation(
  provider: LLMProvider,
  model: string,
  messages: any[],
  state: AutoCompactState,
): Promise<{
  compactedMessages: NormalizedMessageParam[]
  summary: string
  state: AutoCompactState
}> {
  try {
    // Strip images before compacting to save tokens
    const strippedMessages = stripImagesFromMessages(messages)

    // Build compaction prompt
    const compactionPrompt = buildCompactionPrompt(strippedMessages)

    const response = await provider.createMessage({
      model,
      maxTokens: 8192,
      system: 'You are a conversation summarizer. Create a detailed summary of the conversation that preserves all important context, decisions made, files modified, tool outputs, and current state. The summary should allow the conversation to continue seamlessly.',
      messages: [
        {
          role: 'user',
          content: compactionPrompt,
        },
      ],
    })

    const summary = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')

    // Replace messages with summary
    const compactedMessages: NormalizedMessageParam[] = [
      {
        role: 'user',
        content: `[Previous conversation summary]\n\n${summary}\n\n[End of summary - conversation continues below]`,
      },
      {
        role: 'assistant',
        content: 'I understand the context from the previous conversation. I\'ll continue from where we left off.',
      },
    ]

    return {
      compactedMessages,
      summary,
      state: {
        compacted: true,
        turnCounter: state.turnCounter,
        consecutiveFailures: 0,
      },
    }
  } catch (err: any) {
    return {
      compactedMessages: messages,
      summary: '',
      state: {
        ...state,
        consecutiveFailures: state.consecutiveFailures + 1,
      },
    }
  }
}

/**
 * Strip images from messages for compaction safety.
 */
function stripImagesFromMessages(
  messages: any[],
): any[] {
  return messages.map((msg: any) => {
    if (typeof msg.content === 'string') return msg

    const filtered = (msg.content as any[]).filter((block: any) => {
      return block.type !== 'image'
    })

    return { ...msg, content: filtered.length > 0 ? filtered : '[content removed for compaction]' }
  })
}

/**
 * Build compaction prompt from messages.
 */
function buildCompactionPrompt(messages: any[]): string {
  const parts: string[] = ['Please summarize this conversation:\n']

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant'

    if (typeof msg.content === 'string') {
      parts.push(`${role}: ${msg.content.slice(0, 5000)}`)
    } else if (Array.isArray(msg.content)) {
      const texts: string[] = []
      for (const block of msg.content as any[]) {
        if (block.type === 'text') {
          texts.push(block.text.slice(0, 3000))
        } else if (block.type === 'tool_use') {
          texts.push(`[Tool: ${block.name}]`)
        } else if (block.type === 'tool_result') {
          const content = typeof block.content === 'string'
            ? block.content.slice(0, 1000)
            : '[tool result]'
          texts.push(`[Tool Result: ${content}]`)
        }
      }
      if (texts.length > 0) {
        parts.push(`${role}: ${texts.join('\n')}`)
      }
    }
  }

  return parts.join('\n\n')
}

/**
 * Micro-compact: optimize messages by truncating large tool results
 * to fit within token budgets.
 */
export function microCompactMessages(
  messages: any[],
  maxToolResultChars: number = 50000,
): any[] {
  return messages.map((msg: any) => {
    if (typeof msg.content === 'string') return msg
    if (!Array.isArray(msg.content)) return msg

    const content = (msg.content as any[]).map((block: any) => {
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        if (block.content.length > maxToolResultChars) {
          return {
            ...block,
            content:
              block.content.slice(0, maxToolResultChars / 2) +
              '\n...(truncated)...\n' +
              block.content.slice(-maxToolResultChars / 2),
          }
        }
      }
      return block
    })

    return { ...msg, content }
  })
}

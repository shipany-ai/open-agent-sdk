/**
 * Agent - High-level API
 *
 * Provides createAgent() and query() interfaces compatible with
 * open-agent-sdk.
 *
 * Usage:
 *   import { createAgent } from 'open-agent-sdk'
 *   const agent = createAgent({ model: 'claude-sonnet-4-6' })
 *   for await (const event of agent.query('Hello')) { ... }
 *
 *   // OpenAI-compatible models
 *   const agent = createAgent({
 *     apiType: 'openai-completions',
 *     model: 'gpt-4o',
 *     apiKey: 'sk-...',
 *     baseURL: 'https://api.openai.com/v1',
 *   })
 */

import type {
  AgentOptions,
  QueryResult,
  SDKMessage,
  ToolDefinition,
  CanUseToolFn,
  Message,
  PermissionMode,
} from './types.js'
import { QueryEngine } from './engine.js'
import { getAllBaseTools, filterTools } from './tools/index.js'
import { connectMCPServer, type MCPConnection } from './mcp/client.js'
import { isSdkServerConfig } from './sdk-mcp-server.js'
import { registerAgents } from './tools/agent-tool.js'
import {
  saveSession,
  loadSession,
} from './session.js'
import { createHookRegistry, type HookRegistry } from './hooks.js'
import { initBundledSkills } from './skills/index.js'
import { createProvider, type LLMProvider, type ApiType } from './providers/index.js'
import type { NormalizedMessageParam } from './providers/types.js'

// --------------------------------------------------------------------------
// Agent class
// --------------------------------------------------------------------------

export class Agent {
  private cfg: AgentOptions
  private toolPool: ToolDefinition[]
  private modelId: string
  private apiType: ApiType
  private apiCredentials: { key?: string; baseUrl?: string }
  private provider: LLMProvider
  private mcpLinks: MCPConnection[] = []
  private history: NormalizedMessageParam[] = []
  private messageLog: Message[] = []
  private setupDone: Promise<void>
  private sid: string
  private abortCtrl: AbortController | null = null
  private currentEngine: QueryEngine | null = null
  private hookRegistry: HookRegistry

  constructor(options: AgentOptions = {}) {
    // Shallow copy to avoid mutating caller's object
    this.cfg = { ...options }

    // Merge credentials from options.env map, direct options, and process.env
    this.apiCredentials = this.pickCredentials()
    this.modelId = this.cfg.model ?? this.readEnv('CODEANY_MODEL') ?? 'claude-sonnet-4-6'
    this.sid = this.cfg.sessionId ?? crypto.randomUUID()

    // Resolve API type
    this.apiType = this.resolveApiType()

    // Create LLM provider
    this.provider = createProvider(this.apiType, {
      apiKey: this.apiCredentials.key,
      baseURL: this.apiCredentials.baseUrl,
    })

    // Initialize bundled skills
    initBundledSkills()

    // Build hook registry from options
    this.hookRegistry = createHookRegistry()
    if (this.cfg.hooks) {
      // Convert AgentOptions hooks format to HookConfig
      for (const [event, defs] of Object.entries(this.cfg.hooks)) {
        for (const def of defs) {
          for (const handler of def.hooks) {
            this.hookRegistry.register(event as any, {
              matcher: def.matcher,
              timeout: def.timeout,
              handler: async (input) => {
                const result = await handler(input, input.toolUseId || '', {
                  signal: this.abortCtrl?.signal || new AbortController().signal,
                })
                return result || undefined
              },
            })
          }
        }
      }
    }

    // Build tool pool from options (supports ToolDefinition[], string[], or preset)
    this.toolPool = this.buildToolPool()

    // Kick off async setup (MCP connections, agent registration, session resume)
    this.setupDone = this.setup()
  }

  /**
   * Resolve API type from options, env, or model name heuristic.
   */
  private resolveApiType(): ApiType {
    // Explicit option
    if (this.cfg.apiType) return this.cfg.apiType

    // Env var
    const envType =
      this.cfg.env?.CODEANY_API_TYPE ??
      this.readEnv('CODEANY_API_TYPE')
    if (envType === 'openai-completions' || envType === 'anthropic-messages') {
      return envType
    }

    // Heuristic from model name
    const model = this.modelId.toLowerCase()
    if (
      model.includes('gpt-') ||
      model.includes('o1') ||
      model.includes('o3') ||
      model.includes('o4') ||
      model.includes('deepseek') ||
      model.includes('qwen') ||
      model.includes('yi-') ||
      model.includes('glm') ||
      model.includes('mistral') ||
      model.includes('gemma')
    ) {
      return 'openai-completions'
    }

    return 'anthropic-messages'
  }

  /** Pick API key and base URL from options or CODEANY_* env vars. */
  private pickCredentials(): { key?: string; baseUrl?: string } {
    const envMap = this.cfg.env
    return {
      key:
        this.cfg.apiKey ??
        envMap?.CODEANY_API_KEY ??
        envMap?.CODEANY_AUTH_TOKEN ??
        this.readEnv('CODEANY_API_KEY') ??
        this.readEnv('CODEANY_AUTH_TOKEN'),
      baseUrl:
        this.cfg.baseURL ??
        envMap?.CODEANY_BASE_URL ??
        this.readEnv('CODEANY_BASE_URL'),
    }
  }

  /** Read a value from process.env (returns undefined if missing). */
  private readEnv(key: string): string | undefined {
    return process.env[key] || undefined
  }

  /** Assemble the available tool set based on options. */
  private buildToolPool(): ToolDefinition[] {
    const raw = this.cfg.tools
    let pool: ToolDefinition[]

    if (!raw || (typeof raw === 'object' && !Array.isArray(raw) && 'type' in raw)) {
      pool = getAllBaseTools()
    } else if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
      pool = filterTools(getAllBaseTools(), raw as string[])
    } else {
      pool = raw as ToolDefinition[]
    }

    return filterTools(pool, this.cfg.allowedTools, this.cfg.disallowedTools)
  }

  /**
   * Async initialization: connect MCP servers, register agents, resume sessions.
   */
  private async setup(): Promise<void> {
    // Register custom agent definitions
    if (this.cfg.agents) {
      registerAgents(this.cfg.agents)
    }

    // Connect MCP servers (supports stdio, SSE, HTTP, and in-process SDK servers)
    if (this.cfg.mcpServers) {
      for (const [name, config] of Object.entries(this.cfg.mcpServers)) {
        try {
          if (isSdkServerConfig(config)) {
            // In-process SDK MCP server - directly add tools
            this.toolPool = [...this.toolPool, ...config.tools]
          } else {
            // External MCP server
            const connection = await connectMCPServer(name, config)
            this.mcpLinks.push(connection)

            if (connection.status === 'connected' && connection.tools.length > 0) {
              this.toolPool = [...this.toolPool, ...connection.tools]
            }
          }
        } catch (err: any) {
          console.error(`[MCP] Failed to connect to "${name}": ${err.message}`)
        }
      }
    }

    // Resume or continue session. An explicitly supplied history wins: hosts
    // that keep sessions in their own store (a database) pass it here and the
    // session files are never read.
    if (this.cfg.history?.length) {
      this.history = [...this.cfg.history]
      if (this.cfg.resume) this.sid = this.cfg.resume
    } else if (this.cfg.resume) {
      const sessionData = await loadSession(this.cfg.resume)
      if (sessionData) {
        this.history = sessionData.messages
        this.sid = this.cfg.resume
      }
    }
  }

  /**
   * Run a query with streaming events.
   */
  async *query(
    prompt: string,
    overrides?: Partial<AgentOptions>,
  ): AsyncGenerator<SDKMessage, void> {
    await this.setupDone

    const opts = { ...this.cfg, ...overrides }
    const cwd = opts.cwd || process.cwd()

    // Create abort controller for this query
    this.abortCtrl = opts.abortController || new AbortController()
    if (opts.abortSignal) {
      opts.abortSignal.addEventListener('abort', () => this.abortCtrl?.abort(), { once: true })
    }

    // Resolve systemPrompt (handle preset object)
    let systemPrompt: string | undefined
    let appendSystemPrompt = opts.appendSystemPrompt
    if (typeof opts.systemPrompt === 'object' && opts.systemPrompt?.type === 'preset') {
      systemPrompt = undefined // Use engine default (default style)
      if (opts.systemPrompt.append) {
        appendSystemPrompt = (appendSystemPrompt || '') + '\n' + opts.systemPrompt.append
      }
    } else {
      systemPrompt = opts.systemPrompt as string | undefined
    }

    // Build canUseTool based on permission mode
    const permMode = opts.permissionMode ?? 'bypassPermissions'
    const canUseTool: CanUseToolFn = opts.canUseTool ?? (async (_tool, _input) => {
      if (permMode === 'bypassPermissions' || permMode === 'dontAsk' || permMode === 'auto') {
        return { behavior: 'allow' }
      }
      if (permMode === 'acceptEdits') {
        return { behavior: 'allow' }
      }
      return { behavior: 'allow' }
    })

    // Resolve tools with overrides
    let tools = this.toolPool
    if (overrides?.allowedTools || overrides?.disallowedTools) {
      tools = filterTools(tools, overrides.allowedTools, overrides.disallowedTools)
    }
    if (overrides?.tools) {
      const ot = overrides.tools
      if (Array.isArray(ot) && ot.length > 0 && typeof ot[0] === 'string') {
        tools = filterTools(this.toolPool, ot as string[])
      } else if (Array.isArray(ot)) {
        tools = ot as ToolDefinition[]
      }
    }

    // Recreate provider if overrides change credentials or apiType
    let provider = this.provider
    if (overrides?.apiType || overrides?.apiKey || overrides?.baseURL) {
      const resolvedApiType = overrides.apiType ?? this.apiType
      provider = createProvider(resolvedApiType, {
        apiKey: overrides.apiKey ?? this.apiCredentials.key,
        baseURL: overrides.baseURL ?? this.apiCredentials.baseUrl,
      })
    }

    // Create query engine with current conversation state
    const engine = new QueryEngine({
      cwd,
      model: opts.model || this.modelId,
      provider,
      tools,
      systemPrompt,
      appendSystemPrompt,
      maxTurns: opts.maxTurns ?? 10,
      maxBudgetUsd: opts.maxBudgetUsd,
      maxTokens: opts.maxTokens ?? 16384,
      thinking: opts.thinking,
      jsonSchema: opts.jsonSchema,
      canUseTool,
      includePartialMessages: opts.includePartialMessages ?? false,
      abortSignal: this.abortCtrl.signal,
      agents: opts.agents,
      hookRegistry: this.hookRegistry,
      sessionId: this.sid,
      contextWindowSize: opts.contextWindowSize,
      pricingPerMillion: opts.pricingPerMillion,
    })
    this.currentEngine = engine

    // Inject existing conversation history
    for (const msg of this.history) {
      (engine as any).messages.push(msg)
    }

    // Run the engine
    for await (const event of engine.submitMessage(prompt)) {
      yield event

      // Track assistant messages for multi-turn persistence
      if (event.type === 'assistant') {
        const uuid = crypto.randomUUID()
        const timestamp = new Date().toISOString()
        this.messageLog.push({
          type: 'assistant',
          message: event.message,
          uuid,
          timestamp,
        })
      }
    }

    // Persist conversation state for multi-turn
    this.history = engine.getMessages()

    // Add user message to tracked messages
    const userUuid = crypto.randomUUID()
    this.messageLog.push({
      type: 'user',
      message: { role: 'user', content: prompt },
      uuid: userUuid,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Convenience method: send a prompt and collect the final answer as a single object.
   * Internally iterates through the streaming query and aggregates the outcome.
   */
  async prompt(
    text: string,
    overrides?: Partial<AgentOptions>,
  ): Promise<QueryResult> {
    const t0 = performance.now()
    const collected = { text: '', turns: 0, tokens: { in: 0, out: 0 } }

    for await (const ev of this.query(text, overrides)) {
      switch (ev.type) {
        case 'assistant': {
          // Extract the last assistant text (multi-turn: only final answer matters)
          const fragments = (ev.message.content as any[])
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
          if (fragments.length) collected.text = fragments.join('')
          break
        }
        case 'result':
          collected.turns = ev.num_turns ?? 0
          collected.tokens.in = ev.usage?.input_tokens ?? 0
          collected.tokens.out = ev.usage?.output_tokens ?? 0
          break
      }
    }

    return {
      text: collected.text,
      usage: { input_tokens: collected.tokens.in, output_tokens: collected.tokens.out },
      num_turns: collected.turns,
      duration_ms: Math.round(performance.now() - t0),
      messages: [...this.messageLog],
    }
  }

  /**
   * Get conversation messages.
   */
  getMessages(): Message[] {
    return [...this.messageLog]
  }

  /**
   * Reset conversation history.
   */
  clear(): void {
    this.history = []
    this.messageLog = []
  }

  /**
   * Interrupt the current query.
   */
  async interrupt(): Promise<void> {
    this.abortCtrl?.abort()
  }

  /**
   * Change the model during a session.
   */
  async setModel(model?: string): Promise<void> {
    if (model) {
      this.modelId = model
      this.cfg.model = model
    }
  }

  /**
   * Change the permission mode during a session.
   */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.cfg.permissionMode = mode
  }

  /**
   * Set maximum thinking tokens.
   */
  async setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void> {
    if (maxThinkingTokens === null) {
      this.cfg.thinking = { type: 'disabled' }
    } else {
      this.cfg.thinking = { type: 'enabled', budgetTokens: maxThinkingTokens }
    }
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string {
    return this.sid
  }

  /**
   * Get the current API type.
   */
  getApiType(): ApiType {
    return this.apiType
  }

  /**
   * Stop a background task.
   */
  async stopTask(taskId: string): Promise<void> {
    const { getTask } = await import('./tools/task-tools.js')
    const task = getTask(taskId)
    if (task) {
      task.status = 'cancelled'
    }
  }

  /**
   * Close MCP connections and clean up.
   * Optionally persist session to disk.
   */
  async close(): Promise<void> {
    // Persist session if enabled
    if (this.cfg.persistSession !== false && this.history.length > 0) {
      try {
        await saveSession(this.sid, this.history, {
          cwd: this.cfg.cwd || process.cwd(),
          model: this.modelId,
          summary: undefined,
        })
      } catch {
        // Session persistence is best-effort
      }
    }

    for (const conn of this.mcpLinks) {
      await conn.close()
    }
    this.mcpLinks = []
  }
}

// --------------------------------------------------------------------------
// Factory function
// --------------------------------------------------------------------------

/** Factory: shorthand for `new Agent(options)`. */
export function createAgent(options: AgentOptions = {}): Agent {
  return new Agent(options)
}

// --------------------------------------------------------------------------
// Standalone query — one-shot convenience wrapper
// --------------------------------------------------------------------------

/**
 * Execute a single agentic query without managing an Agent instance.
 * The agent is created, used, and cleaned up automatically.
 */
export async function* query(params: {
  prompt: string
  options?: AgentOptions
}): AsyncGenerator<SDKMessage, void> {
  const ephemeral = createAgent(params.options)
  try {
    yield* ephemeral.query(params.prompt)
  } finally {
    await ephemeral.close()
  }
}

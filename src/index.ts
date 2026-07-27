/**
 * @codeany/open-agent-sdk
 *
 * Open-source Agent SDK by CodeAny (https://codeany.ai).
 * Runs the full agent loop in-process without spawning subprocesses.
 *
 * Features:
 * - 30+ built-in tools (file I/O, shell, web, agents, tasks, teams, etc.)
 * - Skill system (reusable prompt templates with bundled skills)
 * - MCP server integration (stdio, SSE, HTTP)
 * - Context compression (auto-compact, micro-compact)
 * - Retry with exponential backoff
 * - Git status & project context injection
 * - Multi-turn session persistence
 * - Permission system (allow/deny/bypass modes)
 * - Subagent spawning & team coordination
 * - Task management & scheduling
 * - Hook system with lifecycle integration (pre/post tool use, session, compact)
 * - Token estimation & cost tracking
 * - File state LRU caching
 * - Plan mode for structured workflows
 */

// --------------------------------------------------------------------------
// High-level Agent API
// --------------------------------------------------------------------------

export { Agent, createAgent, query } from './agent.js'

// --------------------------------------------------------------------------
// Tool Helper (Zod-based tool creation, compatible with official SDK)
// --------------------------------------------------------------------------

export { tool, sdkToolToToolDefinition } from './tool-helper.js'
export type {
  ToolAnnotations,
  CallToolResult,
  SdkMcpToolDefinition,
} from './tool-helper.js'

// --------------------------------------------------------------------------
// In-Process MCP Server
// --------------------------------------------------------------------------

export { createSdkMcpServer, isSdkServerConfig } from './sdk-mcp-server.js'
export type { McpSdkServerConfig } from './sdk-mcp-server.js'

// --------------------------------------------------------------------------
// Core Engine
// --------------------------------------------------------------------------

export { QueryEngine } from './engine.js'

// --------------------------------------------------------------------------
// LLM Providers (Anthropic + OpenAI)
// --------------------------------------------------------------------------

export {
  createProvider,
  AnthropicProvider,
  OpenAIProvider,
} from './providers/index.js'
export type {
  ApiType,
  LLMProvider,
  CreateMessageParams,
  CreateMessageResponse,
  NormalizedMessageParam,
  NormalizedContentBlock,
  NormalizedTool,
  NormalizedResponseBlock,
  ResponseFormat,
} from './providers/index.js'

// --------------------------------------------------------------------------
// Tool System (30+ tools)
// --------------------------------------------------------------------------

export {
  // Registry
  getAllBaseTools,
  filterTools,
  assembleToolPool,

  // Helpers
  defineTool,
  toApiTool,

  // Core file I/O & execution
  BashTool,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  GlobTool,
  GrepTool,
  NotebookEditTool,

  // Web
  WebFetchTool,
  WebSearchTool,

  // Agent & Multi-agent
  AgentTool,
  SendMessageTool,
  TeamCreateTool,
  TeamDeleteTool,

  // Tasks
  TaskCreateTool,
  TaskListTool,
  TaskUpdateTool,
  TaskGetTool,
  TaskStopTool,
  TaskOutputTool,

  // Worktree
  EnterWorktreeTool,
  ExitWorktreeTool,

  // Planning
  EnterPlanModeTool,
  ExitPlanModeTool,

  // User interaction
  AskUserQuestionTool,

  // Discovery
  ToolSearchTool,

  // MCP Resources
  ListMcpResourcesTool,
  ReadMcpResourceTool,

  // Scheduling
  CronCreateTool,
  CronDeleteTool,
  CronListTool,
  RemoteTriggerTool,

  // LSP
  LSPTool,

  // Config
  ConfigTool,

  // Todo
  TodoWriteTool,

  // Skill
  SkillTool,
} from './tools/index.js'

// --------------------------------------------------------------------------
// MCP Client
// --------------------------------------------------------------------------

export { connectMCPServer, closeAllConnections } from './mcp/client.js'
export type { MCPConnection } from './mcp/client.js'

// --------------------------------------------------------------------------
// Skill System
// --------------------------------------------------------------------------

export {
  registerSkill,
  getSkill,
  getAllSkills,
  getUserInvocableSkills,
  hasSkill,
  unregisterSkill,
  clearSkills,
  formatSkillsForPrompt,
  initBundledSkills,
} from './skills/index.js'
export type {
  SkillDefinition,
  SkillContentBlock,
  SkillResult,
} from './skills/index.js'

// --------------------------------------------------------------------------
// Hook System
// --------------------------------------------------------------------------

export {
  HookRegistry,
  createHookRegistry,
  HOOK_EVENTS,
} from './hooks.js'
export type {
  HookEvent,
  HookDefinition,
  HookInput,
  HookOutput,
  HookConfig,
} from './hooks.js'

// --------------------------------------------------------------------------
// Session Management
// --------------------------------------------------------------------------

export {
  saveSession,
  loadSession,
  listSessions,
  forkSession,
  getSessionMessages,
  getSessionInfo,
  renameSession,
  tagSession,
  appendToSession,
  deleteSession,
} from './session.js'
export type { SessionMetadata, SessionData } from './session.js'

// --------------------------------------------------------------------------
// Context Utilities
// --------------------------------------------------------------------------

export {
  getSystemContext,
  getUserContext,
  getGitStatus,
  readProjectContextContent,
  discoverProjectContextFiles,
  clearContextCache,
} from './utils/context.js'

// --------------------------------------------------------------------------
// Message Utilities
// --------------------------------------------------------------------------

export {
  createUserMessage,
  createAssistantMessage,
  normalizeMessagesForAPI,
  stripImagesFromMessages,
  extractTextFromContent,
  createCompactBoundaryMessage,
  truncateText,
} from './utils/messages.js'

// --------------------------------------------------------------------------
// Token Estimation & Cost
// --------------------------------------------------------------------------

export {
  estimateTokens,
  estimateMessagesTokens,
  estimateSystemPromptTokens,
  getTokenCountFromUsage,
  getContextWindowSize,
  getAutoCompactThreshold,
  estimateCost,
  MODEL_PRICING,
  AUTOCOMPACT_BUFFER_TOKENS,
} from './utils/tokens.js'

// --------------------------------------------------------------------------
// Context Compression
// --------------------------------------------------------------------------

export {
  shouldAutoCompact,
  compactConversation,
  microCompactMessages,
  createAutoCompactState,
} from './utils/compact.js'
export type { AutoCompactState } from './utils/compact.js'

// --------------------------------------------------------------------------
// Retry Logic
// --------------------------------------------------------------------------

export {
  withRetry,
  isRetryableError,
  isPromptTooLongError,
  isAuthError,
  isRateLimitError,
  formatApiError,
  getRetryDelay,
  DEFAULT_RETRY_CONFIG,
} from './utils/retry.js'
export type { RetryConfig } from './utils/retry.js'

// --------------------------------------------------------------------------
// File State Cache
// --------------------------------------------------------------------------

export {
  FileStateCache,
  createFileStateCache,
} from './utils/fileCache.js'
export type { FileState } from './utils/fileCache.js'

// --------------------------------------------------------------------------
// Task & Team State (for advanced usage)
// --------------------------------------------------------------------------

export {
  getAllTasks,
  getTask,
  clearTasks,
} from './tools/task-tools.js'
export type { Task, TaskStatus } from './tools/task-tools.js'

export {
  getAllTeams,
  getTeam,
  clearTeams,
} from './tools/team-tools.js'
export type { Team } from './tools/team-tools.js'

export {
  readMailbox,
  writeToMailbox,
  clearMailboxes,
} from './tools/send-message.js'
export type { AgentMessage } from './tools/send-message.js'

export {
  isPlanModeActive,
  getCurrentPlan,
} from './tools/plan-tools.js'

export {
  registerAgents,
  clearAgents,
} from './tools/agent-tool.js'

export {
  setQuestionHandler,
  clearQuestionHandler,
} from './tools/ask-user.js'

export {
  setDeferredTools,
} from './tools/tool-search.js'

export {
  setMcpConnections,
} from './tools/mcp-resource-tools.js'

export {
  getAllCronJobs,
  clearCronJobs,
} from './tools/cron-tools.js'
export type { CronJob } from './tools/cron-tools.js'

export {
  getConfig,
  setConfig,
  clearConfig,
} from './tools/config-tool.js'

export {
  getTodos,
  clearTodos,
} from './tools/todo-tool.js'
export type { TodoItem } from './tools/todo-tool.js'

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type {
  // Message types
  Message,
  UserMessage,
  AssistantMessage,
  ConversationMessage,
  MessageRole,

  // SDK message types (streaming events)
  SDKMessage,
  SDKAssistantMessage,
  SDKToolResultMessage,
  SDKResultMessage,
  SDKPartialMessage,

  // Tool types
  ToolDefinition,
  ToolInputSchema,
  ToolContext,
  ToolResult,

  // Permission types
  PermissionMode,
  PermissionBehavior,
  CanUseToolFn,
  CanUseToolResult,

  // MCP types
  McpServerConfig,
  McpStdioConfig,
  McpSseConfig,
  McpHttpConfig,

  // Agent types
  AgentOptions,
  AgentDefinition,
  QueryResult,
  ThinkingConfig,
  TokenUsage,

  // Engine types
  QueryEngineConfig,

  // Content block types
  ContentBlockParam,
  ContentBlock,

  // Sandbox types
  SandboxSettings,
  SandboxNetworkConfig,
  SandboxFilesystemConfig,

  // Output format
  OutputFormat,

  // Setting sources
  SettingSource,

  // Model info
  ModelInfo,
} from './types.js'

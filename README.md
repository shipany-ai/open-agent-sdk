# Open Agent SDK (中文版)

[![npm](https://img.shields.io/npm/v/@shipany/open-agent-sdk.svg?style=flat-square)](https://www.npmjs.com/package/@shipany/open-agent-sdk) ![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

Open Agent SDK 是一个开源的 Agent SDK，灵感来自 [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)。构建能够理解代码库、编辑文件、运行命令、搜索网页以及执行复杂多步骤工作流的自主 AI 代理。

与官方的 `@anthropic-ai/claude-agent-sdk` 不同，它需要本地 Claude Code CLI 进程，**Open Agent SDK 在进程内运行完整的 agent 循环** — 可以部署到任何地方：云服务器、无服务器函数、Docker 容器、CI/CD 流水线。

## 快速开始

```sh
npm install @shipany/open-agent-sdk
```

设置你的 API 密钥：

```sh
export ANTHROPIC_API_KEY=your-api-key
```

或者使用第三方提供商（如 [OpenRouter](https://openrouter.ai/)）：

```sh
export ANTHROPIC_BASE_URL=https://openrouter.ai/api
export ANTHROPIC_API_KEY=your-openrouter-api-key
export ANTHROPIC_MODEL=anthropic/claude-sonnet-4-6
```

## 使用示例

### 一次性查询（兼容官方 SDK）

```typescript
import { query } from '@shipany/open-agent-sdk'

for await (const message of query({
  prompt: 'Find and fix the bug in auth.py',
  options: {
    allowedTools: ['Read', 'Edit', 'Bash'],
    permissionMode: 'acceptEdits',
  },
})) {
  if (message.type === 'assistant' && message.message?.content) {
    for (const block of message.message.content) {
      if ('text' in block) console.log(block.text)
      else if ('name' in block) console.log(`Tool: ${block.name}`)
    }
  } else if (message.type === 'result') {
    console.log(`Done: ${message.subtype}`)
  }
}
```

### 简单提示（阻塞式）

```typescript
import { createAgent } from '@shipany/open-agent-sdk'

const agent = createAgent({ model: 'claude-sonnet-4-6' })
const result = await agent.prompt('Read package.json and tell me the project name')

console.log(result.text)
console.log(`Tokens: ${result.usage.input_tokens + result.usage.output_tokens}`)
```

### 多轮对话

```typescript
import { createAgent } from '@shipany/open-agent-sdk'

const agent = createAgent({
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You are a senior software engineer. Be concise.',
})

const r1 = await agent.prompt('Read the main entry point and explain the architecture')
console.log(r1.text)

// 第 1 轮的完整上下文会被保留
const r2 = await agent.prompt('Now refactor the error handling')
console.log(r2.text)
```

### 自定义工具

```typescript
import { createAgent, getAllBaseTools } from '@shipany/open-agent-sdk'

const weatherTool = {
  name: 'GetWeather',
  description: 'Get weather for a city',
  inputJSONSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
  get inputSchema() { return { safeParse: (v) => ({ success: true, data: v }) } },
  async prompt() { return this.description },
  async call(input) { return { data: `Weather in ${input.city}: 22°C, sunny` } },
  userFacingName: () => 'GetWeather',
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  mapToolResultToToolResultBlockParam: (data, id) => ({
    type: 'tool_result',
    tool_use_id: id,
    content: data,
  }),
}

const agent = createAgent({
  tools: [...getAllBaseTools(), weatherTool],
})

const result = await agent.prompt('What is the weather in Tokyo?')
```

### MCP 服务器集成

```typescript
import { createAgent } from '@shipany/open-agent-sdk'

const agent = createAgent({
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    },
    playwright: {
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    },
  },
})

const result = await agent.prompt('List files in /tmp')
```

### 子代理（Subagents）

```typescript
import { query } from '@shipany/open-agent-sdk'

for await (const message of query({
  prompt: 'Use the code-reviewer agent to review this codebase',
  options: {
    allowedTools: ['Read', 'Glob', 'Grep', 'Agent'],
    agents: {
      'code-reviewer': {
        description: 'Expert code reviewer for quality and security.',
        prompt: 'Analyze code quality and suggest improvements.',
        tools: ['Read', 'Glob', 'Grep'],
      },
    },
  },
})) {
  // 处理消息...
}
```

### 权限控制

```typescript
import { query } from '@shipany/open-agent-sdk'

// 只读代理：只能分析，不能修改
for await (const message of query({
  prompt: 'Review this code for best practices',
  options: {
    allowedTools: ['Read', 'Glob', 'Grep'],
  },
})) {
  // ...
}
```

## API 参考

### `query({ prompt, options })`

顶层入口点，兼容 `@anthropic-ai/claude-agent-sdk`。返回 `AsyncGenerator<SDKMessage>`。

### `createAgent(options)`

创建一个具有持久会话状态的可重用代理。

#### 选项

| 选项 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `model` | string | `claude-sonnet-4-6` | Claude 模型 ID |
| `apiKey` | string | `env.ANTHROPIC_API_KEY` | API 密钥 |
| `baseURL` | string | Anthropic API | API 基础 URL（用于第三方提供商） |
| `cwd` | string | `process.cwd()` | 工具的工作目录 |
| `systemPrompt` | string | — | 自定义系统提示词 |
| `tools` | Tool[] | All built-in | 可用工具 |
| `allowedTools` | string[] | — | 工具白名单（如 `['Read', 'Glob']`） |
| `permissionMode` | string | `bypassPermissions` | `acceptEdits` / `bypassPermissions` / `plan` / `default` |
| `maxTurns` | number | `100` | 最大 agent 轮数 |
| `maxBudgetUsd` | number | — | 最大 USD 花费 |
| `mcpServers` | object | — | MCP 服务器配置 |
| `agents` | object | — | 自定义子代理定义 |
| `hooks` | object | — | 生命周期钩子（PreToolUse, PostToolUse, Stop 等） |
| `thinking` | object | — | 扩展思考配置 |
| `env` | object | — | 环境变量（兼容官方 SDK） |
| `resume` | string | — | 通过 ID 恢复之前的会话 |
| `canUseTool` | function | — | 自定义权限回调 |
| `includePartialMessages` | boolean | `false` | 包含原始流式事件 |

## 环境变量

| 变量 | 描述 |
|------|------|
| `ANTHROPIC_API_KEY` | API 密钥 |
| `ANTHROPIC_BASE_URL` | API 基础 URL（用于 OpenRouter 等第三方提供商） |
| `ANTHROPIC_MODEL` | 默认模型 |

也支持通过 `options.env` 传递环境变量，与官方 SDK 相同。

## 内置工具

| 工具 | 描述 |
|------|------|
| **Read** | 读取文件（行号、图片、PDF） |
| **Write** | 创建或覆盖文件 |
| **Edit** | 精确的字符串替换 |
| **Bash** | 执行 shell 命令 |
| **Glob** | 按模式查找文件 |
| **Grep** | 正则搜索文件内容（ripgrep） |
| **WebFetch** | 获取并解析网页内容 |
| **WebSearch** | 网页搜索 |
| **Agent** | 生成子代理并行工作 |
| **NotebookEdit** | 编辑 Jupyter notebooks |
| **Skill** | 调用自定义技能 |
| **AskUserQuestion** | 向用户提出澄清问题 |
| **TodoWrite** | 创建/管理待办事项列表 |
| **ToolSearch** | 搜索可用工具 |
| **SendMessage** | 向代理/队友发送消息 |
| **TeamCreate / TeamDelete** | 创建/删除代理团队 |
| **EnterPlanMode / ExitPlanMode** | 计划审批模式 |
| **EnterWorktree / ExitWorktree** | Git worktree 隔离 |
| **ListMcpResources / ReadMcpResource** | MCP 资源访问 |
| **TaskCreate / TaskUpdate / TaskList / TaskGet / TaskStop / TaskOutput** | 任务管理 |

## 架构

官方 `@anthropic-ai/claude-agent-sdk` 架构：

```
Your code → SDK → spawn cli.js subprocess → stdin/stdout JSON → Anthropic API
```

**Open Agent SDK** 在进程内运行所有内容：

```
Your code → SDK → QueryEngine → Anthropic API (direct)
```

### 内部机制

该 SDK 包含**完整的 Claude Code 引擎**（2,000+ 源文件），不是简化的重新实现：

| 组件 | 描述 |
|------|------|
| **System Prompt** | 完整的提示词构造 + 静态/动态边界缓存 |
| **Permission System** | 4层管道：rules → low-risk skip → whitelist → AI classifier + circuit breaker |
| **Memory System** | 自动记忆，4种类型（user/feedback/project/reference），autoDream 后台组织器 |
| **Context Compression** | 9段结构化提取（autocompact, microcompact, snip compact） |
| **Multi-Agent** | Leader/Teammate 团队，Git worktree 隔离，权限冒泡，异步邮箱 |
| **MCP Client** | 完整的 MCP 支持：stdio、SSE、HTTP 传输 |
| **Search** | ripgrep + glob（与 Claude Code 相同 — 无需向量 DB） |
| **Tool Execution** | 只读工具的并发批处理，修改工具的串行执行 |
| **API Client** | 流式传输，指数退避重试，回退模型，提示词缓存 |

## 与 `@anthropic-ai/claude-agent-sdk` 的比较

| 功能 | 官方 SDK | Open Agent SDK |
|------|----------|----------------|
| **架构** | 生成本地 CLI 子进程 | 进程内 agent 循环 |
| **云部署** | 需要安装 CLI | 可在任何地方工作 |
| **无服务器** | 不支持 | 完全支持 |
| **Docker** | 需要在镜像中包含 CLI | 只需 `npm install` |
| **API 表面** | `query()`, `tool()`, `sessions` | `query()`, `createAgent()`, `sessions` |
| **内置工具** | 26 个工具 | 26 个工具（相同集合） |
| **系统提示词** | 完整引擎 | 完整引擎（相同代码） |
| **权限系统** | 4层 + AI 分类器 | 4层 + AI 分类器（相同代码） |
| **记忆系统** | 自动记忆 + autoDream | 自动记忆 + autoDream（相同代码） |
| **上下文压缩** | 9段结构化 | 9段结构化（相同代码） |
| **多代理** | 团队，worktrees | 团队，worktrees（相同代码） |
| **MCP 支持** | 完整 | 完整（相同代码） |
| **自定义工具** | 通过 MCP | 原生函数工具 + MCP |
| **流式传输** | 通过子进程 stdio | 直接 API 流式传输 |

## 示例

查看 [`examples/`](https://github.com/shipany-ai/open-agent-sdk/tree/main/examples) 目录：

| # | 示例 | 演示内容 |
|---|------|----------|
| 01 | [Simple Query](https://github.com/shipany-ai/open-agent-sdk/blob/main/examples/01-simple-query.ts) | 使用 `createAgent().query()` 进行流式传输 |
| 02 | [Multi-Tool](https://github.com/shipany-ai/open-agent-sdk/blob/main/examples/02-multi-tool.ts) | Glob + Bash 编排 |
| 03 | [Multi-Turn](https://github.com/shipany-ai/open-agent-sdk/blob/main/examples/03-multi-turn.ts) | 跨轮次的会话持久性 |
| 04 | [Prompt API](https://github.com/shipany-ai/open-agent-sdk/blob/main/examples/04-prompt-api.ts) | 阻塞式 `agent.prompt()` |
| 05 | [System Prompt](https://github.com/shipany-ai/open-agent-sdk/blob/main/examples/05-custom-system-prompt.ts) | 自定义系统提示词 |
| 06 | [MCP Server](https://github.com/shipany-ai/open-agent-sdk/blob/main/examples/06-mcp-server.ts) | MCP stdio 传输 |
| 07 | [Custom Tools](https://github.com/shipany-ai/open-agent-sdk/blob/main/examples/07-custom-tools.ts) | 用户定义的工具 |
| 08 | [Official API](https://github.com/shipany-ai/open-agent-sdk/blob/main/examples/08-official-api-compat.ts) | `query()` 即插即用兼容 |
| 09 | [Subagents](https://github.com/shipany-ai/open-agent-sdk/blob/main/examples/09-subagents.ts) | 代理委托 |
| 10 | [Permissions](https://github.com/shipany-ai/open-agent-sdk/blob/main/examples/10-permissions.ts) | 只读代理 |

运行任何示例：

```sh
npx tsx examples/01-simple-query.ts
```

## 报告错误

在 [github.com/shipany-ai/open-agent-sdk/issues](https://github.com/shipany-ai/open-agent-sdk/issues) 提交问题。

## 贡献者

- [@idoubi](https://github.com/idoubi)
- [@claude](https://github.com/claude)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=shipany-ai/open-agent-sdk&type=Date)](https://star-history.com/#shipany-ai/open-agent-sdk&Date)

## 许可证

MIT

---

## 中文版说明

本仓库是 [shipany-ai/open-agent-sdk](https://github.com/shipany-ai/open-agent-sdk) 的中文版，由 [srxly888-creator](https://github.com/srxly888-creator) 维护。

### 主要改动

- ✅ README 完整中文翻译
- ✅ 保留所有代码示例
- ✅ 技术术语保持原文
- ✅ 链接和引用保持不变

### 贡献

欢迎提交 Issue 和 Pull Request！

### 原项目

- 原始仓库：https://github.com/shipany-ai/open-agent-sdk
- NPM 包：[@shipany/open-agent-sdk](https://www.npmjs.com/package/@shipany/open-agent-sdk)

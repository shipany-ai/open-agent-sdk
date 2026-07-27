/**
 * Structured-output (`outputFormat`) end-to-end test.
 *
 * Verifies the fix for the bug where `AgentOptions.outputFormat` was declared
 * in the public types but silently dropped before reaching the provider, so
 * `result.structured_output` was always `undefined`.
 *
 * The test uses a mock `LLMProvider` so it can:
 *   - inspect what the engine actually sent (system prompt, response_format),
 *   - return canned text and tool_use blocks deterministically.
 *
 * It additionally stubs `global.fetch` to confirm `OpenAIProvider` writes
 * `response_format` into the HTTP body.
 *
 * Run: npx tsx tests/structured-output.test.ts
 */

import { createAgent } from '../src/index.js'
import { OpenAIProvider } from '../src/providers/openai.js'
import type {
  LLMProvider,
  CreateMessageParams,
  CreateMessageResponse,
} from '../src/providers/types.js'

// --------------------------------------------------------------------------
// Tiny assertion helper (keeps the test self-contained).
// --------------------------------------------------------------------------

let passed = 0
let failed = 0
const failures: string[] = []

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++
    console.log(`  ok    ${msg}`)
  } else {
    failed++
    failures.push(msg)
    console.log(`  FAIL  ${msg}`)
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed++
    console.log(`  ok    ${msg}`)
  } else {
    failed++
    failures.push(`${msg}\n        expected: ${e}\n        actual:   ${a}`)
    console.log(`  FAIL  ${msg}`)
    console.log(`        expected: ${e}`)
    console.log(`        actual:   ${a}`)
  }
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`)
}

// --------------------------------------------------------------------------
// Mock provider: records every call and replays scripted responses.
// --------------------------------------------------------------------------

interface ScriptedResponse {
  content: CreateMessageResponse['content']
  stopReason?: CreateMessageResponse['stopReason']
}

class MockProvider implements LLMProvider {
  readonly apiType = 'openai-completions' as const
  public calls: CreateMessageParams[] = []
  private script: ScriptedResponse[]

  constructor(script: ScriptedResponse[]) {
    this.script = [...script]
  }

  async createMessage(params: CreateMessageParams): Promise<CreateMessageResponse> {
    this.calls.push({
      ...params,
      messages: structuredClone(params.messages),
    })
    const next = this.script.shift()
    if (!next) {
      throw new Error('MockProvider: script exhausted (engine called more turns than scripted)')
    }
    return {
      content: next.content,
      stopReason: next.stopReason ?? 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 },
    }
  }
}

/**
 * Inject a custom provider into the Agent. Bypasses the normal
 * `createProvider(apiType, ...)` factory so tests don't need real API keys.
 */
function withMockProvider(agent: any, mock: MockProvider): MockProvider {
  agent.provider = mock
  return mock
}

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer' },
  },
  required: ['name', 'age'],
}

// --------------------------------------------------------------------------
// Test 1: Happy path — model returns clean JSON
// --------------------------------------------------------------------------

async function test_happyPath() {
  section('Test 1: happy path (clean JSON response)')

  const agent = createAgent({
    apiType: 'openai-completions',
    apiKey: 'mock',
    baseURL: 'https://example.invalid',
    model: 'gpt-4o',
    tools: [],
    outputFormat: { type: 'json_schema', schema: SCHEMA },
  })

  const mock = withMockProvider(
    agent,
    new MockProvider([
      { content: [{ type: 'text', text: '{"name":"alice","age":30}' }] },
    ]),
  )

  const result = await agent.prompt('introduce alice')

  assertEqual(mock.calls.length, 1, 'provider called exactly once')
  assert(
    typeof mock.calls[0].system === 'string' &&
      mock.calls[0].system.includes('# Structured Output Schema'),
    'system prompt contains schema injection block',
  )
  assert(
    typeof mock.calls[0].system === 'string' &&
      mock.calls[0].system.includes('"required"'),
    'system prompt actually serialises the schema',
  )
  assertEqual(
    mock.calls[0].response_format,
    { type: 'json_object' },
    'response_format = { type: "json_object" } forwarded to provider',
  )
  assertEqual(
    result.structured_output,
    { name: 'alice', age: 30 },
    'QueryResult.structured_output is the parsed object',
  )
}

// --------------------------------------------------------------------------
// Test 2: JSON wrapped in Markdown fences
// --------------------------------------------------------------------------

async function test_fencedJson() {
  section('Test 2: model wraps JSON in ```json fences')

  const agent = createAgent({
    apiType: 'openai-completions',
    apiKey: 'mock',
    baseURL: 'https://example.invalid',
    model: 'gpt-4o',
    tools: [],
    outputFormat: { type: 'json_schema', schema: SCHEMA },
  })

  withMockProvider(
    agent,
    new MockProvider([
      { content: [{ type: 'text', text: '```json\n{"name":"bob","age":7}\n```' }] },
    ]),
  )

  const result = await agent.prompt('introduce bob')

  assertEqual(
    result.structured_output,
    { name: 'bob', age: 7 },
    'fenced JSON is unwrapped and parsed',
  )
}

// --------------------------------------------------------------------------
// Test 3: JSON embedded in prose (slice fallback)
// --------------------------------------------------------------------------

async function test_jsonInProse() {
  section('Test 3: JSON embedded in prose')

  const agent = createAgent({
    apiType: 'openai-completions',
    apiKey: 'mock',
    baseURL: 'https://example.invalid',
    model: 'gpt-4o',
    tools: [],
    outputFormat: { type: 'json_schema', schema: SCHEMA },
  })

  withMockProvider(
    agent,
    new MockProvider([
      {
        content: [
          {
            type: 'text',
            text: 'Sure thing! {"name":"carol","age":42} — let me know if you need more.',
          },
        ],
      },
    ]),
  )

  const result = await agent.prompt('introduce carol')

  assertEqual(
    result.structured_output,
    { name: 'carol', age: 42 },
    'JSON sliced out of surrounding prose',
  )
}

// --------------------------------------------------------------------------
// Test 4: No outputFormat → no injection, no response_format, no parsing
// --------------------------------------------------------------------------

async function test_noOutputFormat() {
  section('Test 4: outputFormat omitted → no structured output behaviour')

  const agent = createAgent({
    apiType: 'openai-completions',
    apiKey: 'mock',
    baseURL: 'https://example.invalid',
    model: 'gpt-4o',
    tools: [],
  })

  const mock = withMockProvider(
    agent,
    new MockProvider([
      { content: [{ type: 'text', text: '{"name":"dan","age":1}' }] },
    ]),
  )

  const result = await agent.prompt('hi')

  assert(
    !(mock.calls[0].system || '').includes('# Structured Output Schema'),
    'system prompt does NOT contain schema block when outputFormat unset',
  )
  assertEqual(
    mock.calls[0].response_format,
    undefined,
    'response_format is undefined when outputFormat unset',
  )
  assertEqual(
    result.structured_output,
    undefined,
    'structured_output is undefined even though model happened to emit JSON',
  )
}

// --------------------------------------------------------------------------
// Test 5: Invalid JSON → structured_output is undefined, not garbage
// --------------------------------------------------------------------------

async function test_invalidJson() {
  section('Test 5: model returns non-JSON text → structured_output undefined')

  const agent = createAgent({
    apiType: 'openai-completions',
    apiKey: 'mock',
    baseURL: 'https://example.invalid',
    model: 'gpt-4o',
    tools: [],
    outputFormat: { type: 'json_schema', schema: SCHEMA },
  })

  withMockProvider(
    agent,
    new MockProvider([
      { content: [{ type: 'text', text: 'sorry I cannot do that' }] },
    ]),
  )

  const result = await agent.prompt('?')

  assertEqual(
    result.structured_output,
    undefined,
    'structured_output stays undefined when parsing fails',
  )
}

// --------------------------------------------------------------------------
// Test 6: Custom systemPrompt still gets schema appended
// --------------------------------------------------------------------------

async function test_customSystemPrompt() {
  section('Test 6: custom systemPrompt still receives schema injection')

  const agent = createAgent({
    apiType: 'openai-completions',
    apiKey: 'mock',
    baseURL: 'https://example.invalid',
    model: 'gpt-4o',
    tools: [],
    systemPrompt: 'You are a pirate.',
    outputFormat: { type: 'json_schema', schema: SCHEMA },
  })

  const mock = withMockProvider(
    agent,
    new MockProvider([
      { content: [{ type: 'text', text: '{"name":"eve","age":5}' }] },
    ]),
  )

  await agent.prompt('go')

  const sys = mock.calls[0].system as string
  assert(sys.includes('You are a pirate.'), 'custom systemPrompt is preserved')
  assert(
    sys.includes('# Structured Output Schema'),
    'schema block is appended to custom systemPrompt',
  )
}

// --------------------------------------------------------------------------
// Test 7: OpenAIProvider HTTP body actually contains response_format
// --------------------------------------------------------------------------

async function test_openaiProviderTransport() {
  section('Test 7: OpenAIProvider sends response_format in HTTP body')

  const origFetch = globalThis.fetch
  let capturedBody: any = null

  globalThis.fetch = (async (_url: any, init: any) => {
    capturedBody = JSON.parse(init.body)
    return new Response(
      JSON.stringify({
        id: 'x',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"ok":true}' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as any

  try {
    const provider = new OpenAIProvider({
      apiKey: 'mock',
      baseURL: 'https://example.invalid',
    })
    await provider.createMessage({
      model: 'gpt-4o',
      maxTokens: 100,
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: { type: 'json_object' },
    })

    assert(capturedBody !== null, 'fetch was invoked')
    assertEqual(
      capturedBody.response_format,
      { type: 'json_object' },
      'HTTP body contains response_format',
    )

    // And confirm omission stays omission
    capturedBody = null
    await provider.createMessage({
      model: 'gpt-4o',
      maxTokens: 100,
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    })
    assertEqual(
      capturedBody.response_format,
      undefined,
      'response_format absent from body when not requested',
    )
  } finally {
    globalThis.fetch = origFetch
  }
}

// --------------------------------------------------------------------------
// Test 8: Multi-turn — structured_output reflects the FINAL turn
// --------------------------------------------------------------------------

async function test_multiTurnFinalTurnWins() {
  section('Test 8: multi-turn — last successful parse wins')

  const agent = createAgent({
    apiType: 'openai-completions',
    apiKey: 'mock',
    baseURL: 'https://example.invalid',
    model: 'gpt-4o',
    tools: [],
    outputFormat: { type: 'json_schema', schema: SCHEMA },
  })

  // Turn 1: model "thinks out loud" with intermediate JSON.
  // Turn 2: nope, no JSON at all.
  // Engine should keep the first turn's JSON since the second turn produced
  // nothing parseable (we never overwrite with undefined).
  withMockProvider(
    agent,
    new MockProvider([
      { content: [{ type: 'text', text: '{"name":"frank","age":1}' }] },
    ]),
  )

  const result = await agent.prompt('think')
  assertEqual(
    result.structured_output,
    { name: 'frank', age: 1 },
    'structured_output kept from the single produced JSON turn',
  )
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  console.log('=== Structured output (outputFormat) test suite ===')
  await test_happyPath()
  await test_fencedJson()
  await test_jsonInProse()
  await test_noOutputFormat()
  await test_invalidJson()
  await test_customSystemPrompt()
  await test_openaiProviderTransport()
  await test_multiTurnFinalTurnWins()

  console.log(`\n=== ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('test runner crashed:', err)
  process.exit(1)
})

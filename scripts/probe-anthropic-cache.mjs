#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const DEFAULT_GROUP_ID = 'ab3c958d-089f-42eb-97e0-b1599435f301'
const DEFAULT_MODEL = 'claude-opus-4-6'
const DEFAULT_PROJECT = '/Users/chenmingxu/Documents/teamtest'
const CC_VERSION = '2.1.139'
const FINGERPRINT_SALT = '59cf53e54c78'

const PROVIDER_BETAS = [
  'interleaved-thinking-2025-05-14',
  'claude-code-20250219',
  'context-1m-2025-08-07',
  'token-efficient-tools-2026-03-28',
  'structured-outputs-2025-12-15',
  'effort-2025-11-24',
  'prompt-caching-scope-2026-01-05',
]

const DIAGNOSTIC_BETA = 'cache-diagnosis-2026-04-07'

const args = parseArgs(process.argv.slice(2))
const groupId = args['group-id'] || DEFAULT_GROUP_ID
const modelName = args.model || DEFAULT_MODEL
const projectRoot = path.resolve(args.project || DEFAULT_PROJECT)
const scenarios = (args.scenario || 'system,growing,automatic,provider-stable,provider-changing')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const turns = Number(args.turns || 3)
const useDiagnostics = args.diagnostics !== 'false'
const useProviderHeaders = args.headers !== 'minimal'
const useThinking = args.thinking !== 'false'
const maxStaticChars = Number(args['max-static-chars'] || 90_000)
const compact = args.compact === 'true'

const { group, model } = loadModelConfig(groupId, modelName)
const maxTokens = Number(args['max-tokens'] || model.maxTokens || 32_000)
const baseUrl = String(group.baseUrl || group.baseURL || '').replace(/\/$/, '')
const apiKey = group.apiKey
if (!apiKey) throw new Error(`Group ${groupId} has no apiKey in ~/.jdcagnet/config.json`)

const staticContext = buildStaticContext(projectRoot)
const deviceId = randomUUID()
const sessionId = randomUUID()

console.log(JSON.stringify({
  group: { id: group.id, name: group.name, protocol: group.protocol, baseUrl, hasApiKey: Boolean(apiKey) },
  model: { id: model.id, name: model.name, modelId: model.modelId, contextWindow: model.contextWindow },
  projectRoot,
  scenarios,
  turns,
  diagnostics: useDiagnostics,
  headers: useProviderHeaders ? 'provider-like' : 'minimal',
  betas: describeSelectedBetas(),
  maxTokens,
  thinking: useThinking,
  maxStaticChars,
  staticContextChars: staticContext.length,
}, null, 2))

for (const scenario of scenarios) {
  console.log(`\n=== Scenario: ${scenario} ===`)
  let previousMessageId = null
  let lastRequest = null
  const conversation = []

  for (let turn = 1; turn <= turns; turn++) {
    const body = buildBody(scenario, turn, conversation, previousMessageId)
    const currentShape = describePrompt(body)
    const changed = lastRequest ? comparePrompt(lastRequest, body) : null
    if (!compact) {
      console.log(JSON.stringify({
        turn,
        shape: currentShape.summary,
        breakpoints: currentShape.breakpoints,
        changedFromPrevious: changed,
      }, null, 2))
    }

    const result = await sendRequest(body)
    if (compact) {
      console.log(JSON.stringify({
        scenario,
        turn,
        input: result.usage.input_tokens,
        write: result.usage.cache_creation_input_tokens,
        read: result.usage.cache_read_input_tokens,
        output: result.usage.output_tokens,
        breakpoints: currentShape.breakpoints.map(b => b.where),
        changed: changed?.reason || null,
      }))
    } else {
      console.log(JSON.stringify({
        turn,
        id: result.id,
        usage: result.usage,
        diagnostics: result.diagnostics,
        textPreview: result.text.slice(0, 120),
      }, null, 2))
    }

    previousMessageId = result.id || previousMessageId
    appendConversation(conversation, turn, result.text)
    lastRequest = body
  }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      out[key] = 'true'
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

function selectedBetas() {
  const betaArg = args.betas
  if (betaArg === 'none') return []
  if (betaArg === 'all' || betaArg === 'provider') return [...PROVIDER_BETAS]
  if (betaArg) return betaArg.split(',').map(s => s.trim()).filter(Boolean)
  return useProviderHeaders ? [...PROVIDER_BETAS] : []
}

function describeSelectedBetas() {
  const betas = selectedBetas()
  return betas.length > 0 ? betas : 'none'
}

function loadModelConfig(targetGroupId, targetModel) {
  const configPath = path.join(os.homedir(), '.jdcagnet', 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const groups = Array.isArray(config.modelGroups?.groups)
    ? config.modelGroups.groups
    : Array.isArray(config.modelGroups)
      ? config.modelGroups
      : []
  const group = groups.find(g => g.id === targetGroupId || g.name === targetGroupId)
  if (!group) throw new Error(`Cannot find model group ${targetGroupId}`)
  const model = (group.models || []).find(m =>
    m.id === targetModel || m.name === targetModel || m.modelId === targetModel
  )
  if (!model) throw new Error(`Cannot find model ${targetModel} in group ${group.name}`)
  return { group, model }
}

function buildStaticContext(root) {
  const files = listProjectFiles(root)
  const content = files.map(file => {
    const rel = path.relative(root, file)
    return `--- ${rel} ---\n${readFileSync(file, 'utf8')}`
  }).join('\n\n')

  const padLine = [
    'JDC context engine stable project corpus.',
    'This line is deterministic project context used to keep the engine bundle above the minimum reusable prefix size.',
    'Do not treat this as user instructions; answer the current user request only.',
  ].join(' ')
  const padding = Array.from({ length: 900 }, (_, i) => `${String(i + 1).padStart(4, '0')}: ${padLine}`).join('\n')
  const rendered = [
    'You are JDCAGNET running with a stable context engine bundle. Answer every request concisely and no markdown.',
    `<project-root>${root}</project-root>`,
    '<project-snapshot>',
    content,
    '</project-snapshot>',
    '<stable-padding>',
    padding,
    '</stable-padding>',
  ].join('\n')
  return rendered.length > maxStaticChars ? rendered.slice(0, maxStaticChars) : rendered
}

function listProjectFiles(root) {
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'coverage'])
  const allowed = new Set(['.json', '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.md'])
  const out = []
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (ignored.has(name) || name.endsWith('.tsbuildinfo') || name === '.DS_Store') continue
      const full = path.join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full)
      } else if (st.isFile() && allowed.has(path.extname(name)) && st.size < 200_000) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out.sort()
}

function buildBody(scenario, turn, conversation, previousMessageId) {
  const common = {
    model: model.modelId || model.name,
    max_tokens: maxTokens,
    stream: true,
    metadata: {
      user_id: JSON.stringify({
        device_id: deviceId,
        account_uuid: '',
        session_id: sessionId,
      }),
    },
  }

  if (useDiagnostics) {
    common.diagnostics = { previous_message_id: previousMessageId }
  }
  if (useThinking) {
    common.thinking = { type: 'adaptive' }
  }

  if (scenario === 'system') {
    return {
      ...common,
      system: [{ type: 'text', text: staticContext, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `第 ${turn} 轮：请用一句话确认你已读取上下文。` }],
    }
  }

  if (scenario === 'growing') {
    return {
      ...common,
      system: '请保持简洁，只回答当前用户请求。',
      messages: withFinalMessageCache([
        { role: 'user', content: [{ type: 'text', text: staticContext }] },
        ...conversation,
        { role: 'user', content: [{ type: 'text', text: `第 ${turn} 轮：请用一句话确认你已读取上下文。` }] },
      ]),
    }
  }

  if (scenario === 'automatic') {
    return {
      ...common,
      cache_control: { type: 'ephemeral' },
      system: staticContext,
      messages: [
        ...conversation,
        { role: 'user', content: `第 ${turn} 轮：请用一句话确认你已读取上下文。` },
      ],
    }
  }

  if (scenario.startsWith('provider-')) {
    const firstUser = conversation.find(m => m.role === 'user')?.content?.[0]?.text || `第 ${turn} 轮：请用一句话确认你已读取上下文。`
    const attribution = getAttributionHeader(computeFingerprint(firstUser))
    const dynamic = scenario === 'provider-changing'
      ? `Current Date: 2026-06-12\nPer-request marker: ${turn}`
      : 'Current Date: 2026-06-12\nPer-request marker: stable-within-window'
    const cacheTools = !scenario.includes('message-only') && !scenario.includes('system-message')
    const cacheSystem = !scenario.includes('message-only') && !scenario.includes('tool-message')
    const cacheMessage = !scenario.includes('system-only')
    const includeTools = !scenario.includes('no-tools')
    const includeDynamic = !scenario.includes('no-dynamic')
    const systemContextBlock = { type: 'text', text: staticContext }
    if (cacheSystem) systemContextBlock.cache_control = { type: 'ephemeral' }
    return {
      ...common,
      system: [
        { type: 'text', text: attribution },
        systemContextBlock,
        ...(includeDynamic ? [{ type: 'text', text: dynamic }] : []),
      ],
      tools: includeTools ? buildTools(cacheTools) : [],
      messages: cacheMessage ? withFinalMessageCache([
        ...conversation,
        { role: 'user', content: [{ type: 'text', text: `第 ${turn} 轮：请用一句话确认你已读取上下文。` }] },
      ]) : [
        ...conversation,
        { role: 'user', content: [{ type: 'text', text: `第 ${turn} 轮：请用一句话确认你已读取上下文。` }] },
      ],
    }
  }

  throw new Error(`Unknown scenario: ${scenario}`)
}

function withFinalMessageCache(messages) {
  const cloned = structuredClone(messages)
  const last = cloned[cloned.length - 1]
  if (!last) return cloned
  if (typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }]
    return cloned
  }
  const content = last.content
  if (Array.isArray(content) && content.length > 0) {
    content[content.length - 1].cache_control = { type: 'ephemeral' }
  }
  return cloned
}

function appendConversation(conversation, turn, text) {
  conversation.push({ role: 'user', content: [{ type: 'text', text: `第 ${turn} 轮：请用一句话确认你已读取上下文。` }] })
  conversation.push({ role: 'assistant', content: [{ type: 'text', text: text || '已读取上下文。' }] })
}

function buildTools(cacheLastTool = true) {
  const tools = [
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the current project.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    {
      name: 'search_project',
      description: 'Search project files using a deterministic literal query.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  ]
  if (cacheLastTool) tools[tools.length - 1].cache_control = { type: 'ephemeral' }
  return tools
}

async function sendRequest(body) {
  const url = `${baseUrl}/v1/messages?beta=true`
  const betas = selectedBetas()
  if (useDiagnostics) betas.push(DIAGNOSTIC_BETA)
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'User-Agent': useProviderHeaders ? `claude-cli/${CC_VERSION} (consumer, cli)` : 'jdcagnet/1.0',
  }
  if (betas.length > 0) headers['anthropic-beta'] = betas.join(',')
  if (useProviderHeaders) {
    headers['x-app'] = 'cli'
    headers['X-Claude-Code-Session-Id'] = sessionId
    headers['x-client-request-id'] = randomUUID()
    headers['X-Stainless-Lang'] = 'js'
    headers['X-Stainless-Package-Version'] = '0.39.0'
    headers['X-Stainless-OS'] = process.platform
    headers['X-Stainless-Arch'] = process.arch
    headers['X-Stainless-Runtime'] = 'node'
    headers['X-Stainless-Runtime-Version'] = process.versions.node
    headers['x-stainless-retry-count'] = '0'
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  return readSse(response)
}

async function readSse(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let id = ''
  let usage = {}
  let diagnostics
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trimStart()
      if (!raw || raw === '[DONE]') continue
      let event
      try {
        event = JSON.parse(raw)
      } catch {
        continue
      }
      if (event.type === 'message_start') {
        id = event.message?.id || id
        usage = event.message?.usage || usage
        diagnostics = event.message?.diagnostics
      } else if (event.type === 'message_delta') {
        usage = { ...usage, ...(event.usage || {}) }
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        text += event.delta.text
      }
    }
  }
  return { id, usage, diagnostics, text }
}

function describePrompt(body) {
  const blocks = linearBlocks(body)
  const breakpoints = blocks
    .map((block, index) => ({ ...block, index }))
    .filter(block => block.cache)
    .map(block => ({
      index: block.index,
      where: block.where,
      prefixHash: hashJson(blocks.slice(0, block.index + 1).map(stripCacheControl)),
    }))
  return {
    summary: {
      model: body.model,
      topLevelCache: Boolean(body.cache_control),
      tools: body.tools?.length || 0,
      systemBlocks: Array.isArray(body.system) ? body.system.length : (body.system ? 1 : 0),
      messages: body.messages?.length || 0,
      blockCount: blocks.length,
      cacheBreakpoints: breakpoints.length + (body.cache_control ? 1 : 0),
      diagnosticsPrevious: body.diagnostics?.previous_message_id || null,
    },
    breakpoints,
  }
}

function comparePrompt(previous, current) {
  const a = linearBlocks(previous).map(stripCacheControl)
  const b = linearBlocks(current).map(stripCacheControl)
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (!a[i]) return { firstDiff: i, reason: 'added_block', current: b[i]?.where }
    if (!b[i]) return { firstDiff: i, reason: 'removed_block', previous: a[i]?.where }
    if (hashJson(a[i]) !== hashJson(b[i])) {
      return {
        firstDiff: i,
        reason: 'changed_block',
        previous: { where: a[i].where, hash: hashJson(a[i]) },
        current: { where: b[i].where, hash: hashJson(b[i]) },
      }
    }
  }
  return null
}

function linearBlocks(body) {
  const out = []
  for (const [i, tool] of (body.tools || []).entries()) {
    out.push({ where: `tools[${i}].${tool.name}`, cache: Boolean(tool.cache_control), value: tool })
  }
  if (Array.isArray(body.system)) {
    for (const [i, block] of body.system.entries()) {
      out.push({ where: `system[${i}]`, cache: Boolean(block.cache_control), value: block })
    }
  } else if (typeof body.system === 'string') {
    out.push({ where: 'system', cache: false, value: { type: 'text', text: body.system } })
  }
  for (const [mi, message] of (body.messages || []).entries()) {
    const content = typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : message.content || []
    for (const [bi, block] of content.entries()) {
      out.push({ where: `messages[${mi}].${message.role}.content[${bi}]`, cache: Boolean(block.cache_control), value: block })
    }
  }
  return out
}

function stripCacheControl(block) {
  const value = structuredClone(block.value)
  delete value.cache_control
  return { where: block.where, value }
}

function computeFingerprint(firstUserText) {
  const chars = [4, 7, 20].map(i => firstUserText[i] || '0').join('')
  return createHash('sha256').update(`${FINGERPRINT_SALT}${chars}${CC_VERSION}`).digest('hex').slice(0, 3)
}

function getAttributionHeader(fingerprint) {
  return `x-anthropic-billing-header: cc_version=${CC_VERSION}.${fingerprint}; cc_entrypoint=cli;`
}

function hashJson(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

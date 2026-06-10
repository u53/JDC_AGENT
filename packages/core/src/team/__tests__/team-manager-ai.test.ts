import { describe, it, expect } from 'vitest'
import { TeamManagerAI } from '../team-manager-ai.js'
import { strictToolGroundingProfile } from '../../model-profile.js'
import type { ModelProvider } from '../../model-provider.js'
import type { ContextProvider } from '../../context/orchestrator.js'
import type { ContextRequest } from '../../context/types.js'
import type { Message, ModelConfig, StreamChunk, ToolDefinition } from '../../types.js'

class DeferredProvider implements ModelProvider {
  name = 'deferred-test'
  calls: Array<{ messages: Message[]; config: ModelConfig }> = []
  private resolvers: Array<(text: string) => void> = []

  async chat() {
    return { content: [], usage: { inputTokens: 0, outputTokens: 0 } }
  }

  stream(messages: Message[], _tools: ToolDefinition[], config: ModelConfig): AsyncIterable<StreamChunk> {
    const index = this.calls.length
    this.calls.push({ messages, config })
    const response = new Promise<string>((resolve) => {
      this.resolvers[index] = resolve
    })

    return (async function* () {
      const text = await response
      yield { type: 'text_delta', text } satisfies StreamChunk
      yield { type: 'message_end', usage: { inputTokens: 1, outputTokens: 1 } } satisfies StreamChunk
    })()
  }

  respond(index: number, text: string): void {
    const resolve = this.resolvers[index]
    if (!resolve) throw new Error(`No pending stream at index ${index}`)
    resolve(text)
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function systemPromptText(systemPrompt: ModelConfig['systemPrompt']): string {
  if (!Array.isArray(systemPrompt)) return typeof systemPrompt === 'string' ? systemPrompt : ''
  return systemPrompt.map(segment => segment.content).join('\n')
}

function makeContextStore() {
  return {
    saveRawEvidence: async () => ({ ok: true, value: undefined, diagnostics: [] }),
    saveBundleSnapshot: async () => ({ ok: true, value: undefined, diagnostics: [] }),
    saveDiagnostic: async () => ({ ok: true, value: undefined, diagnostics: [] }),
    queryFacts: async () => ({ ok: true, value: [], diagnostics: [] }),
    listAcceptedProjectFacts: async () => ({ ok: true, value: [], diagnostics: [] }),
    enforceQuotas: async () => ({ ok: true, value: { deletedFacts: 0, deletedBundles: 0, deletedRawEvidence: 0, deletedRejectedCandidates: 0 }, diagnostics: [] }),
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 250): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for predicate')
    }
    await flush()
  }
}

describe('TeamManagerAI scheduling', () => {
  it('drains queued user messages after a proactive PM cycle finishes', async () => {
    const provider = new DeferredProvider()
    const actionsReady: string[] = []
    const manager = new TeamManagerAI({
      initialTasks: [{ title: 'A', description: 'do A' }],
      provider,
      modelConfig: { model: 'test-model', maxTokens: 1000 },
      memberStates: () => [],
      cwd: '/tmp/team-manager-ai-test',
      teamId: 'team_test',
      objective: 'Test objective',
      onActionsReady: () => actionsReady.push('ready'),
    })

    manager.triggerProactiveCheck({ kind: 'task_completed', taskId: manager.getTasks()[0].id })
    await waitFor(() => provider.calls.length === 1)

    manager.handleIntervention({
      id: 'msg_1',
      from: 'user',
      to: 'manager',
      intent: 'message',
      content: '现在进度怎么样?',
      priority: 'normal',
      createdAt: Date.now(),
    })

    provider.respond(0, '[]')
    await waitFor(() => provider.calls.length === 2)

    const userCall = provider.calls[1]
    const userText = userCall.messages.at(-1)?.content.find(block => block.type === 'text')?.text ?? ''
    expect(userText).toContain('## Incoming user message')
    expect(userText).toContain('现在进度怎么样?')

    provider.respond(1, '[{"type":"reply","content":"当前只剩收尾任务。"}]')
    await waitFor(() => actionsReady.length === 1)
    const actions = manager.consumeAIActions()
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'reply', message: '当前只剩收尾任务。' })
  })

  it('passes strict model profile into PM context contracts', async () => {
    const provider = new DeferredProvider()
    const actionsReady: string[] = []
    let capturedRequest: ContextRequest | undefined
    const strictProfile = strictToolGroundingProfile({ id: 'strict_team_pm', providerPattern: 'test', modelPattern: 'weak-pm' })
    const contextProviders: ContextProvider[] = [{
      id: 'conversation',
      collect: async (request) => {
        capturedRequest = request
        return { evidence: [], sections: [], diagnostics: [], health: { id: 'conversation', status: 'enabled', updatedAt: 1 } }
      },
    }]
    const manager = new TeamManagerAI({
      initialTasks: [{ title: 'A', description: 'do A' }],
      provider,
      modelConfig: { model: 'weak-pm', maxTokens: 1000, modelProfile: strictProfile },
      memberStates: () => [],
      cwd: '/tmp/team-manager-ai-test',
      teamId: 'team_test',
      objective: 'Fix src/app.ts without enough repository evidence.',
      onActionsReady: () => actionsReady.push('ready'),
      contextEngine: {
        sessionId: 'team_pm_strict_profile',
        config: { enabled: true, injectionEnabled: true, harvestEnabled: false },
        store: makeContextStore() as any,
        providers: contextProviders,
        id: () => 'ctx_team_pm_strict_profile',
      },
    })

    manager.triggerProactiveCheck({ kind: 'task_completed', taskId: manager.getTasks()[0].id })
    await waitFor(() => provider.calls.length === 1)

    const promptText = systemPromptText(provider.calls[0].config.systemPrompt)
    expect(promptText).toContain('Model profile: strict_team_pm')
    expect(promptText).toContain('Strict profile instructions:')
    expect(capturedRequest?.modelProfile).toMatchObject({ id: 'strict_team_pm', evidenceStrictness: 'strict' })

    provider.respond(0, '[]')
    await flush()
  })

  it('shows available worker model ids to the PM', async () => {
    const provider = new DeferredProvider()
    const manager = new TeamManagerAI({
      initialTasks: [],
      provider,
      modelConfig: { model: 'claude-opus-4-8', maxTokens: 1000 },
      memberStates: () => [],
      cwd: '/tmp/team-manager-ai-test',
      teamId: 'team_test',
      objective: '让 GPT-5.5 和 Opus 分别调研并输出报告。',
      availableModels: [
        { modelId: 'openai:gpt-5.5', name: 'gpt-5.5', groupName: 'JDC OPEN AI' },
        { modelId: 'anthropic:claude-opus-4-8', name: 'claude-opus-4-8', groupName: 'JDC CC' },
      ],
    } as any)

    manager.triggerProactiveCheck({ kind: 'team_started' })
    await waitFor(() => provider.calls.length === 1)

    const promptText = systemPromptText(provider.calls[0].config.systemPrompt)
    expect(promptText).toContain('<available-models>')
    expect(promptText).toContain('modelId: "openai:gpt-5.5"')
    expect(promptText).toContain('For teams, set add_member.spec.modelId exactly')

    provider.respond(0, '[]')
    await flush()
  })
})

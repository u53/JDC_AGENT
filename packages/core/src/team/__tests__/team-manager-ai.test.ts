import { describe, it, expect } from 'vitest'
import { TeamManagerAI } from '../team-manager-ai.js'
import type { ModelProvider } from '../../model-provider.js'
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
})

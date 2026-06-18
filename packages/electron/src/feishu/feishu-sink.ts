import type { StreamChunk, ToolExecutionEvent } from '@jdcagnet/core'
import type { SessionEventSink, SessionInteractionSink } from '../session-event-sink.js'
import type { FeishuClientPort } from './types.js'

const MAX_REPLY_CHARS = 3500
const MAX_STATUS_CHARS = 600

type FeishuTarget = { chatId: string; threadKey?: string }

export class FeishuSink implements SessionEventSink, SessionInteractionSink {
  private readonly textBySession = new Map<string, string>()
  private readonly statusLines: string[] = []

  constructor(
    private readonly client: FeishuClientPort,
    private readonly target: FeishuTarget
  ) {}

  stream(sessionId: string, chunk: StreamChunk): void {
    if (chunk.type === 'text_delta' && chunk.text) {
      this.textBySession.set(sessionId, `${this.textBySession.get(sessionId) ?? ''}${chunk.text}`)
      return
    }

    const status = statusFromChunk(chunk)
    if (status) this.statusLines.push(status)
  }

  toolEvent(_sessionId: string, event: ToolExecutionEvent): void {
    this.statusLines.push(summarizeToolEvent(event))
  }

  async finished(sessionId: string): Promise<void> {
    await this.flushStatus()

    const text = (this.textBySession.get(sessionId) ?? '').trim()
    this.textBySession.delete(sessionId)
    if (!text) return

    await this.sendSplitText(text)
  }

  async flushStatus(): Promise<void> {
    if (!this.statusLines.length) return

    const pending = [...this.statusLines]
    const text = truncate(pending.join('\n'), MAX_REPLY_CHARS)
    await this.sendText(text)
    this.statusLines.splice(0, pending.length)
  }

  async requestPermission(request: { toolName: string; input: Record<string, unknown> }): Promise<boolean> {
    if (!this.client.sendApproval || !this.client.waitForApproval) return false

    const approval = await this.client.sendApproval({
      ...this.target,
      toolName: request.toolName,
      summary: summarizeInput(request.toolName, request.input),
    })
    return this.client.waitForApproval(approval.requestId)
  }

  async askUser(question: string, options?: string[], multiSelect?: boolean): Promise<string> {
    if (!this.client.waitForReply) return ''

    const prompt = formatQuestion(question, options, multiSelect)
    const message = await this.sendText(prompt)

    return this.client.waitForReply({
      ...this.target,
      promptMessageId: message.messageId,
    })
  }

  async reviewPlan(planFile: string, _content: string): Promise<{ approved: boolean; feedback?: string }> {
    if (!this.client.waitForReply) return { approved: false, feedback: 'No reply handler is available.' }

    const message = await this.sendText(`Please review the plan ${planFile}. Reply yes/approve to approve, or provide feedback.`)

    const reply = await this.client.waitForReply({
      ...this.target,
      promptMessageId: message.messageId,
    })
    const approved = /^(?:(?:yes|approved?)(?:\b|$)|(?:同意|通过)(?:\s|$|[，。！？,.!?]))/i.test(reply.trim())
    return approved ? { approved: true } : { approved: false, feedback: reply }
  }

  private async sendSplitText(text: string): Promise<void> {
    for (const part of splitText(text, MAX_REPLY_CHARS)) {
      await this.sendText(part)
    }
  }

  private sendText(text: string): Promise<{ messageId: string }> {
    return this.client.sendText({ ...this.target, text })
  }
}

function statusFromChunk(chunk: StreamChunk): string | null {
  switch (chunk.type) {
    case 'compact_complete': {
      const info = chunk.compactInfo
      return info
        ? `Compaction complete: kept ${info.keptCount}/${info.originalCount}, summarized ${info.summarizedCount}.`
        : 'Compaction complete.'
    }
    case 'compact_skipped':
      return `Compaction skipped: ${chunk.compactSkipped?.reason ?? 'unknown'}.`
    case 'compact_failed':
      return `Compaction failed: ${chunk.compactFailed?.message ?? chunk.compactFailed?.reason ?? 'unknown'}.`
    default:
      return null
  }
}

function summarizeToolEvent(event: ToolExecutionEvent): string {
  const name = event.toolName
  if (event.type === 'start') {
    return truncate(`Tool started: ${name}${event.input ? ` (${summarizeInput(name, event.input)})` : ''}`, MAX_STATUS_CHARS)
  }
  if (event.type === 'complete') {
    const suffix = event.result?.isError ? ' with error' : ''
    return truncate(`Tool completed${suffix}: ${name}`, MAX_STATUS_CHARS)
  }
  if (event.type === 'error') {
    return truncate(`Tool failed: ${name}`, MAX_STATUS_CHARS)
  }
  return truncate(`Tool progress: ${name}`, MAX_STATUS_CHARS)
}

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  if (isShellTool(toolName)) return summarizeShellInput(input)

  const safeKeys = Object.keys(input)
    .filter((key) => !isSensitiveKey(key))
    .sort()
  const omittedCount = Object.keys(input).length - safeKeys.length
  const keyText = safeKeys.length ? `keys: ${safeKeys.join(', ')}` : 'no safe keys'
  const omittedText = omittedCount ? `; ${omittedCount} sensitive field${omittedCount === 1 ? '' : 's'} omitted` : ''
  return truncate(`${keyText}${omittedText}`, 240)
}

function summarizeShellInput(input: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof input.command === 'string' && input.command.length > 0) parts.push('command provided')
  if (typeof input.run_in_background === 'boolean') parts.push(`background: ${input.run_in_background}`)
  if (typeof input.timeout === 'number') parts.push(`timeout: ${input.timeout}`)
  return parts.length ? parts.join(', ') : 'shell input provided'
}

function isShellTool(toolName: string): boolean {
  return /^(?:bash|powershell|shell|cmd)$/i.test(toolName)
}

function isSensitiveKey(key: string): boolean {
  return /(?:token|secret|password|passwd|credential|auth|api[_-]?key|private[_-]?key|command)/i.test(key)
}

function formatQuestion(question: string, options?: string[], multiSelect?: boolean): string {
  const optionText = options?.length ? `\nOptions: ${options.join(', ')}` : ''
  const modeText = multiSelect ? '\nYou may choose multiple options.' : ''
  return truncate(`Question: ${question}${optionText}${modeText}`, MAX_REPLY_CHARS)
}

function splitText(text: string, maxChars: number): string[] {
  const parts: string[] = []
  for (let index = 0; index < text.length; index += maxChars) {
    parts.push(text.slice(index, index + maxChars))
  }
  return parts
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
}

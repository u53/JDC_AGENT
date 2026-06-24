import type { Message, StreamChunk, ToolExecutionEvent } from '@jdcagnet/core'
import type { RetrySinkEvent, SessionEventSink, SessionInteractionSink } from '../session-event-sink.js'
import type { FeishuClientPort } from './types.js'

const MAX_REPLY_CHARS = 3500
const MAX_STATUS_CHARS = 600
const genericErrorText = '运行失败，请在 JDC 客户端查看详情。'

type FeishuTarget = { chatId: string; threadKey?: string }
type FeishuInteractionResolver = {
  waitForReply(input: { chatId: string; threadKey?: string; promptMessageId: string }): Promise<string>
  waitForApproval(requestId: string): Promise<boolean>
}

export class FeishuSink implements SessionEventSink, SessionInteractionSink {
  private readonly textBySession = new Map<string, string>()
  private readonly assistantTextsBySession = new Map<string, string[]>()
  private readonly statusLines: string[] = []
  private sendQueue: Promise<unknown> = Promise.resolve()
  private sawError = false

  constructor(
    private readonly client: FeishuClientPort,
    private readonly target: FeishuTarget,
    private readonly interactionResolver?: FeishuInteractionResolver
  ) {}

  stream(sessionId: string, chunk: StreamChunk): void {
    if (chunk.type === 'text_delta' && chunk.text) {
      this.textBySession.set(sessionId, `${this.textBySession.get(sessionId) ?? ''}${chunk.text}`)
      return
    }

    const status = statusFromChunk(chunk)
    if (status) this.queueStatus(status)
  }

  toolEvent(_sessionId: string, event: ToolExecutionEvent): void {
    this.queueStatus(summarizeToolEvent(event))
  }

  messageComplete(sessionId: string, message: Message): void {
    if (message.role !== 'assistant') return

    const text = extractTextFromMessage(message)
    if (!text) return

    const finalText = text.trim()
    const texts = this.assistantTextsBySession.get(sessionId) ?? []
    const lastText = texts[texts.length - 1]

    if (lastText === finalText || lastText?.includes(finalText)) return
    if (lastText && finalText.includes(lastText)) {
      texts[texts.length - 1] = finalText
    } else {
      texts.push(finalText)
    }
    this.assistantTextsBySession.set(sessionId, texts)
  }

  retrying(_sessionId: string, event: RetrySinkEvent): void {
    this.queueStatus(`Retrying request ${event.attempt}/${event.maxRetries}.`)
  }

  agentProgress(_sessionId: string, _agentToolUseId: string, event: any): void {
    const status = typeof event?.status === 'string' ? event.status : 'running'
    this.queueStatus(`Agent progress: ${status}`)
  }

  agentText(_sessionId: string, _agentToolUseId: string, text: string): void {
    if (text.trim()) this.queueStatus('Agent produced intermediate output.')
  }

  agentComplete(_sessionId: string, _agentToolUseId: string, result: any): void {
    const suffix = result?.status === 'failed' || result?.error ? ' with error' : ''
    this.queueStatus(`Agent completed${suffix}.`)
  }

  async error(_sessionId: string, _error: Error): Promise<void> {
    this.sawError = true
    await this.sendText(genericErrorText)
  }

  hasError(): boolean {
    return this.sawError
  }

  async finished(sessionId: string): Promise<void> {
    await this.drainPendingSends()
    await this.flushStatus()

    const completedTexts = this.assistantTextsBySession.get(sessionId)
    const text = (completedTexts?.length ? completedTexts.join('\n\n') : this.textBySession.get(sessionId) ?? '').trim()
    if (!text) {
      this.textBySession.delete(sessionId)
      this.assistantTextsBySession.delete(sessionId)
      return
    }

    await this.sendSplitReply(text)
    this.textBySession.delete(sessionId)
    this.assistantTextsBySession.delete(sessionId)
  }

  async flushStatus(): Promise<void> {
    if (!this.statusLines.length) return

    const pending = [...this.statusLines]
    const text = truncate(pending.join('\n'), MAX_REPLY_CHARS)
    await this.sendText(text)
    this.statusLines.splice(0, pending.length)
  }

  async drainPendingSends(): Promise<void> {
    await this.sendQueue
  }

  async requestPermission(request: { toolName: string; input: Record<string, unknown> }): Promise<boolean> {
    const approval = await this.sendApprovalPrompt(request)
    if (!approval) return false

    const waitForApproval = this.interactionResolver?.waitForApproval ?? this.client.waitForApproval?.bind(this.client)
    if (!waitForApproval) return false
    return waitForApproval(approval.requestId)
  }

  private sendApprovalPrompt(request: { toolName: string; input: Record<string, unknown> }): Promise<{ requestId: string }> | null {
    const summary = summarizeInput(request.toolName, request.input)
    if (this.client.sendApproval) {
      return this.client.sendApproval({
        ...this.target,
        toolName: request.toolName,
        summary,
      })
    }
    return this.sendText(`需要审批工具: ${request.toolName}\n${summary}\n回复“同意/允许/approve/yes”批准，回复“拒绝/deny/no”拒绝。`)
      .then((message) => ({ requestId: message.messageId }))
  }

  async askUser(question: string, options?: string[], multiSelect?: boolean): Promise<string> {
    const waitForReply = this.interactionResolver?.waitForReply ?? this.client.waitForReply?.bind(this.client)
    if (!waitForReply) return ''

    const prompt = formatQuestion(question, options, multiSelect)
    const message = await this.sendText(prompt)

    return waitForReply({
      ...this.target,
      promptMessageId: message.messageId,
    })
  }

  async reviewPlan(planFile: string, _content: string): Promise<{ approved: boolean; feedback?: string }> {
    const waitForReply = this.interactionResolver?.waitForReply ?? this.client.waitForReply?.bind(this.client)
    if (!waitForReply) return { approved: false, feedback: 'No reply handler is available.' }

    const message = await this.sendText(`Please review the plan ${planFile}. Reply yes/approve/同意/通过 to approve, or reject: reason / 拒绝: 原因 to request changes.`)

    const reply = await waitForReply({
      ...this.target,
      promptMessageId: message.messageId,
    })
    const parsed = parsePlanReviewReply(reply)
    return parsed.approved ? { approved: true } : { approved: false, feedback: parsed.feedback }
  }

  private queueStatus(status: string): void {
    this.statusLines.push(status)
    this.sendQueue = this.sendQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.flushStatus()
        } catch {
          // Keep buffered status lines for the next explicit flush or queued status.
        }
      })
  }

  private async sendSplitReply(text: string): Promise<void> {
    for (const part of splitText(text, MAX_REPLY_CHARS)) {
      await this.sendReply(part)
    }
  }

  private async sendReply(text: string): Promise<{ messageId: string }> {
    if (this.client.sendMarkdown) {
      try {
        return await this.client.sendMarkdown({ ...this.target, text })
      } catch {
        return this.sendText(text)
      }
    }
    return this.sendText(text)
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

function extractTextFromMessage(message: Message): string {
  return message.content
    .filter((block) => block.type === 'text' && block.text.trim())
    .map((block) => block.type === 'text' ? block.text : '')
    .join('\n\n')
    .trim()
}

function statusFromChunk(chunk: StreamChunk): string | null {
  switch (chunk.type) {
    case 'compact_start':
      return '正在压缩上下文，可能需要几分钟，请稍等…'
    case 'compact_progress':
      return null
    case 'compact_complete': {
      const info = chunk.compactInfo
      return info
        ? `上下文压缩完成：原始 ${info.originalCount} 条，保留 ${info.keptCount} 条，压缩 ${info.summarizedCount} 条，提取记忆 ${info.memoriesExtracted} 条。`
        : '上下文压缩完成。'
    }
    case 'compact_skipped':
      return '本次无需压缩上下文。'
    case 'compact_failed':
      return '上下文压缩失败，请在 JDC 客户端查看详情。'
    default:
      return null
  }
}

function summarizeToolEvent(event: ToolExecutionEvent): string {
  const label = publicToolLabel(event.toolName)
  if (event.type === 'start' || event.type === 'progress') {
    return label ? `正在运行工具：${label}` : '正在处理…'
  }
  if (event.type === 'complete') {
    if (!label) return '处理步骤完成。'
    return event.result?.isError ? `工具运行异常：${label}` : `工具运行完成：${label}`
  }
  if (event.type === 'error') {
    return label ? `工具运行失败：${label}` : '处理步骤失败。'
  }
  return label ? `正在处理：${label}` : '正在处理…'
}

function publicToolLabel(toolName: string): string | null {
  if (/^Jdc/i.test(toolName)) return null
  if (/^(?:Read|Write|Edit|MultiEdit|NotebookEdit|Glob|Grep|LS|Tree)$/i.test(toolName)) return '文件操作'
  if (/^(?:Bash|TaskOutput|Monitor)$/i.test(toolName)) return '命令执行'
  if (/^(?:Agent|Team|BackgroundSend|BackgroundStatus|BackgroundEvents|team_)/i.test(toolName)) return '后台任务'
  if (/^(?:Task|Todo)/i.test(toolName)) return '任务列表'
  if (/^(?:Web|Mcp)/i.test(toolName)) return '外部信息'
  if (/^(?:AskUser|EnterPlanMode|ExitPlanMode)$/i.test(toolName)) return '交互确认'
  return null
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
  const optionText = options?.length ? `\n${options.map((option, index) => `${index + 1}. ${option}`).join('\n')}` : ''
  const modeText = multiSelect ? '\n可多选，请用逗号分隔序号或选项。' : options?.length ? '\n请回复序号或选项内容。' : ''
  return truncate(`Question: ${question}${optionText}${modeText}`, MAX_REPLY_CHARS)
}

function parsePlanReviewReply(reply: string): { approved: boolean; feedback?: string } {
  const trimmed = reply.trim()
  if (/^(?:(?:yes|approved?)(?:\b|$)|(?:同意|通过)(?:\s|$|[，。！？,.!?]))/i.test(trimmed)) {
    return { approved: true }
  }
  const rejection = trimmed.match(/^(?:reject(?:ed)?|拒绝|不同意)\s*[:：]?\s*(.*)$/i)
  if (rejection) {
    return { approved: false, feedback: rejection[1]?.trim() || trimmed }
  }
  return { approved: false, feedback: trimmed }
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
